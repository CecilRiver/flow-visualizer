import { GRAPH_READABILITY } from './readabilityOptions'

/**
 * The rectangle the initial fit has to cover (GRAPH_READABILITY_DESIGN.md 11).
 *
 * ELK reports a width and a height for the graph, but those describe the
 * *shapes* it placed. Edge labels are HTML that Vue Flow teleports outside the
 * SVG, positioned in graph coordinates — so a fit driven by ELK's own extent
 * leaves the rightmost and bottom-most labels hanging off the canvas, which is
 * the symptom the design document opens with.
 *
 * So the extent is computed here, from everything that will be drawn.
 */

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

const VIEWPORT = GRAPH_READABILITY.viewport

/**
 * Clearance kept between the drawing and the canvas edge.
 *
 * Not symmetric: the top and left need only keep the outermost shape off the
 * border, while the right and bottom have to clear the minimap, which sits over
 * the bottom-right corner of the canvas.
 */
export const BOUNDS_MARGIN = {
  top: VIEWPORT.topPadding,
  right: VIEWPORT.rightPadding,
  bottom: VIEWPORT.bottomPadding,
  left: VIEWPORT.leftPadding,
} as const

/** The box containing two boxes. */
export function unionBox(first: Box, second: Box): Box {
  const x = Math.min(first.x, second.x)
  const y = Math.min(first.y, second.y)
  return {
    x,
    y,
    width: Math.max(first.x + first.width, second.x + second.width) - x,
    height: Math.max(first.y + first.height, second.y + second.height) - y,
  }
}

/** The smallest box containing every point, path point included. */
export function shapeBounds(
  nodes: readonly Box[],
  paths: readonly (readonly Point[])[] = [],
): Box {
  let box: Box | null = null

  const absorb = (candidate: Box): void => {
    box = box === null ? candidate : unionBox(box, candidate)
  }

  for (const node of nodes) {
    absorb(node)
  }

  for (const path of paths) {
    for (const point of path) {
      absorb({ x: point.x, y: point.y, width: 0, height: 0 })
    }
  }

  return box ?? { x: 0, y: 0, width: 0, height: 0 }
}

/**
 * The extent the first fit must cover: the shapes, plus every label that will
 * actually be drawn, plus the clearance around the lot.
 *
 * `labels` is the *visible* set. A label the placement pass decided not to draw
 * is not covered, because fitting to something invisible would zoom the graph
 * out for nothing — and a hidden label coming back at a higher zoom would then
 * be off-canvas again.
 */
export function layoutBounds(shape: Box, labels: readonly Box[] = []): Box {
  let box = shape
  for (const label of labels) box = unionBox(box, label)

  return {
    x: box.x - BOUNDS_MARGIN.left,
    y: box.y - BOUNDS_MARGIN.top,
    width: box.width + BOUNDS_MARGIN.left + BOUNDS_MARGIN.right,
    height: box.height + BOUNDS_MARGIN.top + BOUNDS_MARGIN.bottom,
  }
}
