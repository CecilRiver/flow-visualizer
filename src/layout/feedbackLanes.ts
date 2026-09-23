import type { ElkPoint } from 'elkjs/lib/elk-api'

import type { EdgeLayoutInput, LaidOutEdge, LaidOutNode } from './elkLayout'
import {
  localPortPosition,
  renderPortId,
  resolvePortCoordinates,
  type LayoutPort,
  type PortEnd,
  type PortSide,
  type PortSpec,
} from './layoutPorts'
import { GRAPH_READABILITY } from './readabilityOptions'

/**
 * Feedback lanes, and the orthogonal route primitive the degraded layouts use
 * (GRAPH_READABILITY_DESIGN.md 9.2, 9.3.1).
 *
 * A feedback edge runs from a consumer back to a producer, so on a left-to-right
 * layout it doubles back. Routed like any other edge it would be pulled straight
 * through the nodes it crosses, and the reader would have to trace it segment by
 * segment to find out where it goes. A lane gives it a channel of its own below
 * everything, which is what makes it followable at a glance (9.2).
 *
 * The lane cannot be declared to ELK. Whether an edge doubles back depends on
 * where ELK put its endpoints relative to each other — knowledge that only
 * exists after the layout has run. So the edge is declared with its natural
 * EAST/WEST ports like every other edge, which is what gives ELK the correct
 * layering in the first place, and the qualifying ones are moved to the bottom
 * afterwards.
 *
 * This module imports types from `elkLayout` and `elkLayout` imports values from
 * here. That is one-directional at runtime — the import below is type-only and
 * is erased — so there is no initialization cycle to trip over. A *value*
 * imported from `elkLayout` here would create one, and would crash rather than
 * fail to compile.
 */

export interface LaneResult {
  edges: LaidOutEdge[]
  ports: LayoutPort[]
}

const FEEDBACK = GRAPH_READABILITY.feedback
const STUB = GRAPH_READABILITY.routing.portStub

/**
 * Drops repeated points and points that are not bends.
 *
 * A point lying on the straight line between its neighbours is not a corner, and
 * leaving it in would put a zero-length or perfectly straight "bend" into a
 * section — which is what a consumer reading `bendPoints` would then draw.
 */
function simplify(points: readonly ElkPoint[]): ElkPoint[] {
  const deduped: ElkPoint[] = []
  for (const point of points) {
    const last = deduped[deduped.length - 1]
    if (last !== undefined && last.x === point.x && last.y === point.y) continue
    deduped.push({ x: point.x, y: point.y })
  }

  const bends: ElkPoint[] = []
  for (const [index, point] of deduped.entries()) {
    const before = deduped[index - 1]
    const after = deduped[index + 1]
    if (before !== undefined && after !== undefined) {
      const vertical = before.x === point.x && point.x === after.x
      const horizontal = before.y === point.y && point.y === after.y
      if (vertical || horizontal) continue
    }
    bends.push(point)
  }
  return bends
}

/** Where a route leaves a port: one stub outward along the port's own side. */
function exitPoint(port: ElkPoint, side: PortSide, stub: number): ElkPoint {
  if (side === 'SOUTH') return { x: port.x, y: port.y + stub }
  return side === 'WEST' ? { x: port.x - stub, y: port.y } : { x: port.x + stub, y: port.y }
}

/**
 * A deterministic orthogonal route between two ports (9.3.1).
 *
 * The four corners of a general orthogonal connection, chosen so the first and
 * last moves leave and arrive perpendicular to their ports: a horizontal port is
 * left horizontally, a SOUTH port downward. Nothing here is a heuristic — the
 * same two ports and sides always produce the same points, which is what makes
 * this usable as the fallback for a layout that has no routing of its own.
 */
export function orthogonalRoute(
  start: ElkPoint,
  end: ElkPoint,
  startSide: PortSide = 'EAST',
  endSide: PortSide = 'WEST',
): ElkPoint[] {
  const from = exitPoint(start, startSide, STUB)
  const to = exitPoint(end, endSide, STUB)
  const fromVertical = startSide === 'SOUTH'
  const toVertical = endSide === 'SOUTH'

  let middle: ElkPoint[]
  if (fromVertical !== toVertical) {
    // One end leaves sideways and the other downward, so a single corner joins
    // them — the two axes are already spoken for.
    middle = [fromVertical ? { x: from.x, y: to.y } : { x: to.x, y: from.y }]
  } else if (fromVertical) {
    const midY = (from.y + to.y) / 2
    middle = [
      { x: from.x, y: midY },
      { x: to.x, y: midY },
    ]
  } else {
    const midX = (from.x + to.x) / 2
    middle = [
      { x: midX, y: from.y },
      { x: midX, y: to.y },
    ]
  }

  return simplify([start, from, ...middle, to, end])
}

/** Whether an edge runs against the flow, judged from the finished layout. */
function isDoublingBack(edge: LaidOutEdge, byNodeId: ReadonlyMap<string, LaidOutNode>): boolean {
  const source = byNodeId.get(edge.source)
  const target = byNodeId.get(edge.target)
  return source !== undefined && target !== undefined && source.x > target.x
}

/**
 * Lane order (9.2 rule 2).
 *
 * Rightmost source first, then leftmost target, then the id. The first two keys
 * keep a lane from crossing the lane above it more than the graph forces; the id
 * makes the order total, so two layouts of the same graph cannot swap two lanes
 * and put different routes at the same height (18.9).
 */
function compareLaneOrder(
  first: LaidOutEdge,
  second: LaidOutEdge,
  byNodeId: ReadonlyMap<string, LaidOutNode>,
): number {
  const firstSource = byNodeId.get(first.source)?.x ?? 0
  const secondSource = byNodeId.get(second.source)?.x ?? 0
  if (firstSource !== secondSource) return secondSource - firstSource

  const firstTarget = byNodeId.get(first.target)?.x ?? 0
  const secondTarget = byNodeId.get(second.target)?.x ?? 0
  if (firstTarget !== secondTarget) return firstTarget - secondTarget

  return first.id < second.id ? -1 : first.id > second.id ? 1 : 0
}

/** The tallest label among these edges; 0 when none has been measured. */
function tallestLabel(
  edges: readonly LaidOutEdge[],
  edgeInputs: ReadonlyMap<string, EdgeLayoutInput>,
): number {
  let tallest = 0
  for (const edge of edges) {
    const height = edgeInputs.get(edge.id)?.metrics.height
    if (height !== undefined) tallest = Math.max(tallest, height)
  }
  return tallest
}

/**
 * Moves the feedback edges that double back onto their own lane, and returns the
 * edges and ports that result (9.2).
 *
 * Pure: the inputs are not modified, and an edge or port that does not qualify
 * is passed through unchanged. Callers that have nothing to lane get their own
 * arguments back, so the common case costs one filter.
 */
export function applyFeedbackLanes(
  nodes: readonly LaidOutNode[],
  edges: readonly LaidOutEdge[],
  ports: readonly LayoutPort[],
  edgeInputs: ReadonlyMap<string, EdgeLayoutInput>,
): LaneResult {
  const byNodeId = new Map(nodes.map((node) => [node.id, node]))

  // 9.2's last paragraph: a feedback edge that is still a forward relation keeps
  // its ELK route and only keeps the feedback line style and arrow. It is a
  // feedback edge in business meaning, not in geometry, and giving it a lane
  // would draw it the long way round for nothing.
  const qualifying = edges
    .filter((edge) => edge.feedback && isDoublingBack(edge, byNodeId))
    .sort((first, second) => compareLaneOrder(first, second, byNodeId))

  if (qualifying.length === 0) return { edges: [...edges], ports: [...ports] }

  let maxBottom = 0
  for (const node of nodes) maxBottom = Math.max(maxBottom, node.y + node.height)

  // Rule 5: a gap wide enough for the label of the lane above it. Without the
  // label's own height in here, a two-line feedback label would be placed in the
  // channel and then sit on the lane below.
  const laneGap = Math.max(FEEDBACK.laneGap, tallestLabel(qualifying, edgeInputs) + GRAPH_READABILITY.label.collisionGap)

  const laneYByEdge = new Map<string, number>()
  qualifying.forEach((edge, index) => {
    laneYByEdge.set(edge.id, maxBottom + FEEDBACK.baseGap + index * laneGap)
  })

  // 7.3 rule 5 puts the feedback ports on the bottom edge, numbered in lane
  // order with the source before the target. The order is what decides their x,
  // so it has to be settled before any coordinate is computed.
  const southByNode = new Map<string, { edgeId: string; end: PortEnd; lane: number }[]>()
  qualifying.forEach((edge, lane) => {
    for (const end of ['source', 'target'] as const) {
      const nodeId = end === 'source' ? edge.source : edge.target
      const bucket = southByNode.get(nodeId) ?? []
      bucket.push({ edgeId: edge.id, end, lane })
      southByNode.set(nodeId, bucket)
    }
  })

  const southSpecs: PortSpec[] = []
  for (const [nodeId, bucket] of southByNode) {
    bucket.sort((first, second) => {
      if (first.lane !== second.lane) return first.lane - second.lane
      if (first.end === second.end) return 0
      return first.end === 'source' ? -1 : 1
    })
    bucket.forEach((entry, index) => {
      southSpecs.push({
        id: renderPortId(entry.edgeId, entry.end),
        nodeId,
        end: entry.end,
        side: 'SOUTH',
        order: index,
        count: bucket.length,
      })
    })
  }

  // The same `localPortPosition` formula the ELK path declares its leaf ports
  // with, so a lane port and a normal port are placed by one rule rather than
  // two. The box is the node's final one, since the lane runs after layout.
  const localByPortId = new Map<string, ElkPoint>()
  for (const spec of southSpecs) {
    const node = byNodeId.get(spec.nodeId)
    if (node === undefined) continue
    localByPortId.set(spec.id, localPortPosition(spec, node))
  }
  const placedSouth = new Map(
    resolvePortCoordinates(southSpecs, localByPortId, byNodeId).map((port) => [port.id, port]),
  )

  const lanePorts: LayoutPort[] = ports.map((port) => {
    const placed = placedSouth.get(port.id)
    if (placed === undefined) return port
    return { ...port, side: 'SOUTH', order: placed.order, x: placed.x, y: placed.y }
  })
  const lanePortsById = new Map(lanePorts.map((port) => [port.id, port]))

  const routed = edges.map((edge) => {
    const laneY = laneYByEdge.get(edge.id)
    if (laneY === undefined) return edge

    const source = lanePortsById.get(edge.sourcePortId)
    const target = lanePortsById.get(edge.targetPortId)
    if (source === undefined || target === undefined) return edge

    // 9.2 rule 4: down out of the source, along the lane, up into the target.
    // The lane's own two corners are at the ports' x, so the horizontal run is
    // the lane and nothing else.
    const points = simplify([
      { x: source.x, y: source.y },
      { x: source.x, y: laneY },
      { x: target.x, y: laneY },
      { x: target.x, y: target.y },
    ])
    const start = points[0]
    const end = points[points.length - 1]
    if (start === undefined || end === undefined) return edge

    return {
      ...edge,
      sections: [
        {
          id: `${edge.id}__lane`,
          startPoint: start,
          bendPoints: points.slice(1, -1),
          endPoint: end,
          // Synthesised as one piece, so it chains to nothing.
          incomingSections: [],
          outgoingSections: [],
        },
      ],
    }
  })

  return { edges: routed, ports: lanePorts }
}
