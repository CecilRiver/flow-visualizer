import { expect, test, type Locator, type Page } from '@playwright/test'

import { installDirectoryPickerMock } from './support/directoryPicker'
import { SOURCE_BASE, VALID_MODEL, loadFixtureFolder } from './support/fixtures'

/**
 * DESIGN.md 19.3 path 4.
 *
 * 点击组件或数据流 → Inspector → Wiki / 源码链接属性正确。
 *
 * "Correct" here is three separate claims, and the test keeps them apart:
 *   - a source-code link is *built* from the pinned revision, so it must carry
 *     the exact SHA the model pinned and the path the configuration gave;
 *   - a wiki link is an https URL taken from the configuration and nothing
 *     else — no `http:`, no `javascript:`, no relative form;
 *   - both open in a new tab without handing the opened page a handle on this
 *     one, which is what `rel="noopener noreferrer"` is for.
 */

const PINNED_SHA = VALID_MODEL.revision
const CODE_LINK_PREFIX = `${SOURCE_BASE}${PINNED_SHA}/`

/** The edge for `flow.stabilize_to_attitude_control` at L2 (DESIGN.md 9.6). */
const FLOW_EDGE_ID = 'edge:L2:mode.stabilize:control.attitude_rate:command:fw'

async function pickFolder(page: Page): Promise<void> {
  await page.getByRole('button', { name: '选择 flow 文件夹' }).click()
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 30_000 })
}

/** Every anchor in a container, with the attributes that decide safety. */
async function anchors(scope: Locator) {
  return scope.locator('a').evaluateAll((elements) =>
    elements.map((element) => ({
      href: element.getAttribute('href') ?? '',
      target: element.getAttribute('target') ?? '',
      rel: element.getAttribute('rel') ?? '',
    })),
  )
}

/** The invariant every link in the Inspector has to satisfy, whatever it is. */
function expectSafeLink(link: { href: string; target: string; rel: string }): void {
  expect(link.href).toMatch(/^https:\/\//)
  expect(link.target).toBe('_blank')
  // Both tokens: `noopener` stops the opened page reaching back through
  // `window.opener`, `noreferrer` stops this URL leaking as a Referer.
  expect(link.rel.split(/\s+/).sort()).toEqual(['noopener', 'noreferrer'])
}

test.describe('路径 4：Inspector 中的来源与证据链接', () => {
  test.beforeEach(async ({ page }) => {
    await installDirectoryPickerMock(page, [{ directory: loadFixtureFolder('valid') }])
  })

  test('组件节点：源码链接固定到 revision，Wiki 链接为配置中的 HTTPS 地址', async ({ page }) => {
    await page.goto('/')
    await pickFolder(page)

    await page.locator('.vue-flow__node[data-id="control.attitude_rate"]').click()

    const drawer = page.locator('.inspector')
    await expect(drawer).toBeVisible()
    await expect(drawer.locator('.inspector__title')).toHaveText('姿态与角速度控制')

    const links = await anchors(drawer)
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expectSafeLink(link)

    // The component's implementation and evidence sources, each resolved to a
    // link built from the constant base and the pinned revision.
    const codeLinks = links.filter((link) => link.href.startsWith(SOURCE_BASE))
    expect(codeLinks.length).toBeGreaterThan(0)
    for (const link of codeLinks) {
      expect(link.href.startsWith(CODE_LINK_PREFIX)).toBe(true)
      // A link that dropped the SHA would point at whatever the branch is
      // today, which is exactly what pinning the revision prevents.
      expect(link.href).not.toContain('/blob/main/')
    }

    // `source.wiki.attitude_control` is in this component's evidence, and its
    // URL is the configuration's own — used verbatim, not normalised into
    // something else.
    const wikiLink = links.find((link) =>
      link.href.startsWith('https://ardupilot.org/dev/docs/apmcopter-programming-attitude-control-2'),
    )
    expect(wikiLink).toBeDefined()

    // The code link carries the line range the configuration declared.
    expect(codeLinks.some((link) => /#L\d+(-L\d+)?$/.test(link.href))).toBe(true)

    // What the row shows is the source's own title, never "click here".
    await expect(drawer.locator('.source-link__title').first()).not.toHaveText('')
  })

  test('组件节点：键盘选中同样打开 Inspector', async ({ page }) => {
    await page.goto('/')
    await pickFolder(page)

    const node = page.locator('.vue-flow__node[data-id="control.attitude_rate"]')
    await node.focus()
    // The node wrapper is a `<div>`, so this one was never in doubt — it is
    // here so that "keyboard selection of nodes *and* edges" is checked for
    // both halves rather than inferred for one of them.
    expect(await node.evaluate((element) => element === document.activeElement)).toBe(true)

    // DESIGN.md 22 criterion 13 asks for keyboard operation at both acceptance
    // viewports; this covers the node half of 16.2's "nodes and edges".
    await page.keyboard.press('Enter')
    await expect(page.locator('.inspector__title')).toHaveText('姿态与角速度控制')

    // Escape closes it, and the canvas is left with nothing selected (13.5).
    await page.keyboard.press('Escape')
    await expect(page.locator('.inspector')).toHaveCount(0)
  })

  test('数据流：键盘选中边同样打开 Inspector，链接属性一致', async ({ page }) => {
    await page.goto('/')
    await pickFolder(page)

    const edge = page.locator(`.vue-flow__edge[data-id="${FLOW_EDGE_ID}"]`)
    await expect(edge).toHaveCount(1)

    // Selected by keyboard rather than by clicking the route: the path is a few
    // pixels wide, and this is the same selection path a keyboard reader uses
    // (DESIGN.md 16.2).
    //
    // `focus()` is a no-op on an element the browser does not consider
    // focusable, so checking where focus actually landed is the assertion that
    // proves the edge is reachable by keyboard at all. It is not a formality:
    // the edge wrapper is an SVG `<g>`, where attribute names are
    // case-sensitive, and a `tabIndex` that the browser cannot read leaves the
    // edge mouse-only while every attribute looks present.
    await edge.focus()
    expect(await edge.evaluate((element) => element === document.activeElement)).toBe(true)
    await page.keyboard.press('Enter')

    const drawer = page.locator('.inspector')
    await expect(drawer).toBeVisible()
    await expect(drawer.locator('.inspector__kicker')).toHaveText('数据流边')

    // The raw flow behind the edge, named as the configuration names it.
    await expect(drawer.locator('.flow-details__name')).toHaveText('Stabilize 姿态与油门目标')

    const links = await anchors(drawer)
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expectSafeLink(link)

    // `source.wiki.stabilize` is one of this flow's evidence sources.
    expect(
      links.some((link) => link.href === 'https://ardupilot.org/copter/docs/stabilize-mode.html'),
    ).toBe(true)
    expect(links.some((link) => link.href.startsWith(CODE_LINK_PREFIX))).toBe(true)

    // One row per evidence entry, whether or not its source could be linked:
    // a reference the viewer cannot open is still a fact about the model, so it
    // is shown as text with the reason rather than dropped (DESIGN.md 14.3).
    // This flow declares three.
    const evidence = drawer.locator('.flow-details__section', { hasText: '证据' })
    await expect(evidence.locator('.evidence-list__item')).toHaveCount(3)
    await expect(evidence.locator('.evidence-list__claim').first()).not.toHaveText('')
  })
})
