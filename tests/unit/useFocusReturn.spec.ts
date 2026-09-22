import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { describe, expect, it } from 'vitest'

import { useFocusReturn } from '@/composables/useFocusReturn'

/**
 * DESIGN.md 16.2: the Inspector "关闭后返回触发元素".
 *
 * The trigger is whatever had focus when the panel opened, so the composable is
 * exercised against a real focused element rather than a stub: `document.
 * activeElement` is exactly what it reads.
 */

/**
 * A minimal stand-in for `ExplorerView`: a trigger button, a panel that is
 * mounted while `open` is true, and the composable watching that flag.
 */
function mountHarness(): {
  wrapper: ReturnType<typeof mount>
  open: Ref<boolean>
  trigger: HTMLButtonElement
} {
  const open = ref(false)
  let trigger: HTMLButtonElement | null = null

  const Harness = defineComponent({
    setup() {
      useFocusReturn(open)
      return () =>
        h('div', [
          h(
            'button',
            {
              ref: (element) => {
                trigger = element as HTMLButtonElement | null
              },
              onClick: () => {
                open.value = true
              },
            },
            '触发',
          ),
          open.value ? h('h2', { tabindex: -1, class: 'panel-title' }, '标题') : null,
        ])
    },
  })

  const wrapper = mount(Harness, { attachTo: document.body })
  if (trigger === null) throw new Error('the trigger button never mounted')
  return { wrapper, open, trigger }
}

describe('useFocusReturn', () => {
  it('关闭时把焦点交还给打开面板的那个元素', async () => {
    const { wrapper, open, trigger } = mountHarness()

    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    open.value = true
    await nextTick()

    open.value = false
    await nextTick()
    // The restore is deferred a tick, so the panel is unmounted first.
    await nextTick()

    expect(document.activeElement).toBe(trigger)

    wrapper.unmount()
  })

  it('打开面板本身不移动焦点（移入标题由面板负责）', async () => {
    const { wrapper, open, trigger } = mountHarness()

    trigger.focus()
    open.value = true
    await nextTick()

    expect(document.activeElement).toBe(trigger)

    wrapper.unmount()
  })

  it('打开时没有可交还的焦点，关闭后不把焦点丢到 body', async () => {
    const { wrapper, open } = mountHarness()

    // Nothing focusable was touched: `activeElement` is `body`, which is not a
    // meaningful "trigger" and must not be focused on close.
    expect(document.activeElement).toBe(document.body)

    open.value = true
    await nextTick()
    open.value = false
    await nextTick()
    await nextTick()

    expect(document.activeElement).toBe(document.body)

    wrapper.unmount()
  })

  it('触发元素在面板关闭前已被移除时不抛错', async () => {
    const { wrapper, open, trigger } = mountHarness()

    trigger.focus()
    open.value = true
    await nextTick()

    trigger.remove()
    open.value = false
    await nextTick()
    await nextTick()

    expect(document.activeElement).toBe(document.body)

    wrapper.unmount()
  })

  it('连续开关不会把更早的触发元素带进下一轮', async () => {
    const { wrapper, open, trigger } = mountHarness()

    trigger.focus()
    open.value = true
    await nextTick()
    open.value = false
    await nextTick()
    await nextTick()

    // Second round opens with focus on `body` (the restore above left it on the
    // button, then a blur puts it back), so there is nothing to return to.
    trigger.blur()
    open.value = true
    await nextTick()
    open.value = false
    await nextTick()
    await nextTick()

    expect(document.activeElement).toBe(document.body)

    wrapper.unmount()
  })
})
