import type { EdgeLabelMetrics } from './labelMetrics'
import { BOUNDS_MARGIN, shapeBounds, type Box, type Point } from './layoutBounds'
import { GRAPH_READABILITY } from './readabilityOptions'

/**
 * Where each edge label goes, and what happens when nowhere is free
 * (GRAPH_READABILITY_DESIGN.md 10).
 *
 * ELK can reserve room for a label but it cannot know whether the *rendered*
 * box landed on a node: the box it was given is an estimate, and a parallel
 * edge's label can still come down on top of another. So every label is checked
 * against the node boxes and the labels already placed, and a label with no free
 * position is not drawn by default at all.
 *
 * Hiding is the point. A label that overlaps a node is worse than an absent
 * label: the reader cannot tell whether the text belongs to the node or to the
 * edge, and the design document is explicit that a fallback must not pretend the
 * collision was solved (14).
 */

export type PlacementIssue =
  /** The box would cover a node that is not one of its own endpoints. */
  | 'NODE_OVERLAP'
  /** The box would cover a label that was placed before it. */
  | 'LABEL_OVERLAP'
  /** The box would sit outside the drawing, forcing the fit to zoom out for it. */
  | 'OUT_OF_BOUNDS'
  /** The edge has no segment long enough to anchor a label to. */
  | 'NO_SAFE_SEGMENT'

export interface PlacementNode extends Box {
  id: string
}

export interface PlacementEdge {
  id: string
  source: string
  target: string
  /** The routed path: start point, bend points, end point. */
  points: readonly Point[]
  /** Severity of the edge's verification; lower is more severe, so it places first. */
  verificationRank: number
  feedback: boolean
  /** Position in the projection — the tiebreak before the id. */
  sourceOrder: number
}

export interface PlacedLabel {
  edgeId: string
  /** Top-left corner in graph coordinates, not the centre. */
  x: number
  y: number
  width: number
  height: number
  /** The text already broken by `measureEdgeLabel`. */
  lines: readonly string[]
  truncated: boolean
  /** False when no candidate was free: the label is dropped, never overlapped. */
  visibleByDefault: boolean
  /** Why it is not drawn by default; `null` when it is. */
  issue: PlacementIssue | null
}

const LABEL = GRAPH_READABILITY.label

/** Offset from the route to the label box, so the text does not sit on the line. */
const ROUTE_GAP = LABEL.collisionGap

/** Two boxes overlap only if they share area; touching edges are disjoint. */
function overlaps(first: Box, second: Box): boolean {
  return (
    first.x < second.x + second.width &&
    second.x < first.x + first.width &&
    first.y < second.y + second.height &&
    second.y < first.y + first.height
  )
}

/** The box grown by `by` on every side. */
function inflate(box: Box, by: number): Box {
  return { x: box.x - by, y: box.y - by, width: box.width + 2 * by, height: box.height + 2 * by }
}

interface Segment {
  x1: number
  y1: number
  x2: number
  y2: number
  horizontal: boolean
  length: number
}

function segmentsOf(points: readonly Point[]): Segment[] {
  const segments: Segment[] = []
  for (let index = 0; index + 1 < points.length; index += 1) {
    const from = points[index]
    const to = points[index + 1]
    if (from === undefined || to === undefined) continue
    const dx = Math.abs(to.x - from.x)
    const dy = Math.abs(to.y - from.y)
    if (dx === 0 && dy === 0) continue
    segments.push({
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      // An orthogonal route has only these two orientations; a diagonal (which
      // a degenerate route can produce) is treated as horizontal, which keeps
      // the label near the middle of it.
      horizontal: dy <= dx,
      length: dx + dy,
    })
  }
  return segments
}

/**
 * Candidate positions, in the order the design document lays out (10):
 * the longest horizontal segment above then below, the next longest the same
 * way, then the longest vertical segment to the right then to the left.
 *
 * Horizontal segments come first because the layout flows left to right: a
 * label above or below a horizontal run sits in the channel the reader is
 * already following, while one beside a vertical run crowds the layer gap.
 */
function candidateBoxes(size: { width: number; height: number }, segments: readonly Segment[]): Box[] {
  const horizontal = segments
    .filter((segment) => segment.horizontal)
    .sort((a, b) => b.length - a.length)
  const vertical = segments
    .filter((segment) => !segment.horizontal)
    .sort((a, b) => b.length - a.length)

  const boxes: Box[] = []
  const boxAt = (x: number, y: number): Box => ({ x, y, ...size })

  for (const segment of horizontal.slice(0, 2)) {
    const centredX = (segment.x1 + segment.x2) / 2 - size.width / 2
    boxes.push(boxAt(centredX, segment.y1 - ROUTE_GAP - size.height))
    boxes.push(boxAt(centredX, segment.y1 + ROUTE_GAP))
  }

  const longestVertical = vertical[0]
  if (longestVertical !== undefined) {
    const centredY = (longestVertical.y1 + longestVertical.y2) / 2 - size.height / 2
    boxes.push(boxAt(longestVertical.x1 + ROUTE_GAP, centredY))
    boxes.push(boxAt(longestVertical.x1 - ROUTE_GAP - size.width, centredY))
  }

  return boxes
}

/**
 * Placement order (10).
 *
 * The most severe verification picks first, because that is the edge a reader
 * most needs to read; feedback edges go next, since a feedback edge's label is
 * the only thing on the canvas saying which way the data returns. Projection
 * order and then the id make the result total and reproducible — two runs over
 * the same graph must not swap two labels.
 */
export function comparePlacementPriority(first: PlacementEdge, second: PlacementEdge): number {
  if (first.verificationRank !== second.verificationRank) {
    return first.verificationRank - second.verificationRank
  }
  if (first.feedback !== second.feedback) return first.feedback ? -1 : 1
  if (first.sourceOrder !== second.sourceOrder) return first.sourceOrder - second.sourceOrder
  return first.id < second.id ? -1 : first.id > second.id ? 1 : 0
}

export interface PlaceEdgeLabelsInput {
  edges: readonly PlacementEdge[]
  nodes: readonly PlacementNode[]
  metrics: ReadonlyMap<string, EdgeLabelMetrics>
}

/**
 * Places every label that has room, and reports the rest.
 *
 * Returns labels in the input order, not in the order they were placed, so a
 * caller can zip them back onto the edges it passed in.
 */
export function placeEdgeLabels(input: PlaceEdgeLabelsInput): PlacedLabel[] {
  const { edges, nodes, metrics } = input
  const shape = shapeBounds(
    nodes,
    edges.map((edge) => edge.points),
  )
  const usable: Box = {
    x: shape.x - BOUNDS_MARGIN.left,
    y: shape.y - BOUNDS_MARGIN.top,
    width: shape.width + BOUNDS_MARGIN.left + BOUNDS_MARGIN.right,
    height: shape.height + BOUNDS_MARGIN.top + BOUNDS_MARGIN.bottom,
  }

  const placed: PlacedLabel[] = []
  const byEdgeId = new Map<string, PlacedLabel>()

  for (const edge of [...edges].sort(comparePlacementPriority)) {
    const size = metrics.get(edge.id)
    if (size === undefined) continue

    const box = { width: size.width, height: size.height }
    const candidates = candidateBoxes(box, segmentsOf(edge.points))

    let chosen: Box | null = null
    let issue: PlacementIssue = 'NO_SAFE_SEGMENT'

    for (const candidate of candidates) {
      const found = issueFor(candidate, edge, nodes, placed, usable)
      if (found === null) {
        chosen = candidate
        break
      }
      // Only the first candidate's complaint is kept: that is the position the
      // layout most wanted, so it is the one worth reporting.
      if (issue === 'NO_SAFE_SEGMENT') issue = found
    }

    const label: PlacedLabel = {
      edgeId: edge.id,
      x: chosen?.x ?? 0,
      y: chosen?.y ?? 0,
      width: size.width,
      height: size.height,
      lines: size.lines,
      truncated: size.truncated,
      visibleByDefault: chosen !== null,
      issue: chosen === null ? issue : null,
    }

    placed.push(label)
    byEdgeId.set(edge.id, label)
  }

  // Back to input order: callers match labels to edges positionally.
  return edges.map((edge) => byEdgeId.get(edge.id)).filter((label): label is PlacedLabel => label !== undefined)
}

function issueFor(
  candidate: Box,
  edge: PlacementEdge,
  nodes: readonly PlacementNode[],
  placed: readonly PlacedLabel[],
  usable: Box,
): PlacementIssue | null {
  if (!contains(usable, candidate)) return 'OUT_OF_BOUNDS'

  for (const node of nodes) {
    // A label may cover the nodes it connects (10): the reader can already see
    // which edge is which from the line, and forbidding it would make the two
    // busiest edges the ones that never get a label.
    if (node.id === edge.source || node.id === edge.target) continue
    if (overlaps(candidate, inflate(node, LABEL.nodeGap))) return 'NODE_OVERLAP'
  }

  for (const other of placed) {
    if (!other.visibleByDefault) continue
    if (overlaps(candidate, inflate(other, LABEL.collisionGap))) return 'LABEL_OVERLAP'
  }

  return null
}

function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}
