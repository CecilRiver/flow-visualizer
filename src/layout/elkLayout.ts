import type { ElkExtendedEdge, ElkNode, ElkPoint, ELK as ElkInstance } from 'elkjs/lib/elk-api'

import type { ProjectedGraph } from '@/domain/view-model'

import { GROUP_LAYOUT_OPTIONS, ROOT_LAYOUT_OPTIONS } from './elkOptions'
import { GROUP_PADDING, GROUP_MIN_SIZE, sizeForNode } from './nodeMetrics'

export interface LaidOutNode {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface LaidOutEdge {
  id: string
  /** Orthogonal bend points from ELK, in absolute coordinates. */
  bendPoints: readonly ElkPoint[]
  startPoint: ElkPoint
  endPoint: ElkPoint
}

export interface LayoutResult {
  nodes: readonly LaidOutNode[]
  edges: readonly LaidOutEdge[]
  width: number
  height: number
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

/**
 * Turns a projected graph into an ELK hierarchy (DESIGN.md 10.1).
 *
 * Exported for tests: the graph handed to ELK is the part worth asserting on,
 * because a mistake here (a child missing its container, or a dangling edge
 * reference) surfaces as a layout exception rather than a wrong picture.
 */
export function toElkGraph(graph: ProjectedGraph): ElkNode {
  const groupIds = new Set(graph.groups.map((group) => group.id))

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
      layoutOptions: GROUP_LAYOUT_OPTIONS,
      width: GROUP_MIN_SIZE.width,
      height: GROUP_MIN_SIZE.height,
      children,
    }
  })

  // Aggregated edges are declared at the root even when their endpoints live
  // inside a container; ELK routes them across the hierarchy.
  const edges: ElkExtendedEdge[] = graph.edges.map((edge) => ({
    id: edge.id,
    sources: [edge.source],
    targets: [edge.target],
  }))

  return {
    id: 'root',
    layoutOptions: ROOT_LAYOUT_OPTIONS,
    children: [...containers, ...orphaned],
    edges,
  }
}

function pointOf(point: ElkPoint | undefined): ElkPoint {
  return { x: point?.x ?? 0, y: point?.y ?? 0 }
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

function collectEdges(node: ElkNode, into: LaidOutEdge[]): void {
  for (const edge of node.edges ?? []) {
    const section = edge.sections?.[0]
    if (section === undefined) continue
    into.push({
      id: edge.id,
      startPoint: pointOf(section.startPoint),
      endPoint: pointOf(section.endPoint),
      bendPoints: (section.bendPoints ?? []).map(pointOf),
    })
  }
  for (const child of node.children ?? []) collectEdges(child, into)
}

/**
 * Runs ELK and normalises its output.
 *
 * Throws when ELK cannot lay the graph out; `useGraphController` catches that
 * and falls back to `fallbackLayout` (DESIGN.md 10.4).
 */
export async function computeElkLayout(graph: ProjectedGraph): Promise<LayoutResult> {
  const elk = await getElk()
  const laidOut = await elk.layout(toElkGraph(graph))

  const nodes: LaidOutNode[] = []
  collectNodes(laidOut, laidOut.x ?? 0, laidOut.y ?? 0, nodes)

  const edges: LaidOutEdge[] = []
  collectEdges(laidOut, edges)

  return {
    nodes,
    edges,
    width: laidOut.width ?? 0,
    height: laidOut.height ?? 0,
  }
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

export function layoutCacheKey(key: LayoutCacheKey): string {
  return [
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
  cache: LayoutCache,
): Promise<LayoutResult> {
  const cached = cache.get(key)
  if (cached !== undefined) return Promise.resolve(cached)

  const inFlight = pending.get(key)
  if (inFlight !== undefined) return inFlight

  const request = computeElkLayout(graph)
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

/** Padding re-exported so the group rendering matches what ELK reserved. */
export { GROUP_PADDING }
