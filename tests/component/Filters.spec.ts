import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import FlowKindFilter from '@/components/toolbar/FlowKindFilter.vue'
import VerificationFilter from '@/components/toolbar/VerificationFilter.vue'
import { FLOW_KIND_VALUES, VERIFICATION_VALUES } from '@/app/urlState'
import { useCatalogStore } from '@/stores/catalog'
import { useExplorerStore } from '@/stores/explorer'

import { buildFixtureBundle } from '../fixtures/buildBundle'

/**
 * DESIGN.md 19.2: filter 显示数量、全选/清空和禁用状态.
 *
 * The counts matter because filters are applied before projection: the number
 * next to a kind is the number of raw flows of that kind in the scenario, so it
 * is the same number that decides what the canvas will draw. An option with no
 * flows is disabled rather than silently doing nothing.
 *
 * Element Plus teleports the popover body to `document.body`, so the panel is
 * read off the document and torn down between tests.
 */
const pinia = createPinia()

function seedCatalog(): void {
  const catalog = useCatalogStore()
  const explorer = useExplorerStore()
  catalog.clear()
  explorer.reset()
  catalog.validBundles = [buildFixtureBundle()]
  catalog.status = 'ready'
  catalog.activateFirstAvailable()
}

/** Opens the popover and returns the teleported panel. */
async function openPanel(wrapper: VueWrapper): Promise<HTMLElement> {
  await wrapper.find('.filter-trigger').trigger('click')
  await nextTick()
  await nextTick()

  const panel = document.querySelector<HTMLElement>('.filter-panel')
  if (panel === null) throw new Error('filter panel did not open')
  return panel
}

function panelRows(panel: HTMLElement): { label: string; count: string; disabled: boolean }[] {
  return [...panel.querySelectorAll<HTMLElement>('.el-checkbox')].map((row) => ({
    label: row.querySelector('.filter-panel__row')?.textContent?.trim() ?? '',
    count: row.querySelector('.filter-panel__count')?.textContent?.trim() ?? '',
    disabled: row.classList.contains('is-disabled'),
  }))
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('FlowKindFilter', () => {
  beforeEach(() => {
    setActivePinia(pinia)
    seedCatalog()
  })

  it('shows the scenario count beside every flow kind', async () => {
    const wrapper = mount(FlowKindFilter, { attachTo: document.body, global: { plugins: [pinia] } })
    const panel = await openPanel(wrapper)

    const rows = panelRows(panel)
    expect(rows).toHaveLength(FLOW_KIND_VALUES.length)
    // The fixture declares two `command` flows and one each of the rest.
    expect(rows.find((row) => row.label.includes('命令'))?.count).toBe('2')
    expect(rows.find((row) => row.label.includes('状态'))?.count).toBe('1')

    wrapper.unmount()
  })

  it('disables the kinds this scenario has none of', async () => {
    const wrapper = mount(FlowKindFilter, { attachTo: document.body, global: { plugins: [pinia] } })
    const panel = await openPanel(wrapper)

    const rows = panelRows(panel)
    const disabled = rows.filter((row) => row.disabled)

    expect(disabled.length).toBeGreaterThan(0)
    for (const row of disabled) expect(row.count).toBe('0')
    // A kind that *is* present must stay usable — a blanket disable would pass
    // the assertion above while making the filter useless.
    expect(rows.find((row) => row.label.includes('命令'))?.disabled).toBe(false)

    wrapper.unmount()
  })

  it('selects and clears every kind from the panel actions', async () => {
    const explorer = useExplorerStore()
    const wrapper = mount(FlowKindFilter, { attachTo: document.body, global: { plugins: [pinia] } })
    const panel = await openPanel(wrapper)

    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('.filter-panel__actions button')]
    const clear = buttons.find((button) => button.textContent?.includes('全不选'))
    const all = buttons.find((button) => button.textContent?.includes('全选'))
    if (clear === undefined || all === undefined) throw new Error('no panel actions')

    clear.click()
    await nextTick()
    expect(explorer.enabledFlowKinds).toEqual([])
    expect(explorer.filtersHideEverything).toBe(true)

    all.click()
    await nextTick()
    expect(explorer.enabledFlowKinds).toEqual([...FLOW_KIND_VALUES])

    wrapper.unmount()
  })

  it('summarises the selection on the trigger, including the empty case', async () => {
    const explorer = useExplorerStore()
    const wrapper = mount(FlowKindFilter, { attachTo: document.body, global: { plugins: [pinia] } })

    expect(wrapper.find('.filter-trigger').text()).toContain('全部类型')

    explorer.setFlowKinds(['command'])
    await nextTick()
    expect(wrapper.find('.filter-trigger').text()).toContain(`1/${String(FLOW_KIND_VALUES.length)}`)

    explorer.clearFlowKinds()
    await nextTick()
    // "Nothing selected" and "everything selected" must not read the same.
    expect(wrapper.find('.filter-trigger').text()).toContain('未选择类型')
    expect(wrapper.find('.filter-trigger').classes()).toContain('is-filtered')

    wrapper.unmount()
  })
})

describe('VerificationFilter', () => {
  beforeEach(() => {
    setActivePinia(pinia)
    seedCatalog()
  })

  it('shows a count for every verification state, none hidden by default', async () => {
    const explorer = useExplorerStore()
    const wrapper = mount(
      VerificationFilter,
      { attachTo: document.body, global: { plugins: [pinia] } },
    )
    const panel = await openPanel(wrapper)

    const rows = panelRows(panel)
    expect(rows).toHaveLength(VERIFICATION_VALUES.length)
    // DESIGN.md 15.1: weak evidence is never hidden by default, so every state
    // that the scenario uses is enabled from the start.
    expect(explorer.enabledVerificationStates).toEqual([...VERIFICATION_VALUES])
    expect(rows.find((row) => row.label.includes('推断'))?.count).toBe('1')

    wrapper.unmount()
  })

  it('labels every state in words and with a glyph, never by colour alone', async () => {
    const wrapper = mount(
      VerificationFilter,
      { attachTo: document.body, global: { plugins: [pinia] } },
    )
    const panel = await openPanel(wrapper)

    for (const row of panelRows(panel)) {
      // A colour swatch on its own would be unreadable for a colour-blind
      // reader and for anyone reading a printout (DESIGN.md 16.2).
      expect(row.label).not.toBe('')
      expect(row.label.replace(/[0-9]/g, '').trim().length).toBeGreaterThan(1)
    }
    expect(panel.querySelectorAll('.filter-panel__glyph').length).toBe(VERIFICATION_VALUES.length)

    wrapper.unmount()
  })

  it('clears and restores every state from the panel actions', async () => {
    const explorer = useExplorerStore()
    const wrapper = mount(
      VerificationFilter,
      { attachTo: document.body, global: { plugins: [pinia] } },
    )
    const panel = await openPanel(wrapper)

    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('.filter-panel__actions button')]
    buttons.find((button) => button.textContent?.includes('全不选'))?.click()
    await nextTick()
    expect(explorer.enabledVerificationStates).toEqual([])

    buttons.find((button) => button.textContent?.includes('全选'))?.click()
    await nextTick()
    expect(explorer.enabledVerificationStates).toEqual([...VERIFICATION_VALUES])

    wrapper.unmount()
  })

  it('marks the trigger when the filter no longer covers everything', async () => {
    const explorer = useExplorerStore()
    const wrapper = mount(
      VerificationFilter,
      { attachTo: document.body, global: { plugins: [pinia] } },
    )

    expect(wrapper.find('.filter-trigger').text()).toContain('全部状态')

    explorer.setVerificationStates(['inferred'])
    await nextTick()

    expect(wrapper.find('.filter-trigger').text()).toContain(
      `1/${String(VERIFICATION_VALUES.length)}`,
    )
    expect(wrapper.find('.filter-trigger').classes()).toContain('is-filtered')

    wrapper.unmount()
  })
})
