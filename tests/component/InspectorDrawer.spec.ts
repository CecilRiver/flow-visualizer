import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import InspectorDrawer from '@/components/inspector/InspectorDrawer.vue'
import {
  resetGraphControllerCache,
  selectionForEdge,
  selectionForNode,
  useGraphController,
} from '@/composables/useGraphController'
import { useSelectionDetails } from '@/composables/useSelectionDetails'
import type { ProjectedEdge, ProjectedNode } from '@/domain/view-model'
import { useCatalogStore } from '@/stores/catalog'
import { useExplorerStore } from '@/stores/explorer'

import { buildFixtureBundle } from '../fixtures/buildBundle'

/**
 * The Inspector's own rules (DESIGN.md 14, 19.2).
 *
 * The drawer takes an already-resolved `SelectionDetails`, so these cases mount
 * it with the real resolution pipeline behind it — stores seeded, selection set,
 * composable evaluated — but assert only on what the drawer renders. That is
 * the distinction the tests exist for: a single flow and an aggregated edge must
 * not look the same, and an aggregate must never claim one contract when its
 * flows disagree.
 */

const pinia = createPinia()

/** The layout is irrelevant here, so the store is seeded and never rendered. */
function seedCatalog(): void {
  const catalog = useCatalogStore()
  const explorer = useExplorerStore()
  catalog.clear()
  explorer.reset()
  catalog.validBundles = [buildFixtureBundle()]
  catalog.status = 'ready'
  catalog.activateFirstAvailable()
}

function mountDrawer(): VueWrapper {
  const { details, review } = useSelectionDetails()
  return mount(InspectorDrawer, {
    props: { details: details.value, review: review.value },
  })
}

/**
 * A drawer mounted into the document, which is the only way `document.
 * activeElement` can be asserted — focus does not move into a detached tree.
 */
function mountDrawerAttached(): VueWrapper {
  const { details, review } = useSelectionDetails()
  return mount(InspectorDrawer, {
    props: { details: details.value, review: review.value },
    attachTo: document.body,
  })
}

/**
 * L1 is where the fixture folds flows and aggregates edges: the same L2 flows
 * collapse onto two capability domains, and a pair of them share an edge.
 */
async function useLevel1(): Promise<void> {
  useExplorerStore().setLevel(1)
  // The projection runs in a watcher, so the graph is not there yet.
  await nextTick()
}

/** Selects an element by predicate, then applies the projection. */
function selectEdge(match: (edge: ProjectedEdge) => boolean): ProjectedEdge {
  const controller = useGraphController()
  const edge = controller.graph.value.edges.find(match)
  if (edge === undefined) throw new Error('no matching projected edge')
  controller.select(selectionForEdge(edge))
  return edge
}

function selectNodeWithHiddenFlows(): ProjectedNode {
  const controller = useGraphController()
  const node = controller.graph.value.nodes.find(
    (entry) => entry.hiddenInternalFlowIds.length > 0,
  )
  if (node === undefined) throw new Error('fixture folds no flows at this level')
  useExplorerStore().select(selectionForNode(node))
  return node
}

describe('InspectorDrawer', () => {
  beforeEach(() => {
    setActivePinia(pinia)
    resetGraphControllerCache()
    seedCatalog()
  })

  // The focus case mounts into the document; leaving it behind would leak a
  // drawer into the next test's `document.activeElement`.
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('lists every component behind a projected node', () => {
    const controller = useGraphController()
    const explorer = useExplorerStore()
    const node = controller.graph.value.nodes[0]
    if (node === undefined) throw new Error('fixture has no projected node')

    explorer.select(selectionForNode(node))
    const wrapper = mountDrawer()

    expect(wrapper.find('.component-details').exists()).toBe(true)
    expect(wrapper.text()).toContain(node.label)
    // 14.3: the model-wide review status is shown apart from item verification.
    expect(wrapper.find('.inspector__footer').exists()).toBe(true)
  })

  it('renders a single-flow edge directly, without an aggregate wrapper', () => {
    const edge = selectEdge(
      (candidate) => candidate.sourceFlowIds.length === 1 && candidate.kind === 'state',
    )
    const wrapper = mountDrawer()

    expect(edge.sourceFlowIds).toHaveLength(1)
    expect(wrapper.text()).toContain('单条 flow')
    expect(wrapper.find('.flow-details').exists()).toBe(true)
    expect(wrapper.find('.inspector__disclosure').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('聚合了')
  })

  it('shows an aggregated edge as a summary plus one row per underlying flow', async () => {
    await useLevel1()
    const edge = selectEdge((candidate) => candidate.sourceFlowIds.length > 1)
    const wrapper = mountDrawer()

    expect(wrapper.text()).toContain(`聚合了 ${String(edge.sourceFlowIds.length)} 条原始 flow`)

    // One outer disclosure for the list, plus one nested disclosure per flow.
    const nested = wrapper.findAll('.inspector__disclosure--nested')
    expect(nested).toHaveLength(edge.sourceFlowIds.length)
    expect(wrapper.text()).toContain('不采用多数表决')
  })

  it('lists every contract of an aggregate instead of picking one', async () => {
    await useLevel1()
    selectEdge((candidate) => candidate.sourceFlowIds.length > 1)
    const wrapper = mountDrawer()

    // The fixture's two aggregated flows carry different contracts. Scoped to
    // the edge's own summary — each underlying flow lists its own contract too.
    expect(wrapper.text()).toContain('2 个 data contract 并不相同')
    expect(wrapper.findAll('.inspector__section .contract-details__contract')).toHaveLength(2)
  })

  it('states the verification of the aggregate, not of its first flow', async () => {
    await useLevel1()

    // One flow is `inferred`, the other `docs_and_code_confirmed`. The most
    // conservative wins, so the aggregate must read as inferred.
    const edge = selectEdge((candidate) => candidate.sourceFlowIds.length > 1)
    const index = useCatalogStore().activeBundle?.index
    if (index === undefined) throw new Error('no active bundle')

    const verifications = edge.sourceFlowIds.map(
      (flowId) => index.flowsById.get(flowId)?.verification,
    )
    expect(verifications).toContain('inferred')
    expect(edge.verification).toBe('inferred')

    const wrapper = mountDrawer()
    expect(wrapper.find('.verification-badge').text()).toContain('推断')
  })

  it('exposes raw flows that were folded onto a node', async () => {
    await useLevel1()
    selectNodeWithHiddenFlows()

    const wrapper = mountDrawer()
    expect(wrapper.text()).toContain('折叠的内部流程')
    expect(wrapper.find('.inspector__item').exists()).toBe(true)
  })

  it('emits close and source-item selections instead of acting on stores', async () => {
    await useLevel1()
    const node = selectNodeWithHiddenFlows()

    const wrapper = mountDrawer()
    await wrapper.find('.inspector__close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)

    await wrapper.find('.inspector__item').trigger('click')
    expect(wrapper.emitted('selectSourceItem')?.[0]).toEqual([
      { kind: 'flow', id: node.hiddenInternalFlowIds[0] },
    ])
  })

  /*
   * DESIGN.md 16.2: "Inspector 打开时焦点移入标题，关闭后返回触发元素". The
   * return half belongs to `ExplorerView` (it owns the open/closed flag) and is
   * covered in `tests/unit/useFocusReturn.spec.ts`; this is the drawer's half.
   *
   * Focus needs a document to land in, hence `attachTo`; every case here
   * unmounts, and `document.body` is cleared between tests.
   */
  it('打开时把焦点移入标题，且标题不占用 Tab 顺序', async () => {
    await useLevel1()
    selectNodeWithHiddenFlows()

    const wrapper = mountDrawerAttached()
    const title = wrapper.find('.inspector__title')

    expect(title.exists()).toBe(true)
    expect(document.activeElement).toBe(title.element)
    // `-1`, not `0`: focusable for this one move, but not a new stop in the
    // reader's Tab order (DESIGN.md 16.2).
    expect(title.attributes('tabindex')).toBe('-1')

    wrapper.unmount()
  })
})
