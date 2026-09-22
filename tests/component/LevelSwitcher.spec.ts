import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import LevelSwitcher from '@/components/toolbar/LevelSwitcher.vue'
import { useExplorerStore } from '@/stores/explorer'

/**
 * DESIGN.md 19.2: `LevelSwitcher` 只发出允许的 0/1/2.
 *
 * The switch is driven by `GRAPH_LEVELS`, so the risk is not that it emits 3 —
 * it is that a control appears for a level the projection cannot build, or that
 * the pressed state stops matching the store. Both are asserted here.
 */
const pinia = createPinia()

function mountSwitcher() {
  return mount(LevelSwitcher, { global: { plugins: [pinia] } })
}

describe('LevelSwitcher', () => {
  beforeEach(() => {
    setActivePinia(pinia)
    useExplorerStore().reset()
  })

  it('offers exactly the three graph levels, L0 through L2', () => {
    const wrapper = mountSwitcher()
    const options = wrapper.findAll('.level-switcher__option')

    expect(options).toHaveLength(3)
    expect(options.map((option) => option.find('.level-switcher__badge').text())).toEqual([
      'L0',
      'L1',
      'L2',
    ])
  })

  it('writes the clicked level into the store instead of holding its own copy', async () => {
    const explorer = useExplorerStore()
    const wrapper = mountSwitcher()

    await wrapper.findAll('.level-switcher__option')[1]?.trigger('click')
    expect(explorer.level).toBe(1)

    // Back up as well: a switch that only ever moves to L1 would pass a
    // one-way assertion.
    await wrapper.findAll('.level-switcher__option')[2]?.trigger('click')
    expect(explorer.level).toBe(2)
  })

  it('marks the active level for assistive technology, not just by colour', () => {
    const explorer = useExplorerStore()
    explorer.setLevel(1)

    const wrapper = mountSwitcher()
    const pressed = wrapper
      .findAll('.level-switcher__option')
      .map((option) => option.attributes('aria-pressed'))

    // DESIGN.md 16.2: the current level must be readable without colour.
    expect(pressed).toEqual(['false', 'true', 'false'])
  })

  it('follows the store when the level changes elsewhere', async () => {
    const explorer = useExplorerStore()
    const wrapper = mountSwitcher()

    explorer.setLevel(0)
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.level-switcher__option')[0]?.classes()).toContain('is-active')
    expect(wrapper.findAll('.level-switcher__option')[1]?.classes()).not.toContain('is-active')
  })

  it('is reachable and operable by keyboard', async () => {
    const wrapper = mountSwitcher()
    const buttons = wrapper.findAll('button')

    // Real buttons, so Enter/Space work without extra handlers.
    expect(buttons).toHaveLength(3)
    for (const button of buttons) {
      expect(button.attributes('type')).toBe('button')
    }
    expect(wrapper.find('[role="group"]').attributes('aria-label')).toBe('图层级别')
  })
})
