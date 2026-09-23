import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Measures the drawn graph so label placement can be judged by geometry rather
 * than by looking at a screenshot (GRAPH_READABILITY_DESIGN.md 17.4).
 *
 * Everything here reads real `getBoundingClientRect` values out of the page. It
 * deliberately does not re-derive label boxes from the layout result: the point
 * of this module is to catch the case where the layout believes a label fits
 * and the browser disagrees.
 *
 * The first few exports are the exception: they drive the view rather than
 * measure it. They live here because every measurement below needs the same
 * precondition — a settled viewport for the level being looked at — and two
 * specs now need it, so it is written once.
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

/** The node count each projection is expected to draw, groups included (16 = 11 + 5). */
export const DRAWN_NODES = { 0: 4, 1: 9, 2: 16 } as const

/** The level button, found by its `L{n}` badge rather than by position. */
export function levelButton(page: Page, level: 0 | 1 | 2): Locator {
  return page.locator('.level-switcher__option', { hasText: `L${String(level)}` })
}

/** The transform Vue Flow is applying to the graph, as `scale(...)`. */
export async function viewportTransform(page: Page): Promise<string> {
  return page.evaluate(
    () => document.querySelector<HTMLElement>('.vue-flow__transformationpane')?.style.transform ?? '',
  )
}

/**
 * Waits for the viewport to stop moving after a level change.
 *
 * The fit is applied asynchronously, and the node count settles before it does.
 * Measuring in between reads the previous graph's framing, which is exactly the
 * defect 11 is about — so the transform has to be seen to hold still, not
 * merely to have been set once. A screenshot taken in that gap is just as
 * wrong, which is why this is shared rather than private to the measurement.
 */
export async function waitForViewportSettled(page: Page): Promise<void> {
  let previous = await viewportTransform(page)
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.waitForTimeout(50)
    const current = await viewportTransform(page)
    if (current !== '' && current === previous) return
    previous = current
  }
}

/**
 * Switches projection and waits for the redraw to land.
 *
 * The `aria-pressed` flag flips on the click, while the node boxes are replaced
 * asynchronously by the layout. Waiting on the settled node count is what keeps
 * a measurement from landing on the previous level's geometry.
 */
export async function switchToLevel(page: Page, level: 0 | 1 | 2): Promise<void> {
  await levelButton(page, level).click()
  await expect(levelButton(page, level)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.vue-flow__node')).toHaveCount(DRAWN_NODES[level])
  await waitForViewportSettled(page)
}

/** The viewport transform, decomposed. */
export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** Reads `translate(...)px scale(...)` back into numbers. */
export async function readViewport(page: Page): Promise<Viewport> {
  const transform = await viewportTransform(page)
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(transform)
  if (match === null) throw new Error(`无法解析视口变换：${transform}`)
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) }
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

/** A label box that does not fit inside the box it is drawn in. */
export interface ClippedLabel {
  edgeId: string
  /** Which edge of `inside` the label crosses. */
  side: 'left' | 'top' | 'right' | 'bottom'
  /** How far past it, in CSS pixels. Negative means fully clear. */
  overflow: number
}

/**
 * Labels that are drawn outside the box they are supposed to live in
 * (GRAPH_READABILITY_DESIGN.md 18.5).
 *
 * The overlap measurement above asks whether a label covers something else. This
 * asks the opposite question — whether the reader can see the label at all. A
 * box pushed past the canvas edge, or under the Inspector panel, is not an
 * overlap with anything: it is simply gone, and no collision assertion can
 * notice, because a label nobody can see collides with nothing.
 *
 * `tolerance` is in CSS pixels and is not decoration. Sub-pixel rounding on a
 * scaled viewport routinely puts a label a fraction of a pixel past the edge,
 * and a strict comparison would report every flush-fitting label as clipped.
 */
export function findClippedLabels(
  labels: readonly LabelBox[],
  inside: Rect,
  tolerance = 1,
): ClippedLabel[] {
  const clipped: ClippedLabel[] = []

  for (const label of labels) {
    const overflow = {
      left: inside.x - label.x,
      top: inside.y - label.y,
      right: label.x + label.width - (inside.x + inside.width),
      bottom: label.y + label.height - (inside.y + inside.height),
    }
    for (const [side, amount] of Object.entries(overflow) as Array<
      [ClippedLabel['side'], number]
    >) {
      if (amount > tolerance) clipped.push({ edgeId: label.edgeId, side, overflow: amount })
    }
  }

  return clipped
}

/** One line per clipped label, in the shape a test failure should read. */
export function formatClipped(labels: readonly ClippedLabel[]): string[] {
  return labels.map(
    (label) => `${label.edgeId} 被裁切：越过 ${label.side} ${label.overflow.toFixed(1)}px`,
  )
}

/** Where an edge's route starts and ends, as the browser paints it. */
export interface DrawnEnds {
  edgeId: string
  feedback: boolean
  /**
   * The route's final point in viewport coordinates.
   *
   * This is the arrowhead's tip. Vue Flow's marker is an `ArrowClosed` polyline
   * whose tip vertex is at the marker's own origin, and the marker's `refX`/
   * `refY` are 0, so the tip is placed exactly on the path's last point. Reading
   * it off the path is therefore a measurement of the drawn arrow, not a
   * restatement of the marker slot it was configured with.
   */
  tip: { x: number; y: number }
  start: { x: number; y: number }
  /** The edge's endpoints, from the schema rather than from the geometry. */
  source: string
  target: string
}

/**
 * Every drawn route's two ends, joined with the endpoints the projection named.
 *
 * The names come from the label's own `data-source`/`data-target`, which the
 * renderer copies straight from the projected edge. They are not parsed out of
 * the edge id: a container id contains colons of its own, so splitting on them
 * would misread exactly the edges whose endpoints are groups.
 *
 * A label is only in the DOM once the zoom is past the hidden threshold, so the
 * caller has to have zoomed in — see `zoomUntilLabelsAreDrawn`.
 */
export async function collectDrawnEnds(page: Page): Promise<DrawnEnds[]> {
  return page.evaluate(() => {
    const named = new Map<string, { source: string; target: string }>()
    for (const label of document.querySelectorAll('.semantic-edge__label')) {
      const edgeId = label.getAttribute('data-edge-id')
      if (edgeId === null) continue
      named.set(edgeId, {
        source: label.getAttribute('data-source') ?? '',
        target: label.getAttribute('data-target') ?? '',
      })
    }

    const ends: Array<{
      edgeId: string
      feedback: boolean
      tip: { x: number; y: number }
      start: { x: number; y: number }
      source: string
      target: string
    }> = []

    for (const group of document.querySelectorAll('.semantic-edge')) {
      const path = group.querySelector<SVGPathElement>('.semantic-edge__line')
      if (path === null) continue
      const matrix = path.getScreenCTM()
      if (matrix === null) continue
      const total = path.getTotalLength()
      if (total === 0) continue

      const edgeId = group.getAttribute('data-edge-id') ?? ''
      const endpoint = named.get(edgeId)
      const at = (length: number): { x: number; y: number } => {
        const local = path.getPointAtLength(length)
        const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix)
        return { x: screen.x, y: screen.y }
      }

      ends.push({
        edgeId,
        feedback: group.classList.contains('is-feedback'),
        tip: at(total),
        start: at(0),
        source: endpoint?.source ?? '',
        target: endpoint?.target ?? '',
      })
    }

    return ends
  })
}

