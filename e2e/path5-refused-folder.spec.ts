import { expect, test } from '@playwright/test'

import { installDirectoryPickerMock, oversizedDirectory } from './support/directoryPicker'
import { loadFixtureFolder } from './support/fixtures'

/**
 * DESIGN.md 19.3 path 5.
 *
 * 空目录或超限目录 → 明确的说明，且不显示半有效图。
 *
 * Both folders end the same way and for the same reason: the scan returns no
 * snapshot, so the viewer refuses the folder rather than drawing the part of it
 * it managed to read. The distinction the pair tests is what the reader is
 * *told* — an empty folder and a folder over the resource limits are different
 * mistakes with different fixes, and DESIGN.md 16.3 requires the second to say
 * so and point at the extraction-result directory.
 */

const EMPTY_FOLDER_MESSAGE = '目录中没有可读取的 YAML 文件。'
const LIMIT_MESSAGE_FRAGMENT = '超过扫描上限'

/** Nothing drawn, and no graph surface pretending otherwise. */
async function expectNoGraph(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('.flow-canvas')).toHaveCount(0)
  await expect(page.locator('.vue-flow__node')).toHaveCount(0)
  await expect(page.locator('.vue-flow__edge')).toHaveCount(0)
  // The explorer's own chrome must be absent too: a status bar reporting
  // "有效 0 · 无效 0" would read as a folder that loaded and happened to be
  // empty, which is not what happened.
  await expect(page.locator('.app-header__tools')).toHaveCount(0)
}

test.describe('路径 5：被拒绝的目录', () => {
  test('空目录：说明没有 YAML，不进入查看器', async ({ page }) => {
    await installDirectoryPickerMock(page, [{ directory: loadFixtureFolder('empty') }])

    await page.goto('/')
    await page.getByRole('button', { name: '选择 flow 文件夹' }).click()

    const failure = page.locator('.el-alert', { hasText: '目录读取失败' })
    await expect(failure).toBeVisible()
    await expect(failure).toContainText(EMPTY_FOLDER_MESSAGE)

    await expectNoGraph(page)
    // The welcome page is still the page: the reader can pick again.
    await expect(page.getByRole('button', { name: '选择 flow 文件夹' })).toBeEnabled()
  })

  test('超限目录：说明超过扫描上限并建议选择提取结果目录', async ({ page }) => {
    // One past the 500-file limit the viewer enforces (DESIGN.md 6.3).
    await installDirectoryPickerMock(page, [{ directory: oversizedDirectory(501) }])

    await page.goto('/')
    await page.getByRole('button', { name: '选择 flow 文件夹' }).click()

    const failure = page.locator('.el-alert', { hasText: '目录读取失败' })
    await expect(failure).toBeVisible()
    await expect(failure).toContainText(LIMIT_MESSAGE_FRAGMENT)
    // The suggestion, not just the complaint: 选择提取结果目录, not 源码根目录.
    await expect(failure).toContainText('请改为选择 flow 提取结果目录')

    // The reason shown is the refusal, not the first skipped file: the scan
    // stops on the limit, and a warning that merely explains one skipped file
    // must not be what the reader is handed as the explanation.
    await expect(failure).not.toContainText('已跳过')

    await expectNoGraph(page)
  })
})
