import { expect, test } from '@playwright/test'

import { removeDirectoryPicker } from './support/directoryPicker'
import { VALID_MODEL, fixturePath } from './support/fixtures'

/**
 * DESIGN.md 19.3 path 1.
 *
 * 打开应用 → 欢迎页 → 通过 directory input fallback 选择 fixture 目录 →
 * 图和 revision 可见。
 *
 * This is the whole fallback branch: with `showDirectoryPicker` gone the app
 * must detect the capability, say so, and still reach a usable graph through
 * `<input webkitdirectory>`.
 */
test.describe('路径 1：兼容目录选择', () => {
  test.beforeEach(async ({ page }) => {
    await removeDirectoryPicker(page)
  })

  test('从欢迎页经 fallback 打开目录后，图和 revision 可见', async ({ page }) => {
    await page.goto('/')

    // The welcome page states the privacy contract before anything is picked.
    await expect(page.getByText('只读取所选目录中的 YAML 文件，不上传、不修改、不写入。')).toBeVisible()
    await expect(page.getByText('当前支持的 Schema 版本：')).toBeVisible()

    // The capability adapter reports the fallback rather than pretending the
    // picker is available.
    await expect(page.getByText('当前浏览器使用兼容目录选择')).toBeVisible()

    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '选择 flow 文件夹' }).click()
    const chooser = await chooserPromise

    // Playwright sets `webkitRelativePath` for a directory upload, which is what
    // the fallback adapter derives the root name and relative paths from.
    await chooser.setFiles(fixturePath('valid', ''))

    // The graph: nodes are rendered by Vue Flow once ELK has laid them out.
    await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 30_000 })
    expect(await page.locator('.vue-flow__node').count()).toBeGreaterThan(0)

    // The revision the model pins is shown, abbreviated in the status bar.
    const shortRevision = VALID_MODEL.revision.slice(0, 7)
    await expect(page.getByText(shortRevision, { exact: false })).toBeVisible()

    // The scenario is named, and it is the fixture's own title.
    await expect(page.getByText(VALID_MODEL.title, { exact: false }).first()).toBeVisible()

    // The non-timeline disclaimer is permanent (DESIGN.md 13.1). It is asserted
    // on the canvas rather than by text alone: the status bar carries the same
    // sentence, so an unscoped match would pass with the canvas one missing.
    await expect(page.locator('.flow-canvas__disclaimer')).toHaveText(
      '语义数据依赖图，非单次循环严格时序',
    )

    // A one-shot FileList cannot be re-read, so refresh is offered as
    // "choose another folder" instead (DESIGN.md 6.2).
    await expect(page.getByText('兼容模式')).toBeVisible()
  })
})
