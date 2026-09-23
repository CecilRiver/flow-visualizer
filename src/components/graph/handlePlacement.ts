import { Position } from '@vue-flow/core'

import type { NodePortHandle } from '@/adapters/vueFlow/nodeTypes'
import type { PortSide } from '@/layout/layoutPorts'

/**
 * Placing a Vue Flow handle where the layout put the port
 * (GRAPH_READABILITY_DESIGN.md 7.3).
 *
 * Vue Flow positions a handle from its `position` prop, and the stylesheet does
 * the arithmetic: `.vue-flow__handle-left` sets `left: 0; top: 50%` and pulls
 * the dot back by half its width, and so on. That is fine for the one
 * centre-anchored handle per side it was written for, and wrong for every port
 * a real node has.
 *
 * So the position is set outright, in pixels, from the layout's own coordinates.
 * The inline style has to be complete — `left`, `top`, the two `auto`s and the
 * transform — because a class rule that survives alongside it would pin the
 * handle to an edge the layout never chose.
 */

const POSITION_FOR_SIDE: Record<PortSide, Position> = {
  WEST: Position.Left,
  EAST: Position.Right,
  SOUTH: Position.Bottom,
}

/**
 * Which side of the node the handle is anchored to.
 *
 * Cosmetic under the override above, but Vue Flow reads it when it computes a
 * handle's bounds, and leaving it at the default would describe the handle as
 * arriving from the wrong side.
 */
export function handlePosition(side: PortSide): Position {
  return POSITION_FOR_SIDE[side]
}

/**
 * The handle's position inside the node, in pixels.
 *
 * `translate(-50%, -50%)` makes `x`/`y` the port's own point rather than its
 * top-left corner, so the dot is centred on the coordinate the route ends at.
 * Anything else would leave the line stopping half a handle short of the dot.
 */
export function handleStyle(port: NodePortHandle): Record<string, string> {
  return {
    left: `${String(port.x)}px`,
    top: `${String(port.y)}px`,
    right: 'auto',
    bottom: 'auto',
    transform: 'translate(-50%, -50%)',
  }
}
