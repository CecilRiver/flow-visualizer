import { Position, type EdgeProps, type GraphNode } from '@vue-flow/core'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { describe, expect, it } from 'vitest'

import type { SemanticEdgeData } from '@/adapters/vueFlow/edgeTypes'
import type { BusinessNodeData } from '@/adapters/vueFlow/nodeTypes'
import BusinessComponentNode from '@/components/graph/BusinessComponentNode.vue'
import SemanticFlowEdge from '@/components/graph/SemanticFlowEdge.vue'
import { provideZoomBucket } from '@/components/graph/graphRenderContext'
import type { ProjectedEdge } from '@/domain/view-model'
import { edgePresentation } from '@/layout/edgePresentation'
import type { PlacedLabel } from '@/layout/labelPlacement'
import { EDGE_LABEL_ZOOM } from '@/layout/readabilityOptions'

/**
 * What the renderer draws at each zoom band, and what it says on focus
 * (GRAPH_READABILITY_DESIGN.md 5.1, 5.3, 6.3, 17.3).
 *
 * The renderers are mounted on their own rather than through `FlowCanvas`. Two
 * of these criteria are *about* zoom, so the zoom has to be an input the test
 * owns and can set to a value either side of a threshold; driving it through the
 * canvas would mean clicking a control and asserting on whatever the fit
 * happened to produce. The rest are about a single component's output, and ELK
 * plus the canvas assembly would be noise in front of them.
 *
 * What cannot be checked here is anything needing a real style cascade or real
 * hit testing — jsdom applies no stylesheet and has no `elementFromPoint`. The
 * focus ring (D1) and the label's `pointer-events` are therefore asserted in
 * `e2e/readability.spec.ts` and `e2e/screenshots.spec.ts` against a browser.
 */

/**
 * The zoom factors the tests use, read off the table rather than written out.
 *
 * A literal that happens to sit on the right side of a threshold stops testing
 * anything the moment the threshold moves, and it would not say which side it
 * was meant to be on.
 */
const BELOW_LABEL_THRESHOLD = EDGE_LABEL_ZOOM.hiddenBelow / 2
const ABOVE_LABEL_THRESHOLD = EDGE_LABEL_ZOOM.normalFrom + 0.1
const ABOVE_MARK_THRESHOLD = EDGE_LABEL_ZOOM.detailFrom + 0.1

function projectedEdge(overrides: Partial<ProjectedEdge> = {}): ProjectedEdge {
  return {
    id: 'edge.test',
    source: 'domain.flight_control',
    target: 'domain.actuation',
    kind: 'control',
    label: '姿态角速率控制律计算',
    feedback: false,
    verification: 'docs_and_code_confirmed',
    sourceFlowIds: ['flow.attitude_rate'],
    ...overrides,
  }
}

const placedLabel: PlacedLabel = {
  edgeId: 'edge.test',
  x: 120,
  y: 40,
  width: 96,
  height: 22,
  lines: ['姿态角速率控制律计算'],
  truncated: false,
  visibleByDefault: true,
  issue: null,
}

function edgeData(overrides: Partial<ProjectedEdge> = {}, labelBox: PlacedLabel | null = placedLabel): SemanticEdgeData {
  const edge = projectedEdge(overrides)
  const presentation = edgePresentation({
    edge,
    level: 2,
    nodeLabel: (id) => (id === 'domain.flight_control' ? '飞行控制' : '执行机构'),
  })

  return {
    id: edge.id,
    kind: edge.kind,
    label: edge.label,
    presentation,
    verification: edge.verification,
    feedback: edge.feedback,
    verificationLabel: presentation.accessibleText,
    verificationShortLabel: '',
    flowCount: edge.sourceFlowIds.length,
    sections: [
      {
        id: 'section.0',
        startPoint: { x: 0, y: 30 },
        bendPoints: [{ x: 60, y: 30 }],
        endPoint: { x: 120, y: 30 },
        incomingSections: [],
        outgoingSections: [],
      },
    ],
    labelBox,
    highlighted: false,
    dimmed: false,
  }
}

/**
 * Edge props for a standalone mount.
 *
 * `sourceNode`/`targetNode` are the two fields the renderer never reads — it
 * takes its geometry from the route in `data` and from `sourceX`/`sourceY`,
 * precisely so that a route and a measured handle position cannot disagree
 * (9.1). Real `GraphNode` objects would mean standing up Vue Flow's whole store
 * to hand over something nothing looks at, so they are empty and the fact is
 * stated here rather than hidden in a cast at the call site.
 */
function edgeProps(data: SemanticEdgeData): EdgeProps<SemanticEdgeData> {
  return {
    id: data.id,
    source: 'domain.flight_control',
    target: 'domain.actuation',
    type: 'semantic',
    sourceX: 0,
    sourceY: 30,
    targetX: 120,
    targetY: 30,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    sourceNode: {} as GraphNode,
    targetNode: {} as GraphNode,
    markerStart: '',
    markerEnd: 'url(#arrow)',
    // Only the three fields the renderer never reads are approximated: the two
    // graph nodes and the library's own event hooks, which Vue Flow wires up
    // when it renders an edge itself. See the docblock above.
    events: {} as EdgeProps<SemanticEdgeData>['events'],
    data,
  }
}

/**
 * Mounts the edge with a zoom the test owns.
 *
 * The zoom is a ref handed back to the caller rather than something the test
 * reaches into the component for, so crossing a threshold is a change of input
 * to a mounted component. Remounting at the new zoom would not distinguish "the
 * label appeared because the zoom changed" from "the label appeared because it
 * was rebuilt", which is the whole question in the band tests.
 */
function mountEdge(
  data: SemanticEdgeData,
  zoomValue = ABOVE_LABEL_THRESHOLD,
): { wrapper: VueWrapper; setZoom: (value: number) => Promise<void> } {
  const zoom = ref(zoomValue)
  const Host = defineComponent({
    setup() {
      provideZoomBucket(zoom)
      return () => h(SemanticFlowEdge, edgeProps(data))
    },
  })
  const wrapper = mount(Host)

  return {
    wrapper,
    setZoom: async (value: number) => {
      zoom.value = value
      await wrapper.vm.$nextTick()
    },
  }
}

/**
 * Mounts the edge inside the wrapper Vue Flow renders around it.
 *
 * The wrapper is not decoration. `EdgeWrapper` puts `tabindex` on it, so it is
 * the element that takes focus, and the renderer's own `<g>` is its child;
 * `focusin` bubbles up and never down. A test that mounts the component alone
 * therefore cannot tell "focus opens the tooltip" from "focus opens it only
 * when the browser happens to stop on our own element" — and the browser makes
 * both of them tab stops, one after the other.
 *
 * Reproduced by its class and its nesting, which is what the component reads.
 * The element is created in an HTML document, so it is not really an SVG `g`;
 * nothing under test here depends on the namespace.
 */
function mountEdgeInWrapper(data: SemanticEdgeData): VueWrapper {
  const zoom = ref(ABOVE_LABEL_THRESHOLD)
  const Host = defineComponent({
    setup() {
      provideZoomBucket(zoom)
      return () => h('g', { class: 'vue-flow__edge' }, [h(SemanticFlowEdge, edgeProps(data))])
    },
  })
  return mount(Host)
}

describe('SemanticFlowEdge 的缩放档位（17.3 第 1 条）', () => {
  it('低于隐藏阈值时不画标签，但路线本身照画', async () => {
    const { wrapper } = mountEdge(edgeData(), BELOW_LABEL_THRESHOLD)

    expect(wrapper.find('.semantic-edge__label').exists()).toBe(false)
    // 5.3: the text goes, the edge does not. The line and its oversized hit path
    // are what a click and a Tab land on, and both have to survive the threshold.
    expect(wrapper.find('.semantic-edge__line').exists()).toBe(true)
    expect(wrapper.find('.semantic-edge__hit').exists()).toBe(true)

    wrapper.unmount()
  })

  it('越过阈值后标签出现，再退回去又消失', async () => {
    const { wrapper, setZoom } = mountEdge(edgeData(), BELOW_LABEL_THRESHOLD)
    expect(wrapper.find('.semantic-edge__label').exists()).toBe(false)

    await setZoom(ABOVE_LABEL_THRESHOLD)
    expect(wrapper.find('.semantic-edge__label').exists()).toBe(true)

    await setZoom(BELOW_LABEL_THRESHOLD)
    expect(wrapper.find('.semantic-edge__label').exists()).toBe(false)

    wrapper.unmount()
  })

  /*
   * 5.3 reserves the mark's width in *every* band, not only the one that draws
   * it. That is what lets the mark appear on zoom without the label changing
   * size — and a label changing size is a label whose collisions were checked
   * against a box it no longer occupies. So the box has to measure the same in
   * both visible bands; only the mark's presence differs.
   */
  it('验证标记只在细节档位出现，而标签盒在两个可见档位一样大', async () => {
    const { wrapper, setZoom } = mountEdge(edgeData(), ABOVE_LABEL_THRESHOLD)
    const sizes: { width: string; height: string }[] = []

    for (const zoomValue of [ABOVE_LABEL_THRESHOLD, ABOVE_MARK_THRESHOLD]) {
      await setZoom(zoomValue)
      const style = (wrapper.find('.semantic-edge__label').element as HTMLElement).style
      sizes.push({ width: style.width, height: style.height })
    }

    expect(sizes[1]).toEqual(sizes[0])
    expect(sizes[0]?.width).toBe(`${String(placedLabel.width)}px`)

    await setZoom(ABOVE_LABEL_THRESHOLD)
    expect(wrapper.find('.semantic-edge__mark').exists()).toBe(false)
    await setZoom(ABOVE_MARK_THRESHOLD)
    expect(wrapper.find('.semantic-edge__mark').exists()).toBe(true)

    wrapper.unmount()
  })

  it('布局没放下标签时，任何档位都不画标签', () => {
    const unplaced: PlacedLabel = { ...placedLabel, x: 0, y: 0, visibleByDefault: false }
    const { wrapper } = mountEdge(edgeData({}, unplaced), ABOVE_MARK_THRESHOLD)

    expect(wrapper.find('.semantic-edge__label').exists()).toBe(false)

    wrapper.unmount()
  })
})

describe('SemanticFlowEdge 的箭头（9.2、17.4 第 5 条）', () => {
  /*
   * The regression this pins was invisible to every existing test.
   *
   * The projection asks Vue Flow for an arrow marker and Vue Flow emits the
   * `<marker>` definition for it, so `toVueFlowElements.spec.ts` saw a correctly
   * configured edge and passed. But a definition nothing references paints
   * nothing: the built-in edge types are the ones that bind `marker-end` to
   * their path, and a custom renderer has to do it itself. Until it did, every
   * edge in the graph was drawn headless.
   */
  it('路线终点一侧绑定了箭头，起点一侧没有', () => {
    const { wrapper } = mountEdge(edgeData())

    const line = wrapper.find('.semantic-edge__line')
    // The value Vue Flow hands down, passed through unchanged — it is the
    // `url(...)` that ties this path to the marker definition.
    expect(line.attributes('marker-end')).toBe('url(#arrow)')
    expect(line.attributes('marker-start')).toBeUndefined()

    wrapper.unmount()
  })

  /*
   * The same convention for a feedback edge, which is where it was got wrong
   * (9.2). A feedback flow's arrow belongs at its `to` end like any other: the
   * direction arrows express is "into the consumer", and reversing that for
   * feedback would say the provider is the one being fed.
   */
  it('反馈边同样只在终点一侧画箭头', () => {
    const { wrapper } = mountEdge(edgeData({ feedback: true, kind: 'feedback' }))

    const line = wrapper.find('.semantic-edge__line')
    expect(line.attributes('marker-end')).toBe('url(#arrow)')
    expect(line.attributes('marker-start')).toBeUndefined()

    wrapper.unmount()
  })
})

describe('SemanticFlowEdge 的完整句柄（5.1、17.3 第 3 条）', () => {
  it('Vue Flow 的包装元素获得焦点时，tooltip 一样打开', async () => {
    const data = edgeData()
    const wrapper = mountEdgeInWrapper(data)
    expect(wrapper.find('.semantic-edge__tooltip').exists()).toBe(false)

    // The wrapper, not the renderer's own group: this is the element the
    // browser actually tabs onto, and the one a failure here would leave silent.
    await wrapper.find('.vue-flow__edge').trigger('focusin')
    expect(wrapper.find('.semantic-edge__tooltip').text()).toBe(data.presentation.accessibleText)

    await wrapper.find('.vue-flow__edge').trigger('focusout')
    expect(wrapper.find('.semantic-edge__tooltip').exists()).toBe(false)

    wrapper.unmount()
  })


  it('焦点与悬停各自打开 tooltip，文本是完整的无障碍句', async () => {
    const data = edgeData()
    const { wrapper } = mountEdge(data)

    expect(wrapper.find('.semantic-edge__tooltip').exists()).toBe(false)

    await wrapper.find('.semantic-edge').trigger('focusin')
    const tooltip = wrapper.find('.semantic-edge__tooltip')
    expect(tooltip.exists()).toBe(true)
    expect(tooltip.text()).toBe(data.presentation.accessibleText)
    // `role="tooltip"` and not a bare div: this is the same affordance the node
    // cards expose through Element Plus, and a screen reader should meet it as
    // the same kind of thing.
    expect(tooltip.attributes('role')).toBe('tooltip')

    await wrapper.find('.semantic-edge').trigger('focusout')
    expect(wrapper.find('.semantic-edge__tooltip').exists()).toBe(false)

    // The pointer half. Both are wired because the two audiences are different:
    // a mouse user never focuses an edge, and a keyboard user never hovers one.
    await wrapper.find('.semantic-edge').trigger('mouseenter')
    expect(wrapper.find('.semantic-edge__tooltip').exists()).toBe(true)
    await wrapper.find('.semantic-edge').trigger('mouseleave')
    expect(wrapper.find('.semantic-edge__tooltip').exists()).toBe(false)

    wrapper.unmount()
  })

  /*
   * The claim that used to be asserted in `edgePresentation.spec.ts` against a
   * function with no zoom input — true for every zoom, therefore about nothing.
   * Here the zoom is real and the sentence has to survive all three bands: a
   * screen reader must not lose the wording because the sighted reader zoomed
   * out, and a sighted keyboard user must not either.
   */
  it('句子在三个档位下完全相同，隐藏标签的档位也不例外', async () => {
    const data = edgeData()
    const { wrapper, setZoom } = mountEdge(data, BELOW_LABEL_THRESHOLD)

    for (const zoomValue of [BELOW_LABEL_THRESHOLD, ABOVE_LABEL_THRESHOLD, ABOVE_MARK_THRESHOLD]) {
      await setZoom(zoomValue)
      await wrapper.find('.semantic-edge').trigger('focusin')
      expect(wrapper.find('.semantic-edge__tooltip').text(), `zoom=${String(zoomValue)}`).toBe(
        data.presentation.accessibleText,
      )
    }

    wrapper.unmount()
  })

  it('没放下标签的边，tooltip 落在路线中点上而不是画布原点', async () => {
    const unplaced: PlacedLabel = { ...placedLabel, x: 0, y: 0, visibleByDefault: false }
    const { wrapper } = mountEdge(edgeData({}, unplaced))

    await wrapper.find('.semantic-edge').trigger('focusin')
    const tooltip = wrapper.find('.semantic-edge__tooltip')

    // The route runs (0,30) → (120,30), so the midpoint is (60,30). Anchoring on
    // the unplaced box would put it at the graph origin, which is where the
    // layout stores a label it could not place.
    expect(tooltip.attributes('style')).toContain('left: 60px')
    expect(tooltip.attributes('style')).toContain('top: 30px')

    wrapper.unmount()
  })
})

describe('选择只改变强调，不改变几何（17.3 第 5 条）', () => {
  /*
   * Selection is a class name and nothing else (DESIGN.md 19.2). The route in
   * `d` is the observable that matters: the same edge drawn from the same layout
   * must produce the same path whether or not it is in the selection
   * neighbourhood. A renderer that recomputed the route from its own state — or
   * that shortened it for a dimmed edge — would show up here as two different
   * strings.
   */
  it('highlighted 与 dimmed 只改 class，路线一字不变', () => {
    const plain = mountEdge(edgeData())
    const highlighted = mountEdge({ ...edgeData(), highlighted: true })
    const dimmed = mountEdge({ ...edgeData(), dimmed: true })

    const paths = [plain, highlighted, dimmed].map(
      (mounted) => mounted.wrapper.find('.semantic-edge__line').attributes('d'),
    )
    expect(paths[0]).toBeDefined()
    expect(paths[1]).toBe(paths[0])
    expect(paths[2]).toBe(paths[0])

    expect(highlighted.wrapper.find('.semantic-edge').classes()).toContain('is-highlighted')
    expect(dimmed.wrapper.find('.semantic-edge').classes()).toContain('is-dimmed')
    expect(plain.wrapper.find('.semantic-edge').classes()).not.toContain('is-highlighted')

    plain.wrapper.unmount()
    highlighted.wrapper.unmount()
    dimmed.wrapper.unmount()
  })
})

describe('BusinessComponentNode 的职责提示（17.3 第 4 条）', () => {
  const nodeData: BusinessNodeData = {
    id: 'l2.attitude',
    label: '姿态控制',
    level: 2,
    kind: 'controller',
    kindLabel: '控制器',
    verification: 'docs_and_code_confirmed',
    verificationLabel: '文档与代码已确认',
    verificationShortLabel: '文档+代码',
    verificationGlyph: 'DC',
    portCounts: { inputs: 1, outputs: 1 },
    ports: [],
    hiddenFlowCount: 0,
    responsibility: '按姿态误差计算角速率指令',
    summary: '保持姿态',
  }

  /*
   * Structure only, deliberately.
   *
   * `ElTooltip` teleports its popper to `document.body` and mounts it on
   * demand, so asserting the bubble appeared here would be asserting that
   * Element Plus works, in a jsdom with no layout. What the *node* is
   * responsible for is that the truncated line is a real tab stop and that the
   * tooltip is wired to focus and not only to hover — the defect this pins is
   * exactly a hover-only `title`. Whether the bubble actually opens for a
   * keyboard user is checked in a browser, in `e2e/readability.spec.ts`.
   */
  it('被截断的职责行是键盘可达的 tab 停靠点', () => {
    const wrapper = mount(BusinessComponentNode, {
      props: { data: nodeData },
      global: { stubs: { Handle: true } },
    })

    const line = wrapper.find('.business-node__responsibility')
    expect(line.exists()).toBe(true)
    expect(line.attributes('tabindex')).toBe('0')

    wrapper.unmount()
  })

  it('职责提示挂在 hover 与 focus 两个触发上', () => {
    const wrapper = mount(BusinessComponentNode, {
      props: { data: nodeData },
      global: { stubs: { Handle: true } },
    })

    const tooltips = wrapper.findAllComponents({ name: 'ElTooltip' })
    expect(tooltips.length).toBeGreaterThan(0)

    const triggers = tooltips.flatMap((tooltip) => tooltip.props('trigger') as string[])
    expect(triggers).toContain('hover')
    expect(triggers).toContain('focus')

    wrapper.unmount()
  })
})
