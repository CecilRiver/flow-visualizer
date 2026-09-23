import type {
  ElkEdgeSection,
  ElkExtendedEdge,
  ElkNode,
  ElkPoint,
  ELK as ElkInstance,
} from 'elkjs/lib/elk-api'

import type { ProjectedGraph } from '@/domain/view-model'

import { groupLayoutOptions, rootLayoutOptions } from './elkOptions'
import type { EdgeLabelMetrics } from './labelMetrics'
import { placeEdgeLabels, type PlacedLabel } from './labelPlacement'
import { layoutBounds, shapeBounds, type Box } from './layoutBounds'
import { GROUP_MIN_SIZE, sizeForNode } from './nodeMetrics'

export interface LaidOutNode {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface LaidOutEdge {
  id: string
  source: string
  target: string
  /** The whole route in absolute coordinates: start, bend points, end. */
  points: readonly ElkPoint[]
  /** Orthogonal bend points from ELK, in absolute coordinates. */
  bendPoints: readonly ElkPoint[]
  startPoint: ElkPoint
  endPoint: ElkPoint
}

export interface LayoutResult {
  nodes: readonly LaidOutNode[]
  edges: readonly LaidOutEdge[]
  /** Where each label goes, and whether it is drawn at all. */
  labels: readonly PlacedLabel[]
  /** What the initial fit has to cover (11). */
  bounds: Box
  width: number
  height: number
}

/**
 * What the layout needs to know about one edge's label.
 *
 * Deliberately not the label's *text*: the layout has no business knowing what
 * an edge says. It needs the box to reserve room for and the priority to place
 * it in, both of which the caller derives from the projection.
 */
export interface EdgeLayoutInput {
  metrics: EdgeLabelMetrics
  /** Lower places first; see `comparePlacementPriority`. */
  placementRank: number
}

type ElkConstructor = new () => ElkInstance

let elkPromise: Promise<ElkInstance> | null = null

/**
 * Loads ELK on first use.
 *
 * Two reasons this is dynamic rather than a top-level import:
 *   - the bundled build is ~1.4 MB, and the welcome page has no graph to lay
 *     out, so there is no reason to make a reader on that screen wait for it;
 *   - the bundled build runs the algorithm in-page, whereas the default `elkjs`
 *     entry pulls in `elk-worker.js`, which only exists under Node's
 *     `worker_threads`.
 */
function getElk(): Promise<ElkInstance> {
  elkPromise ??= import('elkjs/lib/elk.bundled.js').then((module) => {
    const Constructor = module.default as unknown as ElkConstructor
    return new Constructor()
  })
  return elkPromise
}

/** The widest label ELK has to leave room for; drives the layer gap. */
function widestLabel(edgeInputs: ReadonlyMap<string, EdgeLayoutInput>): number {
  let widest = 0
  for (const input of edgeInputs.values()) widest = Math.max(widest, input.metrics.width)
  return widest
}

/**
 * Turns a projected graph into an ELK hierarchy (DESIGN.md 10.1).
 *
 * Exported for tests: the graph handed to ELK is the part worth asserting on,
 * because a mistake here (a child missing its container, or a dangling edge
 * reference) surfaces as a layout exception rather than a wrong picture.
 *
 * The labels matter as much as the nodes. ELK routes around whatever it is told
 * about, so an edge declared without its label is an edge ELK believes is
 * narrower than it is — which is exactly how a label came to be drawn on top of
 * the node in the following layer.
 */
export function toElkGraph(
  graph: ProjectedGraph,
  edgeInputs: ReadonlyMap<string, EdgeLayoutInput> = new Map(),
): ElkNode {
  const groupIds = new Set(graph.groups.map((group) => group.id))
  const maxLabelWidth = widestLabel(edgeInputs)

  const childNodes: ElkNode[] = graph.nodes.map((node) => {
    const size = sizeForNode(node)
    return { id: node.id, width: size.width, height: size.height }
  })

  // A node can only be nested in a group that is actually present; otherwise it
  // stays at the root so it can never disappear from the drawing.
  const orphaned: ElkNode[] = []
  const childrenByGroup = new Map<string, ElkNode[]>()

  for (const [index, node] of graph.nodes.entries()) {
    const elkNode = childNodes[index]
    if (elkNode === undefined) continue
    const groupId = node.parentGroupId
    if (groupId === undefined || !groupIds.has(groupId)) {
      orphaned.push(elkNode)
      continue
    }
    const bucket = childrenByGroup.get(groupId)
    if (bucket === undefined) childrenByGroup.set(groupId, [elkNode])
    else bucket.push(elkNode)
  }

  const containers: ElkNode[] = graph.groups.map((group) => {
    const children = childrenByGroup.get(group.id) ?? []
    return {
      id: group.id,
      layoutOptions: groupLayoutOptions(maxLabelWidth),
      width: GROUP_MIN_SIZE.width,
      height: GROUP_MIN_SIZE.height,
      children,
    }
  })

  // Aggregated edges are declared at the root even when their endpoints live
  // inside a container; ELK routes them across the hierarchy.
  const edges: ElkExtendedEdge[] = graph.edges.map((edge) => {
    const elkEdge: ElkExtendedEdge = {
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    }

    const input = edgeInputs.get(edge.id)
    if (input !== undefined) {
      // A zero width or height is dropped by ELK without a word, and a negative
      // one is clamped to nothing — so the box is floored at 1 rather than
      // trusted. `measureEdgeLabel` never produces zero, but this is the line
      // where a silent mistake would cost the whole reservation.
      elkEdge.labels = [
        {
          id: `${edge.id}__label`,
          // ELK does not measure text; the string is here so a failed layout
          // can be read back. The box below is the only thing it acts on.
          text: input.metrics.lines.join(' '),
          width: Math.max(1, input.metrics.width),
          height: Math.max(1, input.metrics.height),
        },
      ]
    }

    return elkEdge
  })

  return {
    id: 'root',
    layoutOptions: rootLayoutOptions(maxLabelWidth),
    children: [...containers, ...orphaned],
    edges,
  }
}

function pointOf(point: ElkPoint | undefined, offsetX = 0, offsetY = 0): ElkPoint {
  return { x: offsetX + (point?.x ?? 0), y: offsetY + (point?.y ?? 0) }
}

/** Every point of one section, in order, shifted into root coordinates. */
function sectionPoints(section: ElkEdgeSection, offsetX: number, offsetY: number): ElkPoint[] {
  return [
    pointOf(section.startPoint, offsetX, offsetY),
    ...(section.bendPoints ?? []).map((point) => pointOf(point, offsetX, offsetY)),
    pointOf(section.endPoint, offsetX, offsetY),
  ]
}

/** Flattens ELK's hierarchy back into absolute node boxes (DESIGN.md 10.5). */
function collectNodes(
  node: ElkNode,
  offsetX: number,
  offsetY: number,
  into: LaidOutNode[],
): void {
  for (const child of node.children ?? []) {
    const x = offsetX + (child.x ?? 0)
    const y = offsetY + (child.y ?? 0)
    into.push({
      id: child.id,
      x,
      y,
      width: child.width ?? 0,
      height: child.height ?? 0,
    })
    collectNodes(child, x, y, into)
  }
}

/**
 * Collects edge routes, shifted into root coordinates.
 *
 * Two things the previous version got wrong. All of `sections` are read, not
 * just the first: an edge that crosses a container boundary comes back as
 * several sections, and using only the first drew a line that stopped
 * mid-graph. And the parent offset is accumulated, the same way it is for
 * nodes — without it a route inside a container was offset by the container's
 * own position twice, or not at all.
 */
function collectEdges(
  node: ElkNode,
  offsetX: number,
  offsetY: number,
  edgesById: ReadonlyMap<string, { source: string; target: string }>,
  into: LaidOutEdge[],
): void {
  for (const edge of node.edges ?? []) {
    const sections = edge.sections ?? []
    if (sections.length === 0) continue

    const points: ElkPoint[] = []
    for (const section of sections) {
      const sectionRoute = sectionPoints(section, offsetX, offsetY)
      // A section starts where the previous one ended; keeping both would leave
      // a zero-length segment in the polyline.
      const first = sectionRoute[0]
      const last = points[points.length - 1]
      const start = first !== undefined && last !== undefined && first.x === last.x && first.y === last.y
        ? sectionRoute.slice(1)
        : sectionRoute
      points.push(...start)
    }

    const start = points[0]
    const end = points[points.length - 1]
    if (start === undefined || end === undefined) continue

    const endpoints = edgesById.get(edge.id)
    into.push({
      id: edge.id,
      source: endpoints?.source ?? '',
      target: endpoints?.target ?? '',
      points,
      bendPoints: points.slice(1, -1),
      startPoint: start,
      endPoint: end,
    })
  }

  for (const child of node.children ?? []) {
    collectEdges(child, offsetX + (child.x ?? 0), offsetY + (child.y ?? 0), edgesById, into)
  }
}

/**
 * Runs ELK and normalises its output.
 *
 * Throws when ELK cannot lay the graph out; `useGraphController` catches that
 * and falls back to `fallbackLayout` (DESIGN.md 10.4).
 */
export async function computeElkLayout(
  graph: ProjectedGraph,
  edgeInputs: ReadonlyMap<string, EdgeLayoutInput> = new Map(),
): Promise<LayoutResult> {
  const elk = await getElk()
  const laidOut = await elk.layout(toElkGraph(graph, edgeInputs))

  const nodes: LaidOutNode[] = []
  collectNodes(laidOut, laidOut.x ?? 0, laidOut.y ?? 0, nodes)

  const endpoints = new Map(graph.edges.map((edge) => [edge.id, { source: edge.source, target: edge.target }]))
  const edges: LaidOutEdge[] = []
  collectEdges(laidOut, laidOut.x ?? 0, laidOut.y ?? 0, endpoints, edges)

  return {
    nodes,
    edges,
    width: laidOut.width ?? 0,
    height: laidOut.height ?? 0,
    ...withLabels(graph, nodes, edges, edgeInputs),
  }
}

/**
 * Places the labels and derives the extent everything has to fit into.
 *
 * Shared with the fallback layout: both produce the same `LayoutResult` shape,
 * and a caller must not be able to tell which one ran from the fields alone.
 */
export function withLabels(
  graph: ProjectedGraph,
  nodes: readonly LaidOutNode[],
  edges: readonly LaidOutEdge[],
  edgeInputs: ReadonlyMap<string, EdgeLayoutInput>,
  /** Suppresses inline labels entirely; the fallback uses this (14). */
  allowLabels = true,
): { labels: PlacedLabel[]; bounds: Box } {
  const groupIds = new Set(graph.groups.map((group) => group.id))
  const pointsByEdge = new Map(edges.map((edge) => [edge.id, edge.points]))

  const labels = allowLabels
    ? placeEdgeLabels({
        // A container is a background, not an obstacle: a label over a domain
        // group still reads, and treating the group as solid would silence
        // every label in the busiest part of the drawing.
        nodes: nodes
          .filter((node) => !groupIds.has(node.id))
          .map((node) => ({ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height })),
        edges: graph.edges.flatMap((edge, index) => {
          const input = edgeInputs.get(edge.id)
          const points = pointsByEdge.get(edge.id)
          if (input === undefined || points === undefined) return []
          return [
            {
              id: edge.id,
              source: edge.source,
              target: edge.target,
              points,
              verificationRank: input.placementRank,
              feedback: edge.feedback,
              sourceOrder: index,
            },
          ]
        }),
        metrics: new Map([...edgeInputs].map(([id, input]) => [id, input.metrics])),
      })
    : []

  const drawn = labels.filter((label) => label.visibleByDefault)
  const shape = shapeBounds(
    nodes,
    edges.map((edge) => edge.points),
  )

  return { labels, bounds: layoutBounds(shape, drawn) }
}

/** Cache key inputs (DESIGN.md 10.3): everything that changes the coordinates. */
export interface LayoutCacheKey {
  bundleId: string
  revision: string
  scenarioId: string
  level: number
  flowKinds: readonly string[]
  verificationStates: readonly string[]
}

/**
 * Bumped whenever a change to this module would produce different coordinates
 * for the same inputs (13.2).
 *
 * The key below names the graph, not the code that lays it out. Without this,
 * a cache populated before a layout change would keep serving the old geometry
 * for as long as the reader stayed on the same scenario — and the symptom
 * (stale coordinates, correct everything else) is close to impossible to read.
 */
export const LAYOUT_SIGNATURE = 'layout-v2-labels'

export function layoutCacheKey(key: LayoutCacheKey): string {
  return [
    LAYOUT_SIGNATURE,
    key.bundleId,
    key.revision,
    key.scenarioId,
    `L${key.level}`,
    [...key.flowKinds].sort().join(','),
    [...key.verificationStates].sort().join(','),
  ].join('|')
}

const LAYOUT_CACHE_LIMIT = 20

/**
 * Bounded LRU over layout results.
 *
 * Insertion order doubles as recency: a hit is re-inserted so the oldest entry
 * is always the first key. Layout is the expensive step, and the same
 * level/scenario/filter combination comes back constantly while exploring.
 */
export class LayoutCache {
  private readonly entries = new Map<string, LayoutResult>()

  constructor(private readonly limit: number = LAYOUT_CACHE_LIMIT) {}

  get(key: string): LayoutResult | undefined {
    const value = this.entries.get(key)
    if (value === undefined) return undefined
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  set(key: string, value: LayoutResult): void {
    this.entries.delete(key)
    this.entries.set(key, value)
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next()
      if (oldest.done === true) break
      this.entries.delete(oldest.value)
    }
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }
}

/**
 * Layout with memoisation. The returned promise is shared by concurrent callers
 * with the same key, so a burst of identical requests runs ELK once.
 */
const pending = new Map<string, Promise<LayoutResult>>()

export function layoutGraph(
  key: string,
  graph: ProjectedGraph,
  edgeInputs: ReadonlyMap<string, EdgeLayoutInput>,
  cache: LayoutCache,
): Promise<LayoutResult> {
  const cached = cache.get(key)
  if (cached !== undefined) return Promise.resolve(cached)

  const inFlight = pending.get(key)
  if (inFlight !== undefined) return inFlight

  const request = computeElkLayout(graph, edgeInputs)
    .then((result) => {
      cache.set(key, result)
      return result
    })
    .finally(() => {
      pending.delete(key)
    })

  pending.set(key, request)
  return request
}
