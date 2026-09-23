import type { Page } from '@playwright/test'

/**
 * Measures the drawn graph so label placement can be judged by geometry rather
 * than by looking at a screenshot (GRAPH_READABILITY_DESIGN.md 17.4).
 *
 * Everything here reads real `getBoundingClientRect` values out of the page. It
 * deliberately does not re-derive label boxes from the layout result: the point
 * of this module is to catch the case where the layout believes a label fits
 * and the browser disagrees.
 */

/** A rectangle in viewport coordinates, as the browser reports it. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A drawn node box, tagged with the node it belongs to. */
export interface NodeBox extends Rect {
  id: string
  /**
   * A display group: a translucent box drawn *around* other nodes.
   *
   * A label inside one covers nothing, because the container is a background
   * and its children paint on top of it. Counting these as overlaps reported 15
   * phantom defects at L2 and buried the two real ones.
   */
  container: boolean
}

/** A drawn edge label box, tagged with the edge it belongs to. */
export interface LabelBox extends Rect {
  edgeId: string
  text: string
  /** The node the edge leaves, so an overlap with it can be told apart. */
  source: string
  target: string
}

/** One drawn edge line, sampled along its own path. */
export interface DrawnLine {
  edgeId: string
  feedback: boolean
  /**
   * Points along the line as it is actually painted, in viewport coordinates.
   *
   * Read back from the SVG geometry rather than from the layout result: the
   * whole point is to measure the line the reader sees, which is the one thing
   * the layout cannot vouch for. `getScreenCTM` folds in Vue Flow's viewport
   * transform, so these are directly comparable with `getBoundingClientRect`.
   */
  points: Array<{ x: number; y: number }>
}

/** Two things that must not share pixels, and the area they do share. */
export interface Overlap {
  kind: 'label-node' | 'label-label'
  a: string
  b: string
  area: number
  /**
   * `label-node` only: the node is one of this label's own endpoints.
   *
   * GRAPH_READABILITY_DESIGN.md 10 exempts exactly these, and only these — a
   * label touching the node it belongs to is not hiding information, because
   * the endpoints are where the reader already is. An overlap with any *other*
   * node is the defect.
   */
  endpoint: boolean
}

/** The two rectangles' intersection area, or 0 when they are disjoint. */
export function intersectionArea(first: Rect, second: Rect): number {
  const width = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x)
  const height = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y)
  // Touching edges share no area: a zero or negative extent is not an overlap,
  // and treating it as one would flag every label that sits flush against a node.
  return width > 0 && height > 0 ? width * height : 0
}

/** Every edge label currently in the DOM, in document order. */
export async function collectLabelBoxes(page: Page): Promise<LabelBox[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.semantic-edge__label')].flatMap((element) => {
      const rect = element.getBoundingClientRect()
      // A label with no box is not drawn (a hidden ancestor), and reporting it
      // at 0x0 would invent an overlap at the viewport origin.
      if (rect.width === 0 || rect.height === 0) return []
      return [
        {
          edgeId: element.getAttribute('data-edge-id') ?? '',
          source: element.getAttribute('data-source') ?? '',
          target: element.getAttribute('data-target') ?? '',
          text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
      ]
    }),
  )
}

/** Every node box currently in the DOM, in document order. */
export async function collectNodeBoxes(page: Page): Promise<NodeBox[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.vue-flow__node')].flatMap((element) => {
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return []
      return [
        {
          id: element.getAttribute('data-id') ?? '',
          // Identified by the renderer's own root class rather than by the
          // `ui-group:` id prefix, so a change to id shaping cannot silently
          // turn every group back into a node.
          container: element.querySelector('.domain-group') !== null,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
      ]
    }),
  )
}

/**
 * Every drawn edge line, sampled along the path the browser actually paints.
 *
 * Sampling rather than reading the endpoints: the claim being checked is about
 * where the *whole* line runs, and a route that leaves a node's side, drops into
 * the feedback channel and comes back has endpoints exactly where a direct route
 * would have had them. Only the points in between tell the two apart.
 *
 * The step is 8px of path. Finer would measure antialiasing; coarser could step
 * over the dip a lane is made of.
 */
export async function collectDrawnLines(page: Page): Promise<DrawnLine[]> {
  return page.evaluate(() => {
    const lines: Array<{
      edgeId: string
      feedback: boolean
      points: Array<{ x: number; y: number }>
    }> = []

    for (const group of document.querySelectorAll('.semantic-edge')) {
      const path = group.querySelector<SVGPathElement>('.semantic-edge__line')
      if (path === null) continue
      const matrix = path.getScreenCTM()
      if (matrix === null) continue
      const total = path.getTotalLength()
      // A zero-length path has no route to measure; reporting a single point at
      // the origin would invent geometry.
      if (total === 0) continue

      const steps = Math.max(2, Math.ceil(total / 8))
      const points: Array<{ x: number; y: number }> = []
      for (let step = 0; step <= steps; step += 1) {
        const local = path.getPointAtLength((total * step) / steps)
        const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix)
        points.push({ x: screen.x, y: screen.y })
      }

      lines.push({
        edgeId: group.getAttribute('data-edge-id') ?? '',
        feedback: group.classList.contains('is-feedback'),
        points,
      })
    }

    return lines
  })
}

/**
 * Every place a label covers a node or another label.
 *
 * `tolerance` is an area in square CSS pixels, not a fraction: sub-pixel
 * antialiasing on a rotated or scaled viewport routinely leaks a fraction of a
 * pixel between boxes that are visually clear of each other, and a strict `> 0`
 * test would report that as a defect.
 */
export function findOverlaps(
  labels: readonly LabelBox[],
  nodes: readonly NodeBox[],
  tolerance = 1,
): Overlap[] {
  const overlaps: Overlap[] = []

  for (const label of labels) {
    for (const node of nodes) {
      // A container is a background, not an obstacle. Its own title is the one
      // part of it that text could hide, and that is a much smaller target than
      // the box; flagging the whole box would drown the real defects.
      if (node.container) continue
      const area = intersectionArea(label, node)
      if (area > tolerance) {
        overlaps.push({
          kind: 'label-node',
          a: label.edgeId,
          b: node.id,
          area,
          endpoint: node.id === label.source || node.id === label.target,
        })
      }
    }
  }

  for (let a = 0; a < labels.length; a += 1) {
    for (let b = a + 1; b < labels.length; b += 1) {
      const first = labels[a]
      const second = labels[b]
      if (first === undefined || second === undefined) continue
      const area = intersectionArea(first, second)
      if (area > tolerance) {
        // Two labels never belong to each other, so endpoint exemption cannot
        // apply to a label-label pair.
        overlaps.push({
          kind: 'label-label',
          a: first.edgeId,
          b: second.edgeId,
          area,
          endpoint: false,
        })
      }
    }
  }

  // Worst first: a report that leads with a half-pixel graze buries the label
  // that is sitting on top of a node.
  return overlaps.sort((left, right) => right.area - left.area)
}

/** What the drawn graph looks like right now, in one value. */
export interface ReadabilityReport {
  labelCount: number
  nodeCount: number
  /** Overlaps with a node the label does not belong to. These are the defects. */
  labelNodeOverlaps: Overlap[]
  /** Overlaps with the label's own endpoints, which section 10 permits. */
  labelEndpointOverlaps: Overlap[]
  labelLabelOverlaps: Overlap[]
}

/** Measures the current view and classifies its label defects. */
export async function measureReadability(page: Page): Promise<ReadabilityReport> {
  const [labels, nodes] = await Promise.all([collectLabelBoxes(page), collectNodeBoxes(page)])
  const overlaps = findOverlaps(labels, nodes)
  const labelNodes = overlaps.filter((overlap) => overlap.kind === 'label-node')

  return {
    labelCount: labels.length,
    nodeCount: nodes.length,
    labelNodeOverlaps: labelNodes.filter((overlap) => !overlap.endpoint),
    labelEndpointOverlaps: labelNodes.filter((overlap) => overlap.endpoint),
    labelLabelOverlaps: overlaps.filter((overlap) => overlap.kind === 'label-label'),
  }
}

/** One line per overlap, in the shape a test failure should read. */
export function formatOverlaps(kind: string, overlaps: readonly Overlap[]): string[] {
  return overlaps.map(
    (overlap) => `${kind} ${overlap.a} × ${overlap.b} (${overlap.area.toFixed(0)}px²)`,
  )
}
