import { expect, test, type Page } from '@playwright/test'

import { installDirectoryPickerMock } from './support/directoryPicker'
import { VALID_MODEL, loadFixtureFolder } from './support/fixtures'
import { collectNodeBoxes, switchToLevel } from './support/readability'

/**
 * DESIGN.md 19.3: 视觉截图覆盖 1440×900 和 1024×768。
 *
 * The same spec runs in both viewport projects (`desktop` at 1440x900, `compact`
 * at 1024x768), so every assertion below is written for whichever width it is
 * running at rather than for one of them.
 *
 * The screenshots are artefacts for a human to look at. The *assertions* are
 * about layout and key information only — which columns exist, whether opening
 * the Inspector takes width away from the canvas, whether anything overflows.
 * ELK's pixel coordinates are not a business contract and are not asserted.
 */

const SHOT_DIR = 'test-results/screenshots'

/** The layout range from `useResponsiveLayout` (DESIGN.md 12.2). */
const COMPACT_MAX_WIDTH = 1279

async function pickFolder(page: Page): Promise<void> {
  await page.getByRole('button', { name: '选择 flow 文件夹' }).click()
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 30_000 })
}

/** The page must never scroll sideways, at either width. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

test.describe('视觉截图与整体布局', () => {
  test.beforeEach(async ({ page }) => {
    await installDirectoryPickerMock(page, [{ directory: loadFixtureFolder('valid') }])
    await page.goto('/')
  })

  test('欢迎页：关键信息在两种宽度下都在视口内', async ({ page }, testInfo) => {
    const width = page.viewportSize()?.width ?? 0

    await expect(page.getByRole('button', { name: '选择 flow 文件夹' })).toBeVisible()
    await expect(page.getByText('只读取所选目录中的 YAML 文件，不上传、不修改、不写入。')).toBeVisible()
    await expect(page.getByText('当前支持的 Schema 版本：')).toBeVisible()

    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}-welcome.png` })

    // The welcome page is a single centred panel at every width — there are no
    // columns to compare yet.
    expect(width).toBeGreaterThan(0)
  })

  test('图谱页：栏位与 Inspector 的行为符合当前宽度', async ({ page }, testInfo) => {
    const width = page.viewportSize()?.width ?? 0
    const compact = width <= COMPACT_MAX_WIDTH

    await pickFolder(page)

    // Key information, whatever the width: which folder, which revision, and
    // what is drawn.
    await expect(page.locator('.status-bar__item', { hasText: '有效 1' })).toBeVisible()
    await expect(page.getByText(VALID_MODEL.revision.slice(0, 8), { exact: false })).toBeVisible()
    await expect(page.locator('.flow-canvas__disclaimer')).toHaveText(
      '语义数据依赖图，非单次循环严格时序',
    )
    await expect(page.locator('.vue-flow__node').first()).toBeVisible()

    // The sidebar is a column only above the compact breakpoint; below it, the
    // canvas takes the full width (DESIGN.md 12.2).
    const sidebar = page.locator('.scenario-sidebar')
    if (compact) await expect(sidebar).toHaveCount(0)
    else await expect(sidebar).toBeVisible()

    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}-graph.png` })

    // Opening the Inspector must not squeeze the canvas below the compact
    // breakpoint, and must not take width from it at all when it is an overlay.
    const canvas = page.locator('.explorer-view__canvas')
    const before = await canvas.boundingBox()

    await page.locator('.vue-flow__node[data-id="control.attitude_rate"]').click()
    await expect(page.locator('.inspector')).toBeVisible()
    await expect(page.locator('.vue-flow__node[data-id="control.attitude_rate"]')).toBeVisible()

    const after = await canvas.boundingBox()
    expect(before).not.toBeNull()
    expect(after).not.toBeNull()
    if (compact) {
      // An overlay drawer: the canvas keeps every pixel it had.
      expect(after?.width).toBe(before?.width)
    } else {
      // A third column: the canvas gives up room, but stays the widest column.
      expect(after?.width).toBeLessThan(before?.width ?? 0)
      expect(after?.width).toBeGreaterThan(0)
    }

    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}-inspector.png` })
  })

  /*
   * One picture per projection level, and the assertion that makes the pictures
   * worth taking.
   *
   * A screenshot is an artefact for a human, so on its own it cannot fail. The
   * assertion attached to it is the one a reader would make looking at it: every
   * node at this level is inside the canvas. That is a real risk per level
   * rather than in general — each level replaces the drawing with one of a
   * different size, and the fit has to be re-run for it (GRAPH_READABILITY_
   * DESIGN.md 11), which is exactly where a stale viewport shows up as a drawing
   * cropped at the edge.
   *
   * The node boxes are read for every level; the screenshots are written into
   * `test-results`, which is generated output and never committed, so the
   * repository gains no binary files from this.
   */
  for (const level of [0, 1, 2] as const) {
    test(`L${level}：整层图形落在画布内`, async ({ page }, testInfo) => {
      await pickFolder(page)
      await switchToLevel(page, level)

      const canvas = await page.locator('.explorer-view__canvas').boundingBox()
      expect(canvas).not.toBeNull()
      if (canvas === null) return

      const nodes = await collectNodeBoxes(page)
      expect(nodes.length, `L${String(level)} 没有画出任何节点`).toBeGreaterThan(0)

      const outside = nodes.filter(
        (node) =>
          node.x < canvas.x ||
          node.y < canvas.y ||
          node.x + node.width > canvas.x + canvas.width ||
          node.y + node.height > canvas.y + canvas.height,
      )
      expect(
        outside.map((node) => node.id),
        `L${String(level)} 有节点被画布裁切，说明这一层没有重新 fit`,
      ).toEqual([])

      await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}-L${String(level)}.png` })
    })
  }

  /*
   * DESIGN.md 16.2: "focus ring 不得被 `outline: none` 移除".
   *
   * Asserted here rather than in a component test because only a browser loads
   * the stylesheets that disagree. `theme-default.css` switches the ring off on
   * a node with a selector of three classes, and the rule that puts it back has
   * to match that weight and be imported later — a jsdom mount loads neither
   * file, so a component test would only ever confirm that our own rule says
   * `outline: 2px`, which was never the question.
   */
  test('节点获得键盘焦点时画出 focus ring（DESIGN.md 16.2）', async ({ page }) => {
    await pickFolder(page)

    const node = page.locator('.vue-flow__node').first()
    await node.focus()
    expect(await node.evaluate((element) => element === document.activeElement)).toBe(true)

    const ring = await node.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        style: style.outlineStyle,
        width: Number.parseFloat(style.outlineWidth),
        color: style.outlineColor,
      }
    })

    expect(ring.style, '焦点环被 outline: none 关掉了').not.toBe('none')
    expect(ring.width).toBeGreaterThan(0)
    // A ring in the transparent colour would satisfy the two checks above and
    // still be invisible, which is the state this test exists to rule out.
    expect(ring.color).not.toBe('rgba(0, 0, 0, 0)')
  })
})
