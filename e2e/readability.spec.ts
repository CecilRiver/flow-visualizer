import { expect, test, type Page } from '@playwright/test'

import { installDirectoryPickerMock } from './support/directoryPicker'
import { loadFixtureFolder } from './support/fixtures'
import {
  collectDrawnEnds,
  collectDrawnLines,
  collectNodeBoxes,
  findClippedLabels,
  formatClipped,
  formatOverlaps,
  measureReadability,
  readViewport,
  switchToLevel,
  waitForViewportSettled,
  type LabelBox,
  type Rect,
} from './support/readability'

/**
 * GRAPH_READABILITY_DESIGN.md 17.4: the drawn graph is measured, not eyeballed.
 *
 * These assertions are about geometry the reader actually experiences — does a
 * label cover a node, do two labels cover each other, does the first fit frame
 * the graph. They are deliberately *not* about ELK's pixel coordinates, which
 * are not a contract (DESIGN.md 19.3).
 *
 * The measurement runs at both configured viewports: the compact width is where
 * the right-hand labels are most likely to be clipped, so testing only the
 * desktop width would miss the case the design document is about.
 *
 * ## Why the label tests zoom in first
 *
 * Two rules in the design document pull against each other on this model. 11
 * says the first fit must cover the labels so none is clipped; 5.3 says a label
 * is not drawn at all below zoom 0.55. Fitting is driven by the labels, so on a
 * wide graph the fit lands below that zoom and every label is hidden.
 *
 * The numbers, measured on the real Stabilize model: the L1 drawing is 3465px
 * wide and L2 is 6457px, so a 1440px canvas fits them at about 0.37 and 0.20 —
 * both under the threshold, and further under it at the compact viewport.
 *
 * The resolution taken is that both rules stand: the default view is an
 * overview, and inline labels belong to the reading zoom the reader reaches by
 * zooming in. So the overlap tests zoom in until the labels are drawn before
 * measuring. Measuring at the default zoom would find no labels at all, and the
 * `labelCount` guard below would fail for a reason that has nothing to do with
 * collisions.
 */

const LEVELS = [0, 1, 2] as const

/**
 * How much of the canvas width a correctly fitted drawing has to span.
 *
 * A fit frames its own bounds, so a correctly framed drawing fills nearly the
 * whole canvas whatever the model. Measured here: 0.88 / 0.87 (L1, after a level
 * change) and 0.90 / 0.93 (L2, the first fit), desktop / compact.
 *
 * The bound sits well below that range, because it is not a layout contract —
 * only a guard against a box that is wrong by a factor rather than by a pixel.
 * What makes 0.7 discriminating is the arithmetic: the canvas is about 1169px
 * wide, so on a stale L2 viewport (scale 0.163) the L1 drawing would span
 * 3465 × 0.163 ≈ 565px, a ratio of 0.48. The defect this file guards against
 * fails this assertion by a wide margin, not by a hair.
 */
const FILL_BOUND = 0.7

/** The share of the canvas width the drawn nodes span. */
function fillRatio(nodes: readonly { x: number; width: number }[], canvasWidth: number): number {
  const left = Math.min(...nodes.map((node) => node.x))
  const right = Math.max(...nodes.map((node) => node.x + node.width))
  return (right - left) / canvasWidth
}

/**
 * Zooms in until the inline edge labels are drawn, and leaves the view still.
 *
 * Driven through the real control rather than by calling `zoomTo`, so the
 * labels have to appear by the path a reader would take. The loop is bounded,
 * and the assertion after it is what fails if they never do — a cap that
 * silently gave up would turn "the labels never appeared" into a pass.
 *
 * The zoom itself is instant — Vue Flow's `<Controls>` calls `zoomIn()` with no
 * options, which resolves to a d3 transition of duration 0 — so the labels
 * appear on the click. The wait afterwards is not about that; it is the same
 * guard the level switch uses, and it costs one settle interval to keep a
 * measurement from landing on a transform that is one frame behind the DOM.
 */
async function zoomUntilLabelsAreDrawn(page: Page): Promise<void> {
  const label = page.locator('.semantic-edge__label')
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if ((await label.count()) > 0) break
    await page.locator('.vue-flow__controls-zoomin').click()
    await page.waitForTimeout(40)
  }
  await waitForViewportSettled(page)
}

/** Distance from a point to a rectangle, 0 when the point is inside it. */
function distanceToRect(point: { x: number; y: number }, rect: Rect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width))
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height))
  return Math.hypot(dx, dy)
}

/** A point drawn on a route, in viewport coordinates. */
interface RoutePoint {
  edgeId: string
  x: number
  y: number
}

/** Where along the route the samples are taken, as a fraction of its length. */
const ROUTE_SAMPLES = [0.5, 0.35, 0.65, 0.2, 0.8] as const

/**
 * Points drawn on each route, in viewport coordinates.
 *
 * Read from the painted geometry rather than from the edge's endpoints, so a
 * point is somewhere a pointer click genuinely lands on the route — which is
 * what "the edge is still clickable" means. `getScreenCTM` folds in the current
 * pan and zoom, so the result is directly comparable with a bounding box.
 *
 * Several samples per route, and the caller picks: a route runs under the nodes
 * it connects, and clicking the part that is underneath one selects the node.
 * The order puts the midpoint first so the obvious point wins when it is free.
 */
async function routeSamplePoints(page: Page): Promise<RoutePoint[]> {
  return page.evaluate((fractions) => {
    const points: Array<{ edgeId: string; x: number; y: number }> = []
    for (const group of document.querySelectorAll('.semantic-edge')) {
      const path = group.querySelector<SVGPathElement>('.semantic-edge__hit')
      const matrix = path?.getScreenCTM() ?? null
      if (path === null || matrix === null) continue
      const total = path.getTotalLength()
      if (total === 0) continue

      const edgeId = group.getAttribute('data-edge-id') ?? ''
      for (const fraction of fractions) {
        const local = path.getPointAtLength(total * fraction)
        const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix)
        points.push({ edgeId, x: screen.x, y: screen.y })
      }
    }
    return points
  }, [...ROUTE_SAMPLES])
}

/** Whether a point is inside a box. */
function isInside(point: { x: number; y: number }, box: Rect): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  )
}

/**
 * An edge a pointer can actually click right now.
 *
 * Three things have to line up, and none of them is guaranteed at this graph
 * size. The route needs a sample inside the canvas — the drawing is 6457px wide
 * against a canvas of about 1160, so at any zoom most of it is off screen. The
 * edge has to be one `named` allows, which is how a caller asks for a particular
 * kind of edge. And the point has to be the topmost thing under the cursor.
 *
 * That last question is asked of the browser rather than reconstructed from
 * geometry. Nodes paint above edges, and the canvas carries overlays of its own
 * — the legend, the minimap, the zoom controls, the disclaimer — so "outside
 * every node box" is not the same as "clickable". A run at the compact width
 * picked a point under the legend on the old check, and the click landed on the
 * legend without the test noticing until the Inspector failed to open.
 * `elementFromPoint` answers it exactly, being the same hit test the click does.
 *
 * A covered sample is skipped rather than asserted about: the claim is that a
 * reader can still click this edge, not that every pixel of the route is
 * reachable. What must not happen is the search coming back empty and passing.
 */
async function clickableRoutePoint(
  page: Page,
  named: ReadonlyMap<string, string>,
  canvas: Rect,
  only?: string,
): Promise<RoutePoint | null> {
  const samples = await routeSamplePoints(page)
  const candidates = samples.filter(
    (point) =>
      named.has(point.edgeId) &&
      (only === undefined || point.edgeId === only) &&
      isInside(point, canvas),
  )
  if (candidates.length === 0) return null

  return page.evaluate((points) => {
    for (const point of points) {
      // Whichever element paints on top at this pixel. Following it up to the
      // nearest `.semantic-edge` and comparing the id is what makes this a test
      // of the route rather than of "something clickable is here".
      const hit = document.elementFromPoint(point.x, point.y)
      if (hit?.closest('.semantic-edge')?.getAttribute('data-edge-id') === point.edgeId) {
        return point
      }
    }
    return null
  }, candidates)
}

test.describe('图可读性：标签几何', () => {
  test.beforeEach(async ({ page }) => {
    await installDirectoryPickerMock(page, [{ directory: loadFixtureFolder('valid') }])
    await page.goto('/')
    await page.getByRole('button', { name: '选择 flow 文件夹' }).click()
    await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 30_000 })
  })

  for (const level of LEVELS) {
    test(`L${level} 标签不与节点或别的标签相交`, async ({ page }, testInfo) => {
      await switchToLevel(page, level)
      await zoomUntilLabelsAreDrawn(page)

      const report = await measureReadability(page)

      await testInfo.attach(`readability-L${String(level)}`, {
        body: JSON.stringify(report, null, 2),
        contentType: 'application/json',
      })

      // Guards the assertions below: an empty measurement would satisfy them
      // without having looked at anything.
      expect(
        report.labelCount,
        `L${String(level)} 放大后仍然没有画出任何标签`,
      ).toBeGreaterThan(0)

      // One assertion for both categories, not one each: stopping at the first
      // failing category hides how much else is wrong, and the size of the
      // problem is the thing this measurement exists to report.
      const defects = [
        ...formatOverlaps('label-node', report.labelNodeOverlaps),
        ...formatOverlaps('label-label', report.labelLabelOverlaps),
      ]

      expect(defects, `L${String(level)} 标签几何缺陷`).toEqual([])
    })
  }

  test('切换层级后重新适应画布，而不是沿用上一层的视口', async ({ page }) => {
    /*
     * GRAPH_READABILITY_DESIGN.md 11.
     *
     * The defect this pins: `fit-view-on-init` fires once, guarded by an
     * internal "already done" flag, so after a level change the viewport stayed
     * framed for the previous graph. It is why the design document asks for an
     * explicit fit on every new LayoutResult.
     *
     * The measure is the *scale*, not containment. Containment alone does not
     * discriminate: a viewport left at L2's fit would draw L1 small and clustered
     * in the middle of the canvas, and every node would still be inside it. What
     * a re-fit changes is how much of the canvas the drawing occupies, and the
     * two levels differ enough for that to be decisive — L2 fits at 0.163 and
     * spans 6457px of graph, L1 fits at 0.303 and spans 3465px. Carrying L2's
     * scale over to L1 would leave the drawing at about half the canvas; a
     * correct L1 fit fills it.
     *
     * Measured here: 0.88 desktop, 0.87 compact — see `FILL_BOUND` for why the
     * bound is where it is, and what a stale viewport actually scores.
     */
    await switchToLevel(page, 1)

    const canvas = await page.locator('.explorer-view__canvas').boundingBox()
    expect(canvas).not.toBeNull()
    if (canvas === null) return

    const nodes = await collectNodeBoxes(page)
    expect(nodes.length).toBeGreaterThan(0)

    const outside = nodes.filter(
      (node) =>
        node.x < canvas.x ||
        node.y < canvas.y ||
        node.x + node.width > canvas.x + canvas.width ||
        node.y + node.height > canvas.y + canvas.height,
    )

    expect(
      outside.map((node) => node.id),
      '节点被画布裁切，说明切换层级后没有重新 fit',
    ).toEqual([])

    const ratio = fillRatio(nodes, canvas.width)
    expect(
      ratio,
      `切换层级后图形只占画布宽度的 ${ratio.toFixed(2)}，说明仍在用上一层的视口`,
    ).toBeGreaterThan(FILL_BOUND)
  })

  test('反馈边画在所有节点下方，与前向路线分开', async ({ page }) => {
    /*
     * GRAPH_READABILITY_DESIGN.md 9.2, 18.4.
     *
     * Asserted on the painted path, not on the layout result. A lane is a
     * *routing* decision — source and target meet the nodes at their bottom
     * edges and the line between them drops below the whole drawing — and both
     * halves of that are visible in the SVG `d` and nowhere else. The layout
     * could hold a perfectly good lane and the renderer still draw a straight
     * line between the same two endpoints, which is exactly the failure a
     * layout-only assertion cannot see.
     *
     * Viewport coordinates throughout: `getScreenCTM` folds the current pan and
     * zoom into the path points, so they are directly comparable with the node
     * rects. No zooming in is needed either, since lines are drawn at every
     * zoom — unlike the labels, whose tests have to zoom first (see the header).
     */
    await switchToLevel(page, 2)

    const [lines, nodes] = await Promise.all([collectDrawnLines(page), collectNodeBoxes(page)])
    expect(nodes.length).toBeGreaterThan(0)

    const deepestOf = (line: (typeof lines)[number]): number =>
      Math.max(...line.points.map((point) => point.y))
    const deepestNode = Math.max(...nodes.map((node) => node.y + node.height))

    // Not every feedback edge gets a lane, and that is 9.2's last paragraph
    // rather than an omission: only one that doubles back — source to the right
    // of target — needs the bottom channel. One that already runs forwards keeps
    // the ordinary ELK route, and forcing it into a lane would draw a detour
    // round the whole graph to say what a straight line already said.
    //
    // This model has exactly one of each, measured: at L2
    // `actuation.motor_mixer → control.attitude_rate` doubles back (source at
    // x=2355, target at 1865) and `estimation.attitude → control.attitude_rate`
    // does not. So the two halves below are both about real edges, not about an
    // empty list.
    const feedback = lines.filter((line) => line.feedback)
    expect(feedback.length, 'L2 没有画出任何反馈边，这条断言就失去意义').toBeGreaterThan(0)

    const laned = feedback.filter((line) => deepestOf(line) > deepestNode)
    expect(
      laned.map((line) => line.edgeId),
      '折返的反馈边没有走到所有节点下方的独立通道',
    ).not.toEqual([])

    // The other half of "separated": nothing else is in there. A channel the
    // forward traffic also uses would separate nothing, and the crossing it
    // exists to remove would be back.
    const intruding: string[] = []
    for (const line of lines) {
      if (line.feedback) continue
      const deepest = deepestOf(line)
      if (deepest > deepestNode) {
        intruding.push(
          `${line.edgeId} 最低到 y=${deepest.toFixed(1)}，越过了节点底部 ${deepestNode.toFixed(1)}`,
        )
      }
    }
    expect(intruding, '前向边进入了反馈通道').toEqual([])
  })

  test('首次 fit 由图形本身决定，没有被标签撑出的 bounds 压扁', async ({ page }) => {
    /*
     * The other half of 11, on the first fit rather than a re-fit.
     *
     * The fit's box is `shape ∪ labels ∪ margin`. A label the placement pass put
     * somewhere wild — at the graph origin, or a box that was never clamped — is
     * inside that union even though nothing is drawn at the default zoom, and
     * the fit answers by zooming the whole drawing down to a sliver. That is a
     * worse outcome than the clipping the union was added to fix, and no overlap
     * assertion can see it, because at this zoom there are no labels to overlap.
     *
     * No level is switched here: the point is the view the reader is given on
     * load, before touching anything, which is the fit the labels feed into.
     *
     * Measured on this model: 0.90 desktop, 0.93 compact — the arithmetic of
     * `shape + ~104px of margin`, so the labels are accounted for at their real
     * size rather than being inflated.
     */
    const canvas = await page.locator('.explorer-view__canvas').boundingBox()
    expect(canvas).not.toBeNull()
    if (canvas === null) return

    const nodes = await collectNodeBoxes(page)
    expect(nodes.length).toBeGreaterThan(0)

    const ratio = fillRatio(nodes, canvas.width)
    expect(
      ratio,
      `首次 fit 后图形只占画布宽度的 ${ratio.toFixed(2)}，bounds 被标签撑大了`,
    ).toBeGreaterThan(FILL_BOUND)
  })

  /*
   * GRAPH_READABILITY_DESIGN.md 11, 18.5.
   *
   * The sibling test above asks whether the fit was *ruined* by the labels — did
   * a wild box shrink the drawing to a sliver. This asks the opposite: was the
   * fit actually big enough for them. It is the reason the fit's box is
   * `shape ∪ labels ∪ margin` at all, and until now nothing checked it, because
   * the obvious measurement is impossible: at the fitted zoom every label is
   * hidden by 5.3, so there is no label box on screen to test.
   *
   * The measurement is therefore taken in two steps. The viewport at the fit is
   * recorded first; then the view is zoomed in until the labels are drawn and
   * each one's box is read in *graph* coordinates, which is what its inline
   * `left`/`top` already are — `EdgeLabelRenderer` teleports into the
   * transformed pane, so pan and zoom never touch those numbers. Mapping them
   * back through the recorded fit is then the question "would this label have
   * been inside the canvas, had it been drawn", which is the promise 11 makes.
   *
   * Reading the boxes at the reading zoom rather than trusting the layout is
   * deliberate: these are the boxes the browser actually paints, so a label the
   * renderer sizes differently from the layout's reservation fails here.
   */
  test('首次 fit 的视口足以容纳每一个标签盒（验收 5）', async ({ page }) => {
    const canvas = await page.locator('.explorer-view__canvas').boundingBox()
    expect(canvas).not.toBeNull()
    if (canvas === null) return

    const fit = await readViewport(page)
    const pane = await page.locator('.vue-flow__transformationpane').boundingBox()
    expect(pane).not.toBeNull()
    if (pane === null) return
    // Graph coordinates to the viewport the fit produced. The pane carries the
    // whole transform from its own origin — Vue Flow pins it to `transform-origin:
    // 0 0`, and graph (0,0) is that origin — so a graph point's screen position is
    // the pane's painted corner plus the point times the scale.
    const at = (graph: { x: number; y: number }) => ({
      x: pane.x + graph.x * fit.zoom,
      y: pane.y + graph.y * fit.zoom,
    })

    await zoomUntilLabelsAreDrawn(page)

    const graphBoxes = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.semantic-edge__label')].map((element) => ({
        edgeId: element.getAttribute('data-edge-id') ?? '',
        x: Number.parseFloat(element.style.left),
        y: Number.parseFloat(element.style.top),
        width: Number.parseFloat(element.style.width),
        height: Number.parseFloat(element.style.height),
      })),
    )
    expect(graphBoxes.length, '放大后没有画出任何标签，这条断言就没有意义').toBeGreaterThan(0)

    // `findClippedLabels` takes the same `LabelBox` the overlap measurement
    // uses, whose extra fields are about *what* a box covers. Nothing here asks
    // that question, so only the geometry is filled in — the sentinels keep the
    // shape honest without pretending to have read text that is not being read.
    const projected: LabelBox[] = graphBoxes.map((box) => {
      const topLeft = at({ x: box.x, y: box.y })
      const bottomRight = at({ x: box.x + box.width, y: box.y + box.height })
      return {
        edgeId: box.edgeId,
        text: '',
        source: '',
        target: '',
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      }
    })

    const clipped = findClippedLabels(projected, canvas)
    expect(
      formatClipped(clipped),
      '首次 fit 之后仍有标签落在画布之外，bounds 没有把标签算进去',
    ).toEqual([])
  })

  /*
   * GRAPH_READABILITY_DESIGN.md 5.3, 17.4(3).
   *
   * Two halves, and they are only meaningful together. Hiding the label is the
   * cheap half; the claim is that hiding it costs the reader nothing, because
   * the edge is still there to be clicked and the Inspector still states the
   * flow in full. The zoom steps out only just past the threshold rather than all
   * the way back to the fit, so the route is still a comfortable click target —
   * the point is the label's absence, not a 2px line.
   *
   * The click is a real pointer click at a point measured on the painted route,
   * not `locator.click()`. At L2 the drawing is 6457px wide and the canvas is
   * about 1160, so most routes are legitimately off-screen and a locator click
   * would be asking Playwright to click something the reader could not. Picking
   * the point first is also what makes the assertion about *this* edge: the
   * point is taken from the route it names.
   */
  test('缩小到阈值以下标签隐藏，边仍可点击并给出完整名称', async ({ page }) => {
    await switchToLevel(page, 2)
    await zoomUntilLabelsAreDrawn(page)

    const labels = page.locator('.semantic-edge__label')
    await expect(labels.first()).toBeVisible()

    const canvas = await page.locator('.explorer-view__canvas').boundingBox()
    expect(canvas).not.toBeNull()
    if (canvas === null) return

    /*
     * The edge to click is chosen, not taken by position.
     *
     * Two things have to be true of it at once, and neither is guaranteed. Its
     * label has to name a single flow — an aggregated label leads with a count
     * and a feedback one says 反馈, and neither is a flow's own name. And its
     * route has to be somewhere a pointer can reach: the drawing is 6457px wide
     * against a canvas of about 1160, so at any zoom most edges are off-screen,
     * and labels are drawn for all of them regardless.
     *
     * The midpoint is re-measured after zooming out rather than reused, so the
     * point that gets clicked is the one the route is actually drawn at then.
     * Zooming out shrinks every distance from the canvas centre, so a route that
     * was on screen stays on screen — which is asserted rather than assumed.
     */
    const named = new Map(
      await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.semantic-edge__label')].flatMap((element) => {
          const lines = [...element.querySelectorAll('.semantic-edge__line-text')].map(
            (node) => node.textContent ?? '',
          )
          const text = lines.join('')
          if (lines.length !== 1 || text.includes('×') || text.startsWith('反馈')) return []
          return [[element.getAttribute('data-edge-id') ?? '', text] as const]
        }),
      ),
    )
    expect(named.size, 'L2 没有画出任何单条 flow 的标签，这条断言就没有意义').toBeGreaterThan(0)

    const chosen = await clickableRoutePoint(page, named, canvas)
    expect(
      chosen,
      '没有任何一条单 flow 边画在画布内且点得到（不被节点或浮层挡住），这条断言就没有意义',
    ).not.toBeNull()
    if (chosen === null) return

    await page.locator('.vue-flow__controls-zoomout').click()
    await waitForViewportSettled(page)
    await expect(labels, '缩小一格后标签仍然画着').toHaveCount(0)

    // Re-measured, not reused: the point that gets clicked is where the route is
    // drawn *now*. Zooming out pulls every distance from the canvas centre in, so
    // a route that was reachable stays reachable — asserted rather than assumed,
    // because staying clickable is the whole claim being made.
    const target = await clickableRoutePoint(page, named, canvas, chosen.edgeId)
    expect(
      target,
      '缩小到阈值以下之后这条边就点不到了，标签藏起来的代价太大',
    ).not.toBeNull()
    if (target === null) return

    await page.mouse.click(target.x, target.y)

    const drawer = page.locator('.inspector')
    await expect(drawer).toBeVisible()
    await expect(drawer.locator('.inspector__kicker')).toHaveText('数据流边')
    // The name the canvas was no longer allowed to draw.
    await expect(drawer.locator('.inspector__title')).toContainText(named.get(chosen.edgeId) ?? '')
  })

  /*
   * GRAPH_READABILITY_DESIGN.md 17.4(4) and 18.8.
   *
   * "The labels come back" is the easy half and is already covered above. The
   * half that matters is that they come back *where they were*: zoom is a view
   * of one layout, not an input to it. A renderer that recomputed the route from
   * the current viewport — or a resolver that re-ran ELK — would move the graph
   * under the reader at the exact moment they zoomed in to read it.
   *
   * The `d` string is the right observable because it lives inside the
   * transformed pane: pan and zoom are applied by the pane's own transform, so
   * the path data is the layout's geometry and nothing else. Equal strings are
   * therefore exactly "the layout did not change", with no coordinate arithmetic
   * to get wrong.
   */
  test('放大后标签恢复，而每条路线的坐标一字未变（验收 8）', async ({ page }) => {
    await switchToLevel(page, 2)

    const paths = async (): Promise<string[]> =>
      page.locator('.semantic-edge__line').evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('d') ?? ''),
      )

    const before = await paths()
    expect(before.length).toBeGreaterThan(0)

    await zoomUntilLabelsAreDrawn(page)
    await expect(page.locator('.semantic-edge__label').first()).toBeVisible()

    expect(await paths(), '放大后路线被重算，说明 zoom 触发了布局').toEqual(before)
  })

  /*
   * GRAPH_READABILITY_DESIGN.md 9.2, 17.4(5).
   *
   * The arrowhead has to point at `to`, the consumer — for a feedback edge as
   * much as a forward one. This is asserted on the painted geometry rather than
   * on the marker slot, because the slot and the rendering disagreed: Vue Flow
   * sets `orient="auto-start-reverse"` on its markers, and per SVG that reverses
   * a `marker-start` only, so the old feedback branch put the head at the source
   * end pointing back out of the path.
   *
   * The tip is read as the route's last point. Vue Flow's marker is an
   * `ArrowClosed` polyline whose tip vertex sits at the marker origin, and the
   * marker's `refX`/`refY` are 0 — so the last path point *is* the tip, and
   * measuring it measures the drawn arrow rather than restating its config.
   *
   * "Nearer the target than the source" rather than "inside the target": an
   * endpoint is a render port, which by construction lies on the node's border,
   * and a containment test would be decided by a fraction of a pixel.
   */
  test('箭头指向 to 那个消费者，反馈边也不例外', async ({ page }) => {
    await switchToLevel(page, 2)
    await zoomUntilLabelsAreDrawn(page)

    const [ends, nodes] = await Promise.all([collectDrawnEnds(page), collectNodeBoxes(page)])
    const byId = new Map(nodes.map((node) => [node.id, node]))
    expect(ends.length).toBeGreaterThan(0)

    const wrong: string[] = []
    let feedbackChecked = 0

    for (const end of ends) {
      const source = byId.get(end.source)
      const target = byId.get(end.target)
      if (source === undefined || target === undefined) continue
      if (end.feedback) feedbackChecked += 1

      const toSource = distanceToRect(end.tip, source)
      const toTarget = distanceToRect(end.tip, target)
      if (toTarget > toSource) {
        wrong.push(
          `${end.edgeId} 的箭头离 source ${end.source} 只有 ${toSource.toFixed(1)}px，` +
            `离 target ${end.target} 却有 ${toTarget.toFixed(1)}px`,
        )
      }
    }

    expect(feedbackChecked, 'L2 没有画出任何反馈边，这条断言就失去意义').toBeGreaterThan(0)
    expect(wrong, '箭头指向了提供方而不是消费者').toEqual([])

    // The other half of the convention: the far end carries no head at all, so
    // "the arrow points at the consumer" cannot be satisfied by both ends having
    // one.
    const heads = await page
      .locator('.semantic-edge__line')
      .evaluateAll((elements) =>
        elements.map((element) => [
          element.getAttribute('marker-start'),
          element.getAttribute('marker-end'),
        ]),
      )
    expect(heads.filter(([start]) => start !== null)).toEqual([])
    expect(heads.filter(([, end]) => end === null)).toEqual([])
  })

  /*
   * GRAPH_READABILITY_DESIGN.md 5.1, 17.4(6).
   *
   * The line budget is the thing that keeps a label from growing into the space
   * the layout reserved for something else: `measureEdgeLabel` gets `maxLines`
   * and the renderer has to draw exactly that many, or the box on screen is not
   * the box the collision check approved.
   *
   * L2 is the only level allowed two lines, and only for a single flow's own
   * name. Everything at L0/L1 — a kind label, 反馈 — is one line, which is what
   * keeps the coarser views readable.
   *
   * The third case in 17.4(6) — an aggregated label staying compact — cannot be
   * asserted here: this fixture folds no two flows onto one edge, so no label in
   * it carries a `×N` count at any level. The rule is covered where it can be,
   * in `tests/unit/edgePresentation.spec.ts`, which builds the aggregate directly
   * and pins it to `maxLines: 1`. What this test adds is the half a unit test
   * cannot see: the renderer drawing exactly the lines the measurement budgeted.
   */
  for (const level of LEVELS) {
    test(`L${level} 的标签行数不超过该层级的预算`, async ({ page }) => {
      await switchToLevel(page, level)
      await zoomUntilLabelsAreDrawn(page)

      const labels = await page.locator('.semantic-edge__label').evaluateAll((elements) =>
        elements.map((element) => ({
          text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
          lines: element.querySelectorAll('.semantic-edge__line-text').length,
        })),
      )
      expect(labels.length, `L${String(level)} 放大后没有画出任何标签`).toBeGreaterThan(0)

      const budget = level === 2 ? 2 : 1
      const over = labels
        .filter((label) => label.lines > budget)
        .map((label) => `${label.text} 画了 ${String(label.lines)} 行，预算是 ${String(budget)}`)

      expect(over, `L${String(level)} 有标签超出了行数预算`).toEqual([])

      // The lower bound matters as much as the upper one. One line is not merely
      // permitted at L0/L1, it is the rule: a flow name wrapping onto a second
      // line there would mean the kind label had been replaced by a name, which
      // is the thing 5.1 shortens it to avoid.
      if (level < 2) expect(labels.filter((label) => label.lines !== 1)).toEqual([])
    })
  }

  /*
   * GRAPH_READABILITY_DESIGN.md 5.1, 17.3, 17.4(7).
   *
   * The whole keyboard route, from nothing focused to a selected edge, with the
   * full sentence available at the point of focus. Two separate claims meet
   * here: the edge has to be *reachable* by Tab, and the information the canvas
   * refuses to draw at low zoom has to be readable at that moment anyway.
   *
   * Traversal starts from the top of the document rather than from a focused
   * node, because that is the state a keyboard reader is actually in. The bound
   * is generous — measured at 10 presses — and the assertion after the loop is
   * what fails if it is ever exceeded: a loop that quietly gave up would report
   * "the tooltip is missing" when the real problem is "the edge is unreachable".
   */
  test('Tab 到边后 Tooltip 与 Inspector 都给出完整信息（验收 7）', async ({ page }) => {
    await switchToLevel(page, 2)

    let presses = 0
    let reached = false
    for (; presses < 120 && !reached; presses += 1) {
      await page.keyboard.press('Tab')
      reached = await page.evaluate(
        () => document.activeElement?.classList.contains('vue-flow__edge') === true,
      )
    }
    expect(reached, `按了 ${String(presses)} 次 Tab 仍然没有走到任何一条边上`).toBe(true)

    // The tooltip for a sighted keyboard user (D3). It carries the same sentence
    // the accessible name does, which is what makes shortening the drawn label
    // safe at this zoom.
    const tooltip = page.locator('.semantic-edge__tooltip')
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText('证据：')

    const sentence = (await tooltip.textContent())?.trim() ?? ''
    // Where the keyboard actually is. Vue Flow puts the tab stop on the wrapper
    // it renders around the edge, and that wrapper — not the renderer's own
    // group — is what carries the accessible name.
    const named = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-label') ?? '',
    )
    expect(named, '获得焦点的边没有无障碍名').not.toBe('')

    // 5.1: the tooltip and the accessible name are the same sentence, so a
    // keyboard reader who can see and one who cannot are told the same thing.
    expect(sentence).toBe(named)

    await page.keyboard.press('Enter')
    const drawer = page.locator('.inspector')
    await expect(drawer).toBeVisible()
    await expect(drawer.locator('.inspector__kicker')).toHaveText('数据流边')

    // The same edge the keyboard was on: the Inspector is not showing some other
    // element's details. The panel is titled with the projection's own label for
    // the edge, which the sentence carries between its kind and its endpoints.
    const title = (await drawer.locator('.inspector__title').textContent())?.trim() ?? ''
    expect(title).not.toBe('')
    expect(sentence).toContain(title)

    // 7's "信息完整": the direction and the evidence, stated in words somewhere
    // a reader can reach without a pointer.
    expect(sentence).toContain('证据：')
    expect(sentence).toContain('→')
  })

  /*
   * GRAPH_READABILITY_DESIGN.md 17.3(4), the behavioural half.
   *
   * The node card's responsibility line is truncated, and the full sentence
   * hangs off it as a tooltip. Structurally it is wired to `focus` as well as
   * `hover` (asserted in `tests/component/GraphReadability.spec.ts`), but that
   * says nothing about whether a browser opens it: `ElTooltip`'s popper is
   * mounted on demand and teleported to the body, so only a real focus event in
   * a real browser can show it.
   */
  test('节点职责行聚焦后弹出完整文本（17.3 第 4 条）', async ({ page }) => {
    const line = page.locator('.business-node__responsibility').first()
    await expect(line).toHaveCount(1)

    const full = (await line.textContent())?.trim() ?? ''
    expect(full.length, '职责行是空的，这条断言就没有意义').toBeGreaterThan(0)

    // Keyboard focus, not hover: the defect this pins is a hover-only tooltip.
    await line.focus()
    await expect(page.locator('.el-popper').filter({ hasText: full }).first()).toBeVisible()
  })
})
