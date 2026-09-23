import { expect, test, type Page } from '@playwright/test'

import { installDirectoryPickerMock } from './support/directoryPicker'
import { loadFixtureFolder } from './support/fixtures'
import { collectLabelBoxes, formatOverlaps, measureReadability } from './support/readability'

/**
 * GRAPH_READABILITY_DESIGN.md 17.4: the drawn graph is measured, not eyeballed.
 *
 * These assertions are about geometry the reader actually experiences — does a
 * label cover a node, do two labels cover each other, does the first fit leave
 * a label outside the canvas. They are deliberately *not* about ELK's pixel
 * coordinates, which are not a contract (DESIGN.md 19.3).
 *
 * The measurement runs at both configured viewports: the compact width is where
 * the right-hand labels are most likely to be clipped, so testing only the
 * desktop width would miss the case the design document is about.
 */

/** The node count each projection is expected to draw, groups included (16 = 11 + 5). */
const DRAWN_NODES = { 0: 4, 1: 9, 2: 16 } as const

const LEVELS = [0, 1, 2] as const

/** The level button, found by its `L{n}` badge rather than by position. */
function levelButton(page: Page, level: 0 | 1 | 2) {
  return page.locator('.level-switcher__option', { hasText: `L${String(level)}` })
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
}

test.describe('图可读性：标签几何', () => {
  test.beforeEach(async ({ page }) => {
    await installDirectoryPickerMock(page, [{ directory: loadFixtureFolder('valid') }])
    await page.goto('/')
    await page.getByRole('button', { name: '选择 flow 文件夹' }).click()
    await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 30_000 })
  })

  for (const level of LEVELS) {
    test(`L${level} 默认视图没有标签压住节点或别的标签`, async ({ page }, testInfo) => {
      await switchToLevel(page, level)
      const report = await measureReadability(page)

      await testInfo.attach(`readability-L${String(level)}`, {
        body: JSON.stringify(report, null, 2),
        contentType: 'application/json',
      })

      // Guards the assertions below: an empty measurement would satisfy them
      // without having looked at anything.
      expect(report.labelCount, `L${String(level)} drew no labels at all`).toBeGreaterThan(0)

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

  test('首次 fit 之后每个标签都完整落在画布内', async ({ page }) => {
    await switchToLevel(page, 1)

    const canvas = await page.locator('.explorer-view__canvas').boundingBox()
    expect(canvas).not.toBeNull()
    if (canvas === null) return

    const labels = await collectLabelBoxes(page)
    expect(labels.length).toBeGreaterThan(0)

    // GRAPH_READABILITY_DESIGN.md 11: the first fit has to account for the
    // labels, which are HTML outside the shape bounds ELK reports. A label that
    // hangs off the right or bottom edge is the symptom that bounds are wrong.
    const clipped = labels.filter(
      (label) =>
        label.x < canvas.x ||
        label.y < canvas.y ||
        label.x + label.width > canvas.x + canvas.width ||
        label.y + label.height > canvas.y + canvas.height,
    )

    expect(
      clipped.map((label) => `${label.edgeId}(${label.text})`),
      '标签被画布裁切',
    ).toEqual([])
  })
})
