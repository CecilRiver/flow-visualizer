import { expect, test, type Page } from '@playwright/test'

import { installDirectoryPickerMock } from './support/directoryPicker'
import { loadFixtureFolder } from './support/fixtures'
import {
  collectDrawnLines,
  collectNodeBoxes,
  formatOverlaps,
  measureReadability,
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

/** The node count each projection is expected to draw, groups included (16 = 11 + 5). */
const DRAWN_NODES = { 0: 4, 1: 9, 2: 16 } as const

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

/** The level button, found by its `L{n}` badge rather than by position. */
function levelButton(page: Page, level: 0 | 1 | 2) {
  return page.locator('.level-switcher__option', { hasText: `L${String(level)}` })
}

/** The transform Vue Flow is applying to the graph, as `scale(...)`. */
async function viewportTransform(page: Page): Promise<string> {
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
 * merely to have been set once.
 */
async function waitForViewportSettled(page: Page): Promise<void> {
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
async function switchToLevel(page: Page, level: 0 | 1 | 2): Promise<void> {
  await levelButton(page, level).click()
  await expect(levelButton(page, level)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.vue-flow__node')).toHaveCount(DRAWN_NODES[level])
  await waitForViewportSettled(page)
}

/**
 * Zooms in until the inline edge labels are drawn, and leaves the view still.
 *
 * Driven through the real control rather than by calling `zoomTo`, so the
 * labels have to appear by the path a reader would take. The loop is bounded,
 * and the assertion after it is what fails if they never do — a cap that
 * silently gave up would turn "the labels never appeared" into a pass.
 *
 * The label count flips part-way through the control's zoom animation, so the
 * viewport is waited on afterwards: measuring a box mid-transition measures a
 * scale that is about to be replaced.
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
})
