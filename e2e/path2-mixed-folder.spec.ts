import { expect, test } from '@playwright/test'

import { installDirectoryPickerMock } from './support/directoryPicker'
import { MIXED_MODEL, loadFixtureFolder } from './support/fixtures'

/**
 * DESIGN.md 19.3 path 2.
 *
 * 选择包含合法与非法文件的目录 → 合法 bundle 可用且 ValidationPanel 显示相对路径。
 *
 * The point of the fixture is that the folder is *mixed*: one file stops the
 * model from being usable and the other must not. A viewer that rejected the
 * whole folder, or that silently dropped the broken file, would both fail here.
 */
test.describe('路径 2：合法与非法文件混合的目录', () => {
  test.beforeEach(async ({ page }) => {
    await installDirectoryPickerMock(page, [{ directory: loadFixtureFolder('mixed') }])
  })

  test('合法 bundle 仍可用，校验面板按相对路径列出问题', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '选择 flow 文件夹' }).click()

    // The healthy bundle is drawn: its scenario title reaches the header.
    await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(MIXED_MODEL.title, { exact: false }).first()).toBeVisible()

    // The status bar counts both sides honestly.
    await expect(page.getByText('有效 1 · 无效 1')).toBeVisible()

    // The broken file is reported, not swallowed.
    // Exactly the four errors `broken.yaml` was written to produce — a loose
    // "some error" match would pass even if the schema check misfired badly.
    const errorTrigger = page.locator('.status-bar__item--error')
    await expect(errorTrigger).toBeVisible()
    await expect(errorTrigger).toContainText('错误 4')

    await errorTrigger.click()

    const panel = page.locator('.validation-panel')
    await expect(panel).toBeVisible()

    // The relative path, not an absolute one (DESIGN.md 17.2 bars absolute
    // local paths from the UI, and the folder root name is all that may show).
    const brokenGroup = panel.locator('.validation-panel__group', { hasText: 'broken.yaml' })
    await expect(brokenGroup).toBeVisible()
    await expect(brokenGroup.locator('.validation-panel__file')).toHaveText('broken.yaml')

    // Every one of the four deliberate errors is attributed to that file, and
    // each names the rule it broke. The fixture was authored so that these are
    // the only four (see its header comment), which is what makes the exact
    // count meaningful rather than incidental.
    await expect(brokenGroup.locator('.validation-panel__issue').first()).toBeVisible()
    const messages = (await brokenGroup.locator('.validation-panel__message').allInnerTexts()).join(
      '\n',
    )

    // 1. `review_status` outside its enum, reported with the allowed values.
    expect(messages).toContain('draft / schema_validated / evidence_checked / human_reviewed')
    // 2. `kind` outside its enum.
    expect(messages).toContain('command / measurement / state / event / control / actuation / feedback')
    // 3. `flows[0].from` missing its port.
    expect(messages).toContain('缺少必需字段 port_id')
    // 4. `flows[0].verification` missing outright.
    expect(messages).toContain('缺少必需字段 verification')

    // No absolute Windows or POSIX path leaks into the panel.
    const panelText = await panel.innerText()
    expect(panelText).not.toMatch(/[A-Za-z]:\\/)
    expect(panelText).not.toContain('tests/fixtures')
  })
})
