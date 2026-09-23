import type { ElkPoint } from 'elkjs/lib/elk-api'

import type { ProjectedGraph } from '@/domain/view-model'

import type { NodeSize } from './nodeMetrics'

/**
 * Render ports (GRAPH_READABILITY_DESIGN.md 7.3).
 *
 * Before this module there were two port geometries and neither knew about the
 * other: ELK routed every edge from one node box to another with no ports at
 * all, while Vue Flow drew from handles positioned by a percentage formula of
 * its own. The line was therefore only ever *approximately* attached to the
 * thing it was attached to (DESIGN.md 10.5).
 *
 * Here the port becomes a layout object: it is declared to ELK, ELK routes to
 * exactly that point, and Vue Flow renders a handle at exactly that point. One
 * geometry, two consumers.
 *
 * Coordinates are root-graph absolute, like every other coordinate in
 * `LayoutResult`.
 */

export type PortSide = 'WEST' | 'EAST' | 'SOUTH'

/** Which end of its edge a port is. */
export type PortEnd = 'source' | 'target'

/** A render port the layout has not placed yet. */
export interface PortSpec {
  /** `layout-port:${edge.id}:source|target` (7.3 rule 3). */
  id: string
  nodeId: string
  /**
   * Which end of the edge attaches here.
   *
   * Not derivable from the side: a WEST port is normally a target, but the two
   * ends of a feedback lane both sit on the bottom edge, so a SOUTH port is a
   * target on one node and a source on the other.
   */
  end: PortEnd
  side: PortSide
  /** 0-based index among the ports sharing this node and side. */
  order: number
  /** How many ports share this node and side, this one included. */
  count: number
  /**
   * The Schema port the edge named, when it named one (7.3 rule 4).
   *
   * Absent for an aggregated edge: no single declared port speaks for a group
   * of flows, which is why the projection drops the handles as soon as an edge
   * stands for more than one (`aggregateEdges.ts`). Kept for the Inspector to
   * trace a route back to the configuration; never written back to the Schema.
   */
  semanticPortId?: string
}

export interface LayoutPort {
  id: string
  nodeId: string
  end: PortEnd
  side: PortSide
  order: number
  x: number
  y: number
  semanticPortId?: string
}

export function renderPortId(edgeId: string, end: PortEnd): string {
  return `layout-port:${edgeId}:${end}`
}

/** Which side a forward edge leaves and arrives on (7.3 rule 1). */
export function sideForEnd(end: PortEnd): 'EAST' | 'WEST' {
  return end === 'source' ? 'EAST' : 'WEST'
}

/**
 * Gives every edge its two render ports, in the projection's own order.
 *
 * The order is the whole point of taking it from `graph.edges`: the projection
 * has already sorted edges by flow order (`projectScenario`), so "same side,
 * stable order" (7.3 rule 5) needs no second sort and no tie-break of its own —
 * a port's index is its edge's index among the edges sharing that side. Ties
 * cannot arise because an edge contributes at most one port to a side.
 *
 * Only EAST and WEST are ever assigned here. A feedback edge that ends up
 * needing the bottom lane is moved to SOUTH *after* the layout, because whether
 * it needs one depends on where ELK put its endpoints relative to each other
 * (9.2), which is not knowable yet.
 */
export function assignRenderPorts(graph: ProjectedGraph): PortSpec[] {
  type Assigned = { edgeId: string; end: PortEnd; semanticPortId?: string }
  const bySide = new Map<string, Assigned[]>()

  const add = (nodeId: string, side: 'EAST' | 'WEST', entry: Assigned): void => {
    const key = `${nodeId}\u0000${side}`
    const bucket = bySide.get(key)
    if (bucket === undefined) bySide.set(key, [entry])
    else bucket.push(entry)
  }

  for (const edge of graph.edges) {
    add(edge.source, 'EAST', {
      edgeId: edge.id,
      end: 'source',
      ...(edge.sourceHandle === undefined ? {} : { semanticPortId: edge.sourceHandle }),
    })
    add(edge.target, 'WEST', {
      edgeId: edge.id,
      end: 'target',
      ...(edge.targetHandle === undefined ? {} : { semanticPortId: edge.targetHandle }),
    })
  }

  const specs: PortSpec[] = []
  for (const [key, entries] of bySide) {
    const separator = key.indexOf('\u0000')
    const nodeId = key.slice(0, separator)
    const side = key.slice(separator + 1) as 'EAST' | 'WEST'
    entries.forEach((entry, index) => {
      specs.push({
        id: renderPortId(entry.edgeId, entry.end),
        nodeId,
        end: entry.end,
        side,
        order: index,
        count: entries.length,
        ...(entry.semanticPortId === undefined ? {} : { semanticPortId: entry.semanticPortId }),
      })
    })
  }

  return specs
}

/**
 * Where a port sits on a node of this size, in node-local coordinates.
 *
 * The `(order + 1) / (count + 1)` distribution is the one the old handle code
 * used, kept because it is already the tested contract: never flush with a
 * corner, and even spacing for any count. What changed is the unit — pixels of
 * a box the layout actually produced, rather than a percentage of whatever the
 * browser happened to measure.
 */
export function localPortPosition(spec: PortSpec, size: NodeSize): ElkPoint {
  const fraction = (spec.order + 1) / (spec.count + 1)
  if (spec.side === 'SOUTH') return { x: fraction * size.width, y: size.height }
  const y = fraction * size.height
  return spec.side === 'WEST' ? { x: 0, y } : { x: size.width, y }
}

export function portsOfNode(specs: readonly PortSpec[], nodeId: string): PortSpec[] {
  return specs.filter((spec) => spec.nodeId === nodeId)
}

/**
 * Turns declared specs into placed ports, given where each port ended up
 * locally and where its node ended up in the drawing.
 *
 * The local positions come from one of two producers, and which one matters:
 *
 *   - ELK ran. Its answer wins, for *every* port, including the ones whose
 *     coordinates we declared ourselves. A leaf's declare-and-echo round trip
 *     returns what we sent, so reading it back is the same number — but a
 *     container's size is ELK's output, so its ports are placed by ELK's own
 *     `FIXED_SIDE` distribution, which is not our formula and must not be
 *     second-guessed. Recomputing from the box here would put the drawn handle
 *     somewhere the route does not end, which is the defect this pass removes.
 *   - The layout fell back (`fallbackLayout`). There is no ELK answer, so the
 *     caller passes `localPortPosition` for every port.
 *
 * A port whose node or local position is missing is dropped rather than placed
 * at the origin: a port at (0,0) would draw a confident handle in the corner of
 * the canvas for an edge that has none.
 */
export function resolvePortCoordinates(
  specs: readonly PortSpec[],
  localByPortId: ReadonlyMap<string, ElkPoint>,
  /** Only the placement is read here, so any box shape will do. */
  boxes: ReadonlyMap<string, { x: number; y: number }>,
): LayoutPort[] {
  const ports: LayoutPort[] = []

  for (const spec of specs) {
    const box = boxes.get(spec.nodeId)
    const local = localByPortId.get(spec.id)
    if (box === undefined || local === undefined) continue

    ports.push({
      id: spec.id,
      nodeId: spec.nodeId,
      end: spec.end,
      side: spec.side,
      order: spec.order,
      x: box.x + local.x,
      y: box.y + local.y,
      ...(spec.semanticPortId === undefined ? {} : { semanticPortId: spec.semanticPortId }),
    })
  }

  return ports
}

export function portsById(ports: readonly LayoutPort[]): Map<string, LayoutPort> {
  return new Map(ports.map((port) => [port.id, port]))
}
