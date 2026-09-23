import { expect } from 'vitest'

import type { LaidOutEdge } from '@/layout/elkLayout'
import { sectionPolyline } from '@/layout/elkLayout'
import type { LayoutPort } from '@/layout/layoutPorts'

/**
 * Route geometry invariants (GRAPH_READABILITY_DESIGN.md 17.2, 18.3).
 *
 * The two defects this file exists to catch are both invisible in a screenshot:
 * a route that stops a few pixels short of the port it claims to attach to, and
 * a route whose first segment leaves the port at an angle. Both look like a
 * styling detail at normal zoom and both are the same root cause — the drawn
 * geometry and the routed geometry being computed separately.
 *
 * They are asserted over a whole layout rather than per test because the failure
 * is per edge: one edge out of twenty attaching to the wrong point is exactly
 * what a spot check misses.
 */

export interface Point {
  readonly x: number
  readonly y: number
}

/** Distance between two points, for the tolerance check. */
function distance(first: Point, second: Point): number {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

/** Every edge whose route does not begin and end on its own render ports. */
export function endpointDefects(
  edges: readonly LaidOutEdge[],
  ports: readonly LayoutPort[],
  /** In CSS pixels; 18.3 allows one. */
  tolerance = 1,
): string[] {
  const byPortId = new Map(ports.map((port) => [port.id, port]))
  const defects: string[] = []

  for (const edge of edges) {
    // An edge with no sections is the degraded case, and 9.3.1 routes it from
    // the ports by construction — there is no ELK answer to check it against.
    if (edge.sections.length === 0) continue

    const first = edge.sections[0]
    const last = edge.sections[edge.sections.length - 1]
    if (first === undefined || last === undefined) continue

    const source = byPortId.get(edge.sourcePortId)
    const target = byPortId.get(edge.targetPortId)
    if (source === undefined || target === undefined) {
      defects.push(`${edge.id}: 端口缺失（${edge.sourcePortId} → ${edge.targetPortId}）`)
      continue
    }

    const startGap = distance(first.startPoint, source)
    if (startGap > tolerance) {
      defects.push(
        `${edge.id}: 起点偏离 source 端口 ${startGap.toFixed(2)}px ` +
          `(${first.startPoint.x},${first.startPoint.y}) vs (${source.x},${source.y})`,
      )
    }

    const endGap = distance(last.endPoint, target)
    if (endGap > tolerance) {
      defects.push(
        `${edge.id}: 终点偏离 target 端口 ${endGap.toFixed(2)}px ` +
          `(${last.endPoint.x},${last.endPoint.y}) vs (${target.x},${target.y})`,
      )
    }
  }

  return defects
}

/**
 * Every route segment that is neither horizontal nor vertical.
 *
 * A diagonal is what the eye reads as "the line is not attached properly", and
 * it is the one thing an orthogonal router must never produce. Reported with the
 * offending pair so a failure names the geometry rather than a count.
 */
export function diagonalSegments(edges: readonly LaidOutEdge[]): string[] {
  const defects: string[] = []

  for (const edge of edges) {
    for (const [index, section] of edge.sections.entries()) {
      const points = sectionPolyline(section)
      for (let step = 0; step + 1 < points.length; step += 1) {
        const from = points[step]
        const to = points[step + 1]
        if (from === undefined || to === undefined) continue
        if (from.x === to.x || from.y === to.y) continue
        defects.push(
          `${edge.id} 第 ${String(index)} 段: ` +
            `(${from.x},${from.y}) → (${to.x},${to.y})`,
        )
      }
    }
  }

  return defects
}

/** Asserts every routed edge starts and ends on its own render ports (18.3). */
export function expectEndpointsOnPorts(
  edges: readonly LaidOutEdge[],
  ports: readonly LayoutPort[],
  label: string,
  tolerance = 1,
): void {
  expect(endpointDefects(edges, ports, tolerance), `${label} 端点未落在 render port 上`).toEqual([])
}

/** Asserts no route contains a diagonal segment (9.1, 18.3). */
export function expectOrthogonal(edges: readonly LaidOutEdge[], label: string): void {
  expect(diagonalSegments(edges), `${label} 存在斜穿段`).toEqual([])
}
