import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NODE_TYPE } from '@/adapters/vueFlow/nodeTypes'
import FlowCanvas from '@/components/graph/FlowCanvas.vue'
import { resetGraphControllerCache, useGraphController } from '@/composables/useGraphController'
import { useCatalogStore } from '@/stores/catalog'
import { useExplorerStore } from '@/stores/explorer'

import { buildFixtureBundle } from '../fixtures/buildBundle'

/**
 * Runtime coverage for the one part of the pipeline that neither the
 * type-checker nor the build can exercise: projection -> ELK -> Vue Flow.
 *
 * The projection and layout units already assert on the graph and the
 * coordinates. What is only observable here is that the resulting elements are
 * actually accepted by Vue Flow, that the three custom node renderers mount, and
 * that a click on a rendered node reaches the store.
 */

/**
 * One Pinia for the whole file: `useGraphController` installs its watchers in a
 * detached effect scope the first time it is called, and those watchers hold
 * whatever stores were active then. A fresh Pinia per test would leave them
 * watching a store nobody writes to any more, and every test after the first
 * would assert against the previous test's graph.
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

function mountCanvas(): VueWrapper {
  return mount(FlowCanvas, { global: { plugins: [pinia] } })
}

/** ELK is imported dynamically, so the first layout resolves a tick or two later. */
async function waitForNodes(wrapper: VueWrapper): Promise<void> {
  await vi.waitFor(
    () => {
      expect(wrapper.findAll('.vue-flow__node').length).toBeGreaterThan(0)
    },
    { timeout: 10_000 },
  )
}

describe('FlowCanvas', () => {
  beforeEach(() => {
    setActivePinia(pinia)
    // Layout results are memoised module-wide, so without this a test could pass
    // on coordinates computed for a previous test's graph.
    resetGraphControllerCache()
    seedCatalog()
  })

  it('draws the projected scenario once layout finishes', async () => {
    const wrapper = mountCanvas()
    await waitForNodes(wrapper)

    const controller = useGraphController()
    expect(controller.status.value).toBe('ready')

    const expected =
      controller.graph.value.nodes.length + controller.graph.value.groups.length
    expect(wrapper.findAll('.vue-flow__node')).toHaveLength(expected)
    expect(wrapper.findAll('.vue-flow__edge').length).toBe(
      controller.graph.value.edges.length,
    )

    wrapper.unmount()
  })

  it('重新扫描同一 model ID 但内容已改时，不复用旧布局（验收 10）', async () => {
    /*
     * The defect this pins, at the level it actually happened.
     *
     * The layout cache was keyed on the *identity* of what was being laid out —
     * bundle id, scenario, level, filters — and every one of those survives a
     * folder rescan. Editing a flow's name in the YAML and hitting 刷新 therefore
     * produced a cache hit, and the previous layout was applied to a graph that
     * no longer existed.
     *
     * Object identity is the precise observable: a cache hit returns the very
     * same `LayoutResult` instance, so `toBe` is true exactly when the stale
     * layout was served.
     */
    const wrapper = mountCanvas()
    await waitForNodes(wrapper)

    const controller = useGraphController()
    const first = controller.layout.value
    expect(first).not.toBeNull()

    // Same bundle id, same scenario, same level, same filters. Only a flow's
    // display name differs — which changes the label's measured width, and with
    // it the box ELK was asked to reserve.
    const catalog = useCatalogStore()
    catalog.validBundles = [
      buildFixtureBundle({ 'flow.measurement': '一个明显更长的测量数据流名称' }),
    ]
    catalog.activateFirstAvailable()

    await vi.waitFor(
      () => {
        expect(controller.layout.value).not.toBe(first)
      },
      { timeout: 10_000 },
    )

    wrapper.unmount()
  })

  it('renders each node through its fixed component type', async () => {
    const wrapper = mountCanvas()
    await waitForNodes(wrapper)

    // The class suffix comes from Vue Flow's own type registration, so this
    // fails if a projection node type has no renderer bound to it.
    expect(wrapper.find(`.vue-flow__node-${NODE_TYPE.business}`).exists()).toBe(true)
    expect(wrapper.find(`.vue-flow__node-${NODE_TYPE.group}`).exists()).toBe(true)
    expect(wrapper.find(`.vue-flow__node-${NODE_TYPE.external}`).exists()).toBe(true)

    wrapper.unmount()
  })

  it('keeps the drawing static: no animated edges, no draggable nodes', async () => {
    const wrapper = mountCanvas()
    await waitForNodes(wrapper)

    // An animated edge reads as live telemetry, which this diagram is not.
    expect(wrapper.find('.vue-flow__edge.animated').exists()).toBe(false)
    expect(wrapper.find('.vue-flow__node.draggable').exists()).toBe(false)

    wrapper.unmount()
  })

  it('always shows the non-timeline disclaimer', async () => {
    const wrapper = mountCanvas()
    await waitForNodes(wrapper)

    expect(wrapper.text()).toContain('语义数据依赖图，非单次循环严格时序')

    wrapper.unmount()
  })

  it('records a node click as a selection and clears it on Escape', async () => {
    const wrapper = mountCanvas()
    await waitForNodes(wrapper)

    const explorer = useExplorerStore()
    expect(explorer.selection).toBeNull()

    const businessNode = wrapper.find(`.vue-flow__node-${NODE_TYPE.business}`)
    await businessNode.trigger('click')

    expect(explorer.selection?.kind).toBe('node')
    expect(explorer.inspectorOpen).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(explorer.selection).toBeNull()

    wrapper.unmount()
  })

  it('records an edge click as a selection too', async () => {
    const wrapper = mountCanvas()
    await waitForNodes(wrapper)

    const explorer = useExplorerStore()
    const edge = wrapper.find('.vue-flow__edge')
    expect(edge.exists()).toBe(true)

    await edge.trigger('click')

    // DESIGN.md 19.2: node *and* edge clicks both open the Inspector; an edge
    // is how a reader reaches the flows behind it.
    expect(explorer.selection?.kind).toBe('edge')
    expect(explorer.inspectorOpen).toBe(true)

    wrapper.unmount()
  })

  it('keeps the declared nodes on screen when the filters hide every flow', async () => {
    const wrapper = mountCanvas()
    await waitForNodes(wrapper)

    const explorer = useExplorerStore()
    const controller = useGraphController()
    const before = wrapper.findAll('.vue-flow__node').length

    // The nodes have to be laid out again for the new filter set, so they are
    // briefly absent; the busy indicator covers that gap.
    explorer.clearFlowKinds()
    await vi.waitFor(() => {
      expect(controller.status.value).toBe('empty-by-filter')
      // Waiting on the DOM alone would pass while the previous picture is still
      // on screen — the filter only takes effect once the projection has been
      // rebuilt and laid out again.
      expect(controller.graph.value.edges).toHaveLength(0)
      expect(controller.layout.value).not.toBeNull()
    })
    await wrapper.vm.$nextTick()

    // DESIGN.md 15.1: a filter that removes every flow must still show the
    // scenario's nodes, with a notice, rather than an empty canvas.
    expect(wrapper.findAll('.vue-flow__node')).toHaveLength(before)
    expect(wrapper.text()).toContain('仅显示场景声明的节点')

    wrapper.unmount()
  })

  it('starts on the empty state when no scenario is selected', async () => {
    const catalog = useCatalogStore()
    catalog.activeScenarioId = null

    const wrapper = mountCanvas()
    const controller = useGraphController()

    // The projection runs in a watcher and the layout follows on a microtask,
    // so the empty state arrives a tick after the scenario is dropped.
    await vi.waitFor(() => {
      expect(controller.status.value).toBe('no-scenario')
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.vue-flow__node')).toHaveLength(0)

    wrapper.unmount()
  })

  /*
   * DESIGN.md 16.2: "节点和边支持键盘选择". Vue Flow does bind Enter/Space on a
   * focused element, but only to its own internal selection — it emits no
   * `nodeClick`, so without the canvas' own capture handler the store stays
   * empty and no Inspector opens.
   */
  describe('键盘选择', () => {
    /** Vue Flow renders `data-id` on both wrappers; that is what we key off. */
    function pressKey(element: Element, key: string): void {
      element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    }

    it('Enter 选中获得焦点的节点，并打开详情', async () => {
      const wrapper = mountCanvas()
      await waitForNodes(wrapper)

      const explorer = useExplorerStore()
      const node = wrapper.find(`.vue-flow__node-${NODE_TYPE.business}`).element

      pressKey(node, 'Enter')
      await wrapper.vm.$nextTick()

      expect(explorer.selection?.kind).toBe('node')
      expect(explorer.inspectorOpen).toBe(true)

      wrapper.unmount()
    })

    it('空格选中获得焦点的边，并打开详情', async () => {
      const wrapper = mountCanvas()
      await waitForNodes(wrapper)

      const explorer = useExplorerStore()
      const edge = wrapper.find('.vue-flow__edge')
      expect(edge.exists()).toBe(true)

      pressKey(edge.element, ' ')
      await wrapper.vm.$nextTick()

      expect(explorer.selection?.kind).toBe('edge')
      expect(explorer.inspectorOpen).toBe(true)

      wrapper.unmount()
    })

    it('Enter 落在节点外的其他按键目标上时不改变选择', async () => {
      const wrapper = mountCanvas()
      await waitForNodes(wrapper)

      const explorer = useExplorerStore()
      pressKey(wrapper.find('.flow-canvas').element, 'Enter')
      await wrapper.vm.$nextTick()

      expect(explorer.selection).toBeNull()

      wrapper.unmount()
    })

    it('画布内部的表单控件保留自己的 Enter 行为', async () => {
      const wrapper = mountCanvas()
      await waitForNodes(wrapper)

      const explorer = useExplorerStore()
      const node = wrapper.find(`.vue-flow__node-${NODE_TYPE.business}`)
      const button = document.createElement('button')
      node.element.appendChild(button)

      pressKey(button, 'Enter')
      await wrapper.vm.$nextTick()

      expect(explorer.selection).toBeNull()

      wrapper.unmount()
    })
  })
})
