import { expect, test, type Page } from '@playwright/test'

import { installDirectoryPickerMock } from './support/directoryPicker'
import { loadFixtureFolder } from './support/fixtures'

/**
 * DESIGN.md 19.3 path 3.
 *
 * L2 → L1 → L0 投影切换与 URL 查询同步；刷新后重新选择目录可恢复视图。
 *
 * The two halves are one story. The level switch is a projection change — L2
 * components fold onto their capability domain at L1 and onto the system at L0,
 * so the assertion is that a node appears *and* its child disappears. The URL
 * half is the boundary of what a link may do: it carries the view, never the
 * folder, and after a reload the reader has to grant access again.
 */

/** Picks the fixture folder through the mocked handle picker. */
async function pickFolder(page: Page): Promise<void> {
  await page.getByRole('button', { name: '选择 flow 文件夹' }).click()
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 30_000 })
}

/** The level button, found by its `L{n}` badge rather than by position. */
function levelButton(page: Page, level: 0 | 1 | 2) {
  return page.locator('.level-switcher__option', { hasText: `L${String(level)}` })
}

async function switchToLevel(page: Page, level: 0 | 1 | 2): Promise<void> {
  await levelButton(page, level).click()
  await expect(levelButton(page, level)).toHaveAttribute('aria-pressed', 'true')
}

test.describe('路径 3：层级投影切换与 URL 同步', () => {
  test.beforeEach(async ({ page }) => {
    await installDirectoryPickerMock(page, [{ directory: loadFixtureFolder('valid') }])
  })

  test('切层折叠组件，URL 记录层级，刷新后重新授权即恢复', async ({ page }) => {
    await page.goto('/')
    await pickFolder(page)

    // --- L2: the default, and the fine-grained view. ---
    await expect(levelButton(page, 2)).toHaveAttribute('aria-pressed', 'true')
    const l2Node = page.locator('.vue-flow__node[data-id="control.attitude_rate"]')
    await expect(l2Node).toBeVisible()

    // Changing a level is view state, so it lands in the URL — and the default
    // is omitted, which is why L2 has no `level` parameter to begin with.
    expect(page.url()).not.toContain('level=')

    // --- L1: `control.attitude_rate` folds onto its capability domain. ---
    await switchToLevel(page, 1)
    await expect(page.locator('.vue-flow__node[data-id="domain.flight_control"]')).toBeVisible()
    await expect(l2Node).toHaveCount(0)
    expect(page.url()).toContain('level=1')

    // --- L0: the domains fold onto the system. ---
    await switchToLevel(page, 0)
    await expect(page.locator('.vue-flow__node[data-id="system.arducopter"]')).toBeVisible()
    await expect(page.locator('.vue-flow__node[data-id="domain.flight_control"]')).toHaveCount(0)
    expect(page.url()).toContain('level=0')

    // The URL carries the view and nothing else (DESIGN.md 8.4). Three
    // parameters, exactly: which bundle, which scenario, which level. The
    // filters are at their defaults, and the defaults are omitted.
    const params = new URLSearchParams(new URL(page.url()).search)
    expect([...params.keys()].sort()).toEqual(['bundle', 'level', 'scenario'])

    // No value is a path, and none could be mistaken for one: a folder name, a
    // drive letter or a directory separator would all read as file state that
    // the link is not allowed to carry.
    for (const [name, value] of params) {
      const decoded = decodeURIComponent(value)
      expect(decoded, name).not.toMatch(/[A-Za-z]:[\\/]/)
      expect(decoded, name).not.toContain('/')
      expect(decoded, name).not.toContain('\\')
      expect(decoded, name).not.toContain('..')
    }

    // --- Reload: the link is not a capability. ---
    await page.reload()

    // Back to the welcome page, with nothing read and nothing drawn: a URL
    // cannot hand a page access to a local folder.
    await expect(page.getByRole('button', { name: '选择 flow 文件夹' })).toBeVisible()
    await expect(page.locator('.vue-flow__node')).toHaveCount(0)
    await expect(page.locator('.flow-canvas')).toHaveCount(0)
    // The level survived, because it is view state rather than file state.
    expect(page.url()).toContain('level=0')

    // --- Re-authorising restores the view the link described. ---
    await pickFolder(page)

    await expect(levelButton(page, 0)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.vue-flow__node[data-id="system.arducopter"]')).toBeVisible()
    // Still L0, not silently back to the L2 default.
    await expect(page.locator('.vue-flow__node[data-id="control.attitude_rate"]')).toHaveCount(0)
  })
})
