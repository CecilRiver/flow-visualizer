import type { ElkPoint } from 'elkjs/lib/elk-api'

import type { ProjectedGraph } from '@/domain/view-model'

import { withLabels, type LaidOutEdge, type LaidOutNode, type LayoutResult } from './elkLayout'
import { applyFeedbackLanes, orthogonalRoute } from './feedbackLanes'
import {
  assignRenderPorts,
  localPortPosition,
  renderPortId,
  resolvePortCoordinates,
} from './layoutPorts'
import { GROUP_PADDING, GROUP_MIN_SIZE, sizeForNode } from './nodeMetrics'

/**
 * Deterministic column grid used when ELK fails (DESIGN.md 10.4).
 *
 * The graph stays fully usable and the evidence is untouched: a layout failure
 * is a rendering problem, never a statement about the configuration's validity.
 * Column assignment follows edge direction by longest path, so the fallback
 * still reads left to right; nodes without a reachable predecessor start at
 * column 0 regardless of their configuration order.
 */

const COLUMN_GAP = 100
const ROW_GAP = 48
const CHILD_GAP = 16
const MARGIN = 40

/** Every directed node pair, de-duplicated, as `[from, to]` tuples. */
function collectPairs(graph: ProjectedGraph, nodeIds: ReadonlySet<string>): string[][] {
  const seen = new Set<string>()
  const pairs: string[][] = []

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue
    if (edge.source === edge.target) continue
    // Parallel aggregated edges between the same pair must not be counted
    // twice, or indegree would never reach zero.
    const key = `${edge.source} ${edge.target}`
    if (seen.has(key)) continue
    seen.add(key)
    pairs.push([edge.source, edge.target])
  }

  return pairs
}

/**
 * Marks the edges that close a cycle, using an iterative DFS colouring.
 *
 * Feedback loops are normal here — a control law feeding back into the state it
 * reads — and a plain longest-path pass stalls on them: every node on the cycle
 * keeps an indegree above zero, stays in column 0, and its edges end up
 * pointing backwards. Dropping back edges first yields a DAG whose layering is
 * well defined; a dropped edge simply renders right to left.
 */
function findBackEdges(nodeIds: readonly string[], pairs: readonly string[][]): Set<string> {
  const outgoing = new Map<string, string[]>()
  for (const id of nodeIds) outgoing.set(id, [])
  for (const pair of pairs) {
    const from = pair[0]
    const to = pair[1]
    if (from === undefined || to === undefined) continue
    outgoing.get(from)?.push(to)
  }

  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const colour = new Map<string, number>()
  for (const id of nodeIds) colour.set(id, WHITE)

  const backEdges = new Set<string>()

  for (const root of nodeIds) {
    if (colour.get(root) !== WHITE) continue
    // Explicit stack rather than recursion: the component hierarchy can be deep
    // enough that a recursive walk would risk a stack overflow.
    const stack: Array<{ id: string; next: number }> = [{ id: root, next: 0 }]
    colour.set(root, GRAY)

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      if (frame === undefined) break
      const children = outgoing.get(frame.id) ?? []

      if (frame.next >= children.length) {
        colour.set(frame.id, BLACK)
        stack.pop()
        continue
      }

      const child = children[frame.next]
      frame.next += 1
      if (child === undefined) continue

      const childColour = colour.get(child)
      if (childColour === GRAY) {
        backEdges.add(`${frame.id} ${child}`)
        continue
      }
      if (childColour === WHITE) {
        colour.set(child, GRAY)
        stack.push({ id: child, next: 0 })
      }
    }
  }

  return backEdges
}

/** Longest-path column per node, computed from the aggregated edges. */
export function assignColumns(graph: ProjectedGraph): Map<string, number> {
  const nodeIds = [...graph.nodes.map((node) => node.id), ...graph.groups.map((group) => group.id)]
  const nodeIdSet = new Set(nodeIds)
  const pairs = collectPairs(graph, nodeIdSet)
  const backEdges = findBackEdges(nodeIds, pairs)

  const outgoing = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  for (const id of nodeIds) {
    outgoing.set(id, [])
    indegree.set(id, 0)
  }
  for (const pair of pairs) {
    const from = pair[0]
    const to = pair[1]
    if (from === undefined || to === undefined) continue
    if (backEdges.has(`${from} ${to}`)) continue
    outgoing.get(from)?.push(to)
    indegree.set(to, (indegree.get(to) ?? 0) + 1)
  }

  const column = new Map<string, number>()
  for (const id of nodeIds) column.set(id, 0)

  // Kahn's algorithm over the cycle-free remainder.
  const remaining = new Map(indegree)
  const queue: string[] = []
  for (const id of nodeIds) if ((indegree.get(id) ?? 0) === 0) queue.push(id)

  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined) break
    const base = column.get(id) ?? 0
    for (const next of outgoing.get(id) ?? []) {
      if ((column.get(next) ?? 0) < base + 1) column.set(next, base + 1)
      const left = (remaining.get(next) ?? 0) - 1
      remaining.set(next, left)
      if (left === 0) queue.push(next)
    }
  }

  return column
}

interface Placement {
  id: string
  groupId?: string
  width: number
  height: number
  column: number
}

export function computeFallbackLayout(graph: ProjectedGraph): LayoutResult {
  const columns = assignColumns(graph)
  const groupIdSet = new Set(graph.groups.map((group) => group.id))

  const placements: Placement[] = graph.nodes.map((node) => {
    const size = sizeForNode(node)
    const placement: Placement = {
      id: node.id,
      width: size.width,
      height: size.height,
      column: columns.get(node.id) ?? 0,
    }
    if (node.parentGroupId !== undefined && groupIdSet.has(node.parentGroupId)) {
      placement.groupId = node.parentGroupId
    }
    return placement
  })

  // Column geometry is local to this run: a module-level map would let one
  // layout's widths leak into the next.
  const columnWidths = new Map<number, number>()
  const columnX = (column: number, width: number): number => {
    if ((columnWidths.get(column) ?? 0) < width) columnWidths.set(column, width)
    let x = MARGIN
    for (let index = 0; index < column; index += 1) {
      x += (columnWidths.get(index) ?? 0) + COLUMN_GAP
    }
    return x
  }

  // Each column stacks downwards from its own cursor; columns are as wide as
  // their widest member and separated by a fixed gap.
  const cursor = new Map<number, number>()
  const takeRow = (column: number): number => cursor.get(column) ?? MARGIN
  const advance = (column: number, y: number): void => {
    cursor.set(column, y)
  }

  const nodes: LaidOutNode[] = []

  const groupBoxes = graph.groups
    .map((group) => ({
      id: group.id,
      column: columns.get(group.id) ?? 0,
      width: GROUP_MIN_SIZE.width,
    }))
    .sort((a, b) => (a.column !== b.column ? a.column - b.column : a.id < b.id ? -1 : 1))

  for (const box of groupBoxes) {
    const children = placements.filter((placement) => placement.groupId === box.id)
    const widestChild = children.reduce((max, child) => Math.max(max, child.width), 0)
    const stackedHeight = children.reduce((sum, child) => sum + child.height, 0)

    const width = Math.max(box.width, widestChild + GROUP_PADDING.left + GROUP_PADDING.right)
    const height = Math.max(
      GROUP_MIN_SIZE.height,
      stackedHeight +
        Math.max(0, children.length - 1) * CHILD_GAP +
        GROUP_PADDING.top +
        GROUP_PADDING.bottom,
    )

    const x = columnX(box.column, width)
    const y = takeRow(box.column)
    advance(box.column, y + height + ROW_GAP)
    nodes.push({ id: box.id, x, y, width, height })

    // Children render above the container, exactly as in the ELK result: Vue
    // Flow positions nested nodes absolutely.
    let childY = y + GROUP_PADDING.top
    for (const child of children) {
      nodes.push({
        id: child.id,
        x: x + GROUP_PADDING.left,
        y: childY,
        width: child.width,
        height: child.height,
      })
      childY += child.height + CHILD_GAP
    }
  }

  const topLevelNodes = placements
    .filter((placement) => placement.groupId === undefined)
    .sort((a, b) => (a.column !== b.column ? a.column - b.column : a.id < b.id ? -1 : 1))

  for (const placement of topLevelNodes) {
    const x = columnX(placement.column, placement.width)
    const y = takeRow(placement.column)
    advance(placement.column, y + placement.height + ROW_GAP)
    nodes.push({ id: placement.id, x, y, width: placement.width, height: placement.height })
  }

  const width = nodes.reduce((max, node) => Math.max(max, node.x + node.width), 0) + MARGIN
  const height = nodes.reduce((max, node) => Math.max(max, node.y + node.height), 0) + MARGIN

  const byNodeId = new Map(nodes.map((node) => [node.id, node]))

  // Real ports, and real routes through them.
  //
  // This used to hand out `{x: 0, y: 0}` for both endpoints with a comment
  // warning that anything reading them as geometry would draw every edge out of
  // the top-left corner. That comment was correct and this pass is the consumer
  // it was warning about. The fallback knows every box it just placed, so a port
  // position is available here without a sentinel and without guessing.
  const specs = assignRenderPorts(graph)
  const localByPortId = new Map<string, ElkPoint>()
  for (const spec of specs) {
    const box = byNodeId.get(spec.nodeId)
    if (box === undefined) continue
    localByPortId.set(spec.id, localPortPosition(spec, box))
  }
  const ports = resolvePortCoordinates(specs, localByPortId, byNodeId)
  const byPortId = new Map(ports.map((port) => [port.id, port]))

  const routed: LaidOutEdge[] = graph.edges.map((edge) => {
    const sourcePortId = renderPortId(edge.id, 'source')
    const targetPortId = renderPortId(edge.id, 'target')
    const start = byPortId.get(sourcePortId)
    const end = byPortId.get(targetPortId)

    // 9.3.1: two render ports are all a deterministic orthogonal route needs.
    // Drawing straight between the ports is what keeps the degraded picture free
    // of the diagonal stubs the layout proper exists to avoid.
    const points =
      start === undefined || end === undefined
        ? []
        : orthogonalRoute(start, end, start.side, end.side)
    const first = points[0]
    const last = points[points.length - 1]

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      feedback: edge.feedback,
      sourcePortId,
      targetPortId,
      sections:
        first === undefined || last === undefined
          ? []
          : [
              {
                id: `${edge.id}__fallback`,
                startPoint: first,
                bendPoints: points.slice(1, -1),
                endPoint: last,
                incomingSections: [],
                outgoingSections: [],
              },
            ],
    }
  })

  // No label metrics are passed, so the lanes are spaced by the floor gap alone
  // — which is all a layout that draws no labels needs.
  const lanes = applyFeedbackLanes(nodes, routed, ports, new Map())

  // Labels are not placed, and none are marked visible (DESIGN.md 14). Label
  // collision cannot be checked against a layout whose routes are this
  // approximate, so the reader loses the inline text but keeps every node, and
  // the edge data still carries the presentation text for the Inspector — which
  // is the honest outcome. A degraded layout must not look like a finished one.
  const { labels, bounds } = withLabels(graph, nodes, lanes.edges, new Map(), false)

  return { nodes, ports: lanes.ports, edges: lanes.edges, labels, bounds, width, height }
}
