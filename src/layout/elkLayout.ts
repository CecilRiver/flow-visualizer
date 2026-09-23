import type {
  ElkEdgeSection,
  ElkExtendedEdge,
  ElkNode,
  ElkPoint,
  ElkPort,
  ELK as ElkInstance,
} from 'elkjs/lib/elk-api'

import type { ProjectedGraph } from '@/domain/view-model'

import { groupLayoutOptions, rootLayoutOptions } from './elkOptions'
import { applyFeedbackLanes, orthogonalRoute } from './feedbackLanes'
import type { EdgeLabelMetrics } from './labelMetrics'
import {
  assignRenderPorts,
  localPortPosition,
  renderPortId,
  resolvePortCoordinates,
  type LayoutPort,
  type PortSpec,
} from './layoutPorts'
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

/** One orthogonal piece of a route (GRAPH_READABILITY_DESIGN.md 8). */
export interface LaidOutEdgeSection {
  id: string
  startPoint: ElkPoint
  /** Orthogonal bend points, in absolute coordinates. */
  bendPoints: readonly ElkPoint[]
  endPoint: ElkPoint
  /**
   * The sections this one continues from and into.
   *
   * ELK only fills these in when an edge comes back as several chained
   * sections; a single-section edge has neither field, so an empty array here
   * means "no link", not "a link to nothing".
   */
  incomingSections: readonly string[]
  outgoingSections: readonly string[]
}

export interface LaidOutEdge {
  id: string
  /** The projected endpoints, kept so label placement can exempt them (10). */
  source: string
  target: string
  /**
   * The route, one entry per ELK section.
   *
   * A list rather than one polyline: the sections of a cross-container edge are
   * not guaranteed to be adjacent, and joining them into a single path would
   * draw a segment ELK never routed (12.1).
   */
  sections: readonly LaidOutEdgeSection[]
  /** Render ports this edge attaches to (7.3, 9.1). */
  sourcePortId: string
  targetPortId: string
  /**
   * Carried through from the projection.
   *
   * Not in 8's listing, but 9.2's lane rule is a question about a *feedback*
   * edge, and the answer is only knowable here — after the layout, from the
   * endpoints. Without the flag the lane pass would have to go back to the
   * projected graph to ask, and would then be reading two descriptions of the
   * same edge.
   */
  feedback: boolean
}

export interface LayoutResult {
  nodes: readonly LaidOutNode[]
  /** Every render port the drawing attaches a route to (8). */
  ports: readonly LayoutPort[]
  edges: readonly LaidOutEdge[]
  /** Where each label goes, and whether it is drawn at all. */
  labels: readonly PlacedLabel[]
  /** What the initial fit has to cover (11). */
  bounds: Box
  width: number
  height: number
}

/** One section as a plain polyline, for consumers that read a whole route. */
export function sectionPolyline(section: LaidOutEdgeSection): ElkPoint[] {
  return [section.startPoint, ...section.bendPoints, section.endPoint]
}

/** Every section of an edge as a polyline. */
export function routePolylines(edge: LaidOutEdge): ElkPoint[][] {
  return edge.sections.map(sectionPolyline)
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
  specs: readonly PortSpec[] = assignRenderPorts(graph),
): ElkNode {
  const groupIds = new Set(graph.groups.map((group) => group.id))
  const maxLabelWidth = widestLabel(edgeInputs)

  const specsByNode = new Map<string, PortSpec[]>()
  for (const spec of specs) {
    const bucket = specsByNode.get(spec.nodeId)
    if (bucket === undefined) specsByNode.set(spec.nodeId, [spec])
    else bucket.push(spec)
  }

  /**
   * The ports of one node, or `undefined` when it has none.
   *
   * `size` is passed only for a node whose box is already known — a leaf, whose
   * footprint is a constant. A container's box is the thing ELK is about to
   * compute, so its ports cannot be given coordinates in advance; leaving them
   * off and declaring `FIXED_SIDE` for the node lets ELK place them along the
   * side, and the resolved coordinates are read back out of the result.
   */
  const portsFor = (
    nodeId: string,
    size: { width: number; height: number } | null,
  ): ElkPort[] | undefined => {
    const nodeSpecs = specsByNode.get(nodeId)
    if (nodeSpecs === undefined || nodeSpecs.length === 0) return undefined
    return nodeSpecs.map((spec) => {
      const port: ElkPort = { id: spec.id, layoutOptions: { 'elk.port.side': spec.side } }
      if (size !== null) {
        const local = localPortPosition(spec, size)
        port.x = local.x
        port.y = local.y
      }
      return port
    })
  }

  /**
   * The constraint that pins a node's ports in place.
   *
   * This has to be set on *every* node that holds a port. Left to itself ELK
   * reshuffles them: measured against elkjs 0.9.3 on a 240×124 node, two ports
   * declared at y=20 and y=100 came back at 82.7 and 41.3 — reordered as well as
   * moved, ignoring the coordinates entirely. A constrained node standing beside
   * an unconstrained one would end up with its route arriving at a different
   * height from its own port, which is the diagonal stub this pass exists to
   * remove. Neither choice below leaves a side free: a leaf is `FIXED_POS`, a
   * container is `FIXED_SIDE`.
   */
  const constrainPorts = (isContainer: boolean): Record<string, string> => ({
    'elk.portConstraints': isContainer ? 'FIXED_SIDE' : 'FIXED_POS',
  })

  const childNodes: ElkNode[] = graph.nodes.map((node) => {
    const size = sizeForNode(node)
    const elkNode: ElkNode = { id: node.id, width: size.width, height: size.height }
    const ports = portsFor(node.id, size)
    if (ports !== undefined) {
      elkNode.ports = ports
      elkNode.layoutOptions = constrainPorts(false)
    }
    return elkNode
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
    const ports = portsFor(group.id, null)
    const container: ElkNode = {
      id: group.id,
      layoutOptions: {
        ...groupLayoutOptions(maxLabelWidth),
        ...(ports === undefined ? {} : constrainPorts(true)),
      },
      width: GROUP_MIN_SIZE.width,
      height: GROUP_MIN_SIZE.height,
      children,
    }
    if (ports !== undefined) container.ports = ports
    return container
  })

  // An edge references its ports by id. Falling back to the node id is not a
  // degraded route — ELK resolves either — but it only happens if a caller
  // passed specs that do not cover every edge, which `assignRenderPorts` never
  // produces.
  const declaredPortIds = new Set(specs.map((spec) => spec.id))
  const endpointOf = (edgeId: string, end: 'source' | 'target', nodeId: string): string => {
    const id = renderPortId(edgeId, end)
    return declaredPortIds.has(id) ? id : nodeId
  }

  // Aggregated edges are declared at the root even when their endpoints live
  // inside a container; ELK routes them across the hierarchy.
  const edges: ElkExtendedEdge[] = graph.edges.map((edge) => {
    const elkEdge: ElkExtendedEdge = {
      id: edge.id,
      sources: [endpointOf(edge.id, 'source', edge.source)],
      targets: [endpointOf(edge.id, 'target', edge.target)],
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

/** One ELK section, shifted into root coordinates. */
function sectionOf(
  section: ElkEdgeSection,
  offsetX: number,
  offsetY: number,
): LaidOutEdgeSection {
  return {
    id: section.id,
    startPoint: pointOf(section.startPoint, offsetX, offsetY),
    bendPoints: (section.bendPoints ?? []).map((point) => pointOf(point, offsetX, offsetY)),
    endPoint: pointOf(section.endPoint, offsetX, offsetY),
    // Present only on a section that chains to another; absent means "no link",
    // so it must not be invented.
    incomingSections: [...(section.incomingSections ?? [])],
    outgoingSections: [...(section.outgoingSections ?? [])],
  }
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

/** The projected endpoints and render ports of one edge, for `collectEdges`. */
interface EdgeEndpoints {
  source: string
  target: string
  sourcePortId: string
  targetPortId: string
  feedback: boolean
}

/**
 * Collects edge routes, shifted into root coordinates.
 *
 * Two things this has to get right, and the second was wrong until it was
 * measured.
 *
 * Sections are carried through as sections, one entry each, and *not* joined
 * into a single polyline. The joined form survived only because the sections of
 * a cross-container edge happen to meet in the fixtures measured so far; the
 * moment two of them do not, joining them draws a straight line between the end
 * of one and the start of the next — a segment ELK never routed, presented as
 * part of the route (12.1). Keeping the split removes the possibility rather
 * than relying on the fixture.
 *
 * And the offset is **per edge**, not the position of the node the edge was
 * found under. Under `INCLUDE_CHILDREN`, ELK reports every edge at the root of
 * the result and writes its coordinates in the frame of the two endpoints'
 * deepest common ancestor. Measured on the L2 fixture: `l2.attitude → l2.rate`
 * sits entirely inside `ui-group:domain.control`, comes back on `root.edges`,
 * and its section reads `(300,110) → (460,110)` — the container's own frame.
 * Adding the container's position gives `(830,630)`, which is the port the route
 * was asked to reach, to the pixel. An offset accumulated from wherever the
 * edge was *found* adds nothing, because it is found at the root.
 */
function collectEdges(
  node: ElkNode,
  endpointsById: ReadonlyMap<string, EdgeEndpoints>,
  frameOffset: (source: string, target: string) => ElkPoint,
  into: LaidOutEdge[],
): void {
  for (const edge of node.edges ?? []) {
    const endpoints = endpointsById.get(edge.id)
    const offset = frameOffset(endpoints?.source ?? '', endpoints?.target ?? '')
    const sections = (edge.sections ?? []).map((section) => sectionOf(section, offset.x, offset.y))

    // An edge ELK left unrouted is kept rather than dropped: 9.3.1 gives it a
    // deterministic orthogonal route between its two ports, and an edge that is
    // silently absent from the drawing is a worse answer than one drawn the
    // degraded way.
    into.push({
      id: edge.id,
      source: endpoints?.source ?? '',
      target: endpoints?.target ?? '',
      sections,
      sourcePortId: endpoints?.sourcePortId ?? '',
      targetPortId: endpoints?.targetPortId ?? '',
      feedback: endpoints?.feedback ?? false,
    })
  }

  for (const child of node.children ?? []) {
    collectEdges(child, endpointsById, frameOffset, into)
  }
}

/**
 * ELK's own answer for where each port sits, in node-local coordinates.
 *
 * Read back rather than recomputed from the node box, because the two agree for
 * a leaf (which is `FIXED_POS`, so ELK echoes what it was sent) and disagree for
 * a container: its box is ELK's output, and ELK distributes a `FIXED_SIDE`
 * node's ports by its own rule. Recomputing would put the drawn handle where the
 * route does not end.
 */
function collectElkPortLocals(node: ElkNode, into: Map<string, ElkPoint>): void {
  for (const port of node.ports ?? []) {
    into.set(port.id, { x: port.x ?? 0, y: port.y ?? 0 })
  }
  for (const child of node.children ?? []) collectElkPortLocals(child, into)
}

/**
 * The coordinate frame an edge's sections are written in.
 *
 * Under `INCLUDE_CHILDREN` an edge's points are relative to the deepest node
 * that contains both of its endpoints — the root when they share no container,
 * and a container when they are both inside it. Since ELK hands every edge back
 * at the root, walking outward from one endpoint to the first ancestor the other
 * also has is what identifies that frame. Taking the *first* match walking
 * outward is what makes it the deepest one.
 *
 * A frame that is one of the endpoints themselves is legitimate: it is what an
 * edge to or from a container comes back in. The root is not a node, so no match
 * at all means the frame is the root and the offset is zero.
 */
function edgeFrameOffset(
  graph: ProjectedGraph,
  boxes: ReadonlyMap<string, { x: number; y: number }>,
): (source: string, target: string) => ElkPoint {
  const parentOf = new Map<string, string>()
  for (const node of graph.nodes) {
    if (node.parentGroupId !== undefined) parentOf.set(node.id, node.parentGroupId)
  }

  // The chain starts at the node itself, so a container that *is* an endpoint is
  // found as its own frame.
  const chainOf = (id: string): string[] => {
    const chain: string[] = []
    // Bounded rather than unbounded: a cycle in `parentGroupId` would otherwise
    // hang the layout instead of producing a wrong picture.
    for (let cursor = id, depth = 0; depth < 64; depth += 1) {
      chain.push(cursor)
      const parent = parentOf.get(cursor)
      if (parent === undefined) break
      cursor = parent
    }
    return chain
  }

  return (source, target) => {
    if (source === '' || target === '') return { x: 0, y: 0 }
    const targetChain = new Set(chainOf(target))
    for (const id of chainOf(source)) {
      if (!targetChain.has(id)) continue
      const box = boxes.get(id)
      return box === undefined ? { x: 0, y: 0 } : { x: box.x, y: box.y }
    }
    return { x: 0, y: 0 }
  }
}

/**
 * The orthogonal route used when ELK returned no section for an edge (9.3.1).
 *
 * Only a fallback: with `elk.hierarchyHandling: 'INCLUDE_CHILDREN'` every edge
 * measured comes back routed, so this exists for the edge that does not rather
 * than as a routine path.
 */
function withFallbackRoute(
  edge: LaidOutEdge,
  byPortId: ReadonlyMap<string, LayoutPort>,
): LaidOutEdge {
  if (edge.sections.length > 0) return edge

  const start = byPortId.get(edge.sourcePortId)
  const end = byPortId.get(edge.targetPortId)
  if (start === undefined || end === undefined) return edge

  const points = orthogonalRoute(start, end)
  const first = points[0]
  const last = points[points.length - 1]
  if (first === undefined || last === undefined) return edge

  return {
    ...edge,
    sections: [
      {
        id: `${edge.id}__fallback`,
        startPoint: first,
        bendPoints: points.slice(1, -1),
        endPoint: last,
        // Synthesised, so it chains to nothing and nothing claims to chain to it.
        incomingSections: [],
        outgoingSections: [],
      },
    ],
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
  const specs = assignRenderPorts(graph)
  const laidOut = await elk.layout(toElkGraph(graph, edgeInputs, specs))

  const nodes: LaidOutNode[] = []
  collectNodes(laidOut, laidOut.x ?? 0, laidOut.y ?? 0, nodes)

  const elkPortLocals = new Map<string, ElkPoint>()
  collectElkPortLocals(laidOut, elkPortLocals)
  const ports = resolvePortCoordinates(
    specs,
    elkPortLocals,
    new Map(nodes.map((node) => [node.id, node])),
  )

  const endpointsById = new Map<string, EdgeEndpoints>(
    graph.edges.map((edge) => [
      edge.id,
      {
        source: edge.source,
        target: edge.target,
        // The ids the ELK graph was built with, so the ports named here are the
        // ones the route was actually asked to end at.
        sourcePortId: renderPortId(edge.id, 'source'),
        targetPortId: renderPortId(edge.id, 'target'),
        feedback: edge.feedback,
      },
    ]),
  )

  const routed: LaidOutEdge[] = []
  collectEdges(
    laidOut,
    endpointsById,
    edgeFrameOffset(graph, new Map(nodes.map((node) => [node.id, node]))),
    routed,
  )

  const byPortId = new Map(ports.map((port) => [port.id, port]))
  const lanes = applyFeedbackLanes(
    nodes,
    routed.map((edge) => withFallbackRoute(edge, byPortId)),
    ports,
    edgeInputs,
  )

  return {
    nodes,
    ports: lanes.ports,
    edges: lanes.edges,
    width: laidOut.width ?? 0,
    height: laidOut.height ?? 0,
    ...withLabels(graph, nodes, lanes.edges, edgeInputs),
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
  const routesByEdge = new Map(edges.map((edge) => [edge.id, routePolylines(edge)]))

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
          const routes = routesByEdge.get(edge.id)
          if (input === undefined || routes === undefined) return []
          return [
            {
              id: edge.id,
              source: edge.source,
              target: edge.target,
              routes,
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
  // Every section of every route, including the feedback lanes: a lane that runs
  // below all the nodes is part of what the reader has to see, so it has to be
  // inside the bounds the initial fit covers (11).
  const shape = shapeBounds(
    nodes,
    edges.flatMap(routePolylines),
  )

  return { labels, bounds: layoutBounds(shape, drawn) }
}

/** Cache key inputs (DESIGN.md 10.3): everything that changes the coordinates. */
export interface LayoutCacheKey {
  bundleId: string
  /**
   * The schema version the bundle declares.
   *
   * Named for what it holds. This field spent its life called `revision`, which
   * reads as a revision of the *content* — and it was in fact the schema
   * version, the string `0.1`, identical for every bundle written against that
   * schema. A field that changes name depending on who is reading it is how the
   * gap below stayed invisible.
   */
  schemaVersion: string
  scenarioId: string
  level: number
  flowKinds: readonly string[]
  verificationStates: readonly string[]
  /** `layoutInputSignature` of the graph about to be laid out (13.2). */
  inputs: string
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
export const LAYOUT_SIGNATURE = 'layout-v4-ports-and-lanes'

/**
 * A digest of everything the layout actually reads (13.2).
 *
 * The rest of the key names the *identity* of what is being laid out — bundle,
 * scenario, level, filters. Identity is not enough. Editing a flow's name and
 * rescanning the folder leaves every one of those fields identical while
 * changing the text of a label, and therefore the box ELK was asked to reserve
 * for it; the next request was a cache hit and the stale layout came back with
 * label boxes sized for the old text. The drawn label was then wider than the
 * box that had been checked for collisions — exactly the defect this pass
 * exists to remove, arriving by a different door.
 *
 * Built from `toElkGraph`'s output because that object *is* the layout's input,
 * by construction. A hand-written list of fields to include is the kind of thing
 * that goes stale the day someone adds a field to the ELK graph, and it would
 * fail the same silent way.
 *
 * Deliberately not hashed to a fixed width: a hash would trade a real risk — a
 * collision serving a layout for a different graph, silently — for bytes we do
 * not need to save. Measured on the real Stabilize model: 1.8 KB / 4.5 KB /
 * 8.5 KB at L0 / L1 / L2, built in 0.02–0.07 ms. The cache holds twenty, so the
 * whole cost is under 200 KB and a fraction of a millisecond, against an ELK
 * run that takes hundreds.
 */
export function layoutInputSignature(
  graph: ProjectedGraph,
  edgeInputs: ReadonlyMap<string, EdgeLayoutInput> = new Map(),
): string {
  // `placementRank` steers the placement pass, which runs after ELK, so it is
  // not part of the ELK graph and has to be carried alongside it.
  const ranks = graph.edges.map(
    (edge) => `${edge.id}:${String(edgeInputs.get(edge.id)?.placementRank ?? '')}`,
  )
  return JSON.stringify([toElkGraph(graph, edgeInputs), ranks])
}

export function layoutCacheKey(key: LayoutCacheKey): string {
  return [
    LAYOUT_SIGNATURE,
    key.bundleId,
    key.schemaVersion,
    key.scenarioId,
    `L${key.level}`,
    [...key.flowKinds].sort().join(','),
    [...key.verificationStates].sort().join(','),
    key.inputs,
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
