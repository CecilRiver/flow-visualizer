import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import FlowCanvas from '@/components/graph/FlowCanvas.vue'
import StatusBar from '@/components/layout/StatusBar.vue'
import { resetGraphControllerCache, useGraphController } from '@/composables/useGraphController'
import { useCatalogStore } from '@/stores/catalog'
import { useExplorerStore } from '@/stores/explorer'

import { buildFixtureBundle } from '../fixtures/buildBundle'

/**
 * The degraded layout path, end to end (GRAPH_READABILITY_DESIGN.md 17.3,
 * 18.11).
 *
 * ELK runs in a worker and can fail — a module it cannot load, a graph it
 * refuses. The contract is that the drawing survives and says so: the reader
 * gets the columnar fallback layout *and* a status line stating that this is not
 * the real layout, rather than a plausible-looking graph that is quietly wrong
 * about its own geometry. Both halves are asserted here because either one
 * alone is satisfiable by an accident — a fallback with no notice is a lie, and
 * a notice with no drawing is a blank screen.
 *
 * `layoutGraph` is the seam. It is replaced with a rejection and everything else
 * in the module is kept, so the failure is the real one the controller's
 * `try`/`catch` is written for rather than a stub of the whole layout pipeline.
 * `computeFallbackLayout` lives in `@/layout/fallbackLayout`, a different
 * module, and is therefore the genuine implementation.
 */
vi.mock('@/layout/elkLayout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/layout/elkLayout')>()
  return {
    ...actual,
    layoutGraph: vi.fn(() => Promise.reject(new Error('ELK 不可用'))),
  }
})

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

/**
 * The canvas and the status bar together, because the claim is about both.
 *
 * `ExplorerView` is the component that renders these two in production, but it
 * also pulls in the URL state, the responsive layout and the inspector; mounting
 * it would make this test about the view's wiring. The two leaves are what the
 * contract is on, and they read the same singleton controller either way.
 */
async function mountCanvasAndStatus(): Promise<VueWrapper> {
  const Host = defineComponent({
    setup() {
      return () => h('div', [h(FlowCanvas), h(StatusBar)])
    },
  })
  return mount(Host, { global: { plugins: [pinia] } })
}

describe('ELK 失败时的降级 (18.11)', () => {
  beforeEach(() => {
    setActivePinia(pinia)
    resetGraphControllerCache()
    seedCatalog()
  })

  it('仍然画出节点，并在状态栏说明这是降级排布', async () => {
    const wrapper = await mountCanvasAndStatus()

    await vi.waitFor(
      () => {
        expect(useGraphController().layoutUsedFallback.value).toBe(true)
      },
      { timeout: 10_000 },
    )
    await nextTick()

    // The status is the controller's own name for this state, and it is what the
    // canvas reads to decide it has something to draw rather than a layout still
    // in flight.
    expect(useGraphController().status.value).toBe('layout-fallback')

    expect(
      wrapper.findAll('.vue-flow__node').length,
      '降级后连节点都没有画出来，这条断言就没有意义',
    ).toBeGreaterThan(0)
    expect(wrapper.text()).toContain('布局降级为列式排布')

    wrapper.unmount()
  })

  /*
   * The other half of the same claim, and the one that is easy to miss.
   *
   * A label's position is decided by the collision pass, and that pass runs on
   * the ELK routes. The fallback layout has no routes to place labels against,
   * so it must place none — inventing boxes would put text where the geometry
   * was never checked, which is the failure mode the whole readability pass
   * exists to prevent. The empty count is the assertion; it would be trivially
   * true at a low zoom, so the assertion is that it holds after the layout has
   * reported the fallback, not merely that labels are hidden.
   */
  it('降级排布不画任何行内标签', async () => {
    const wrapper = await mountCanvasAndStatus()

    await vi.waitFor(
      () => {
        expect(useGraphController().layoutUsedFallback.value).toBe(true)
      },
      { timeout: 10_000 },
    )
    await nextTick()

    expect(wrapper.findAll('.semantic-edge__label')).toHaveLength(0)

    wrapper.unmount()
  })
})
