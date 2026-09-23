import type { Edge as VueFlowEdge, Node as VueFlowNode } from '@vue-flow/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EDGE_TYPE } from '@/adapters/vueFlow/edgeTypes'
import {
  NODE_TYPE,
  type BusinessNodeData,
  type GroupNodeData,
  type NodePortHandle,
} from '@/adapters/vueFlow/nodeTypes'
import {
  levelLabel,
  toVueFlowElements,
  type VueFlowElements,
} from '@/adapters/vueFlow/toVueFlowElements'
import { buildModelIndex, type LoadedBundle } from '@/domain/indexes'
import { COMPONENT_KIND_LABEL, VERIFICATION_LABEL } from '@/domain/labels'
import type { Component, Flow, FlowKind, GraphLevel, Port } from '@/domain/model'
import type { ProjectedGraph, ProjectedNode } from '@/domain/view-model'
import { computeFallbackLayout } from '@/layout/fallbackLayout'
import type { LayoutResult } from '@/layout/elkLayout'
import { GROUP_PADDING, GROUP_MIN_SIZE, sizeForNode } from '@/layout/nodeMetrics'
import { GROUP_ID_PREFIX, buildOrderMaps, projectScenario } from '@/projection/projectScenario'
import { selectScenario } from '@/projection/selectScenario'

import { buildFixtureBundle } from '../fixtures/buildBundle'
import { makeComponent, makeFlow, makeModel, makeScenario } from '../fixtures/buildModel'
import { ALL_FLOW_KINDS, ALL_VERIFICATIONS, projectFixture } from './helpers/projectFixture'

/**
 * Adapter unit tests (DESIGN.md 19.1: 稳定 ID、handle、readonly flags、route points).
 *
 * Projection and layout have suites of their own; what is left to assert is the
 * step between them and Vue Flow. Beyond the four headline cases this file pins
 * the graph-semantics promises the project makes about the drawing: it is a
 * static report (no animation, nothing draggable, connectable or deletable),
 * Vue Flow never becomes a second source of truth (no state written back, no
 * domain objects smuggled into element state), nesting uses parent-relative
 * coordinates, and selection is a class name rather than a data mutation.
 */

/**
 * One flow of each interesting shape, on top of the canonical synthetic model:
 * a boundary crossing, a forward edge, a feedback and an actuation. Enough
 * groups (two domains, two L2 children each) to exercise nesting at L2.
 */
const VIEW_FLOWS = [
  { id: 'flow.rc_attitude', from: 'ext.rc', to: 'l2.attitude', kind: 'command' },
  { id: 'flow.ahrs_attitude', from: 'l2.ahrs', to: 'l2.attitude', kind: 'state' },
  { id: 'flow.attitude_rate', from: 'l2.attitude', to: 'l2.rate', kind: 'control' },
  { id: 'flow.rate_motors', from: 'l2.rate', to: 'ext.motors', kind: 'actuation' },
  { id: 'flow.rate_feedback', from: 'l2.rate', to: 'l2.attitude', kind: 'feedback', feedback: true },
] as const

// Built from the projection's own prefix: a display container is identified by
// that prefix and nothing else (DESIGN.md 10.5).
const CONTROLLER_GROUP = `${GROUP_ID_PREFIX}domain.control`

/** The component index of the same synthetic model the projection fixtures use. */
const FIXTURE_COMPONENTS_BY_ID: ReadonlyMap<string, Component> =
  buildFixtureBundle().index.componentsById

function graphAt(level: GraphLevel): ProjectedGraph {
  return projectFixture({ level, flows: VIEW_FLOWS })
}

interface BuildOptions {
  layout?: LayoutResult
  /** Defaults to L2, the projection the app opens on. */
  level?: GraphLevel
  componentsById?: ReadonlyMap<string, Component>
  highlightedNodeIds?: ReadonlySet<string>
  highlightedEdgeIds?: ReadonlySet<string>
  hasSelection?: boolean
}

/** Adapter call with the fixture's component index, unless a case needs another. */
function build(graph: ProjectedGraph, options: BuildOptions = {}): VueFlowElements {
  return toVueFlowElements({
    graph,
    layout: options.layout ?? computeFallbackLayout(graph),
    level: options.level ?? 2,
    componentsById: options.componentsById ?? FIXTURE_COMPONENTS_BY_ID,
    highlightedNodeIds: options.highlightedNodeIds,
    highlightedEdgeIds: options.highlightedEdgeIds,
    hasSelection: options.hasSelection ?? false,
  })
}

function nodeOf(elements: VueFlowElements, id: string): VueFlowNode {
  const node = elements.nodes.find((entry) => entry.id === id)
  if (node === undefined) throw new Error(`no node element for ${id}`)
  return node
}

function edgeOf(elements: VueFlowElements, id: string): VueFlowEdge {
  const edge = elements.edges.find((entry) => entry.id === id)
  if (edge === undefined) throw new Error(`no edge element for ${id}`)
  return edge
}

function projectedNodeOf(graph: ProjectedGraph, id: string): ProjectedNode {
  const node = graph.nodes.find((entry) => entry.id === id)
  if (node === undefined) throw new Error(`no projected node for ${id}`)
  return node
}

/** Node/edge data is a render contract with a known shape; the cast is the seam. */
function dataOf<T>(element: VueFlowNode | VueFlowEdge): T {
  return element.data as T
}

function classesOf(element: VueFlowNode | VueFlowEdge): string[] {
  const value = element.class
  return typeof value === 'string' ? value.split(' ') : []
}

/**
 * Cases that hand the adapter a deliberately incomplete layout make it warn
 * about the mismatch; the warning itself is asserted once, and the rest of the
 * file keeps the reporter's output readable.
 */
function silenceLayoutWarning(): void {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
}

const NODE_FIELDS = new Set([
  'id',
  'type',
  'position',
  'data',
  'width',
  'height',
  'class',
  'ariaLabel',
  'parentNode',
  'draggable',
  'connectable',
  'deletable',
  'selectable',
  'focusable',
])

const EDGE_FIELDS = new Set([
  'id',
  'type',
  'source',
  'target',
  'sourceHandle',
  'targetHandle',
  'data',
  'selectable',
  'focusable',
  'updatable',
  'deletable',
  'animated',
  'markerStart',
  'markerEnd',
  'class',
  'ariaLabel',
  'domAttributes',
])

afterEach(() => {
  vi.restoreAllMocks()
})

describe('toVueFlowElements — 稳定 ID', () => {
  it('元素 ID 与投影 ID 逐一对齐，且没有重复', () => {
    const graph = graphAt(2)
    const elements = build(graph)

    expect(elements.nodes.map((node) => node.id).sort()).toEqual(
      [...graph.groups.map((group) => group.id), ...graph.nodes.map((node) => node.id)].sort(),
    )
    expect(elements.edges.map((edge) => edge.id)).toEqual(graph.edges.map((edge) => edge.id))

    // Vue Flow keys its internal state by element id: a duplicate would make one
    // of the two elements unreachable and unselectable.
    expect(new Set(elements.nodes.map((node) => node.id)).size).toBe(elements.nodes.length)
    expect(new Set(elements.edges.map((edge) => edge.id)).size).toBe(elements.edges.length)
  })

  it('同一输入两次转换得到完全相同的元素，坐标不随调用顺序漂移', () => {
    const graph = graphAt(2)
    const layout = computeFallbackLayout(graph)

    const first = build(graph, { layout })
    const second = build(graph, { layout })

    expect(first.nodes.map((node) => [node.id, node.position.x, node.position.y])).toEqual(
      second.nodes.map((node) => [node.id, node.position.x, node.position.y]),
    )
  })

  it('group 节点排在它的子节点之前，Vue Flow 才能解析 parentNode', () => {
    const elements = build(graphAt(2))

    const indexById = new Map(elements.nodes.map((node, index) => [node.id, index]))
    const children = elements.nodes.filter((node) => node.parentNode !== undefined)
    expect(children.length).toBeGreaterThan(0)

    for (const child of children) {
      const parentIndex = indexById.get(child.parentNode ?? '')
      const childIndex = indexById.get(child.id)
      expect(parentIndex, `missing parent ${String(child.parentNode)}`).toBeDefined()
      expect(childIndex, `missing child ${child.id}`).toBeDefined()
      expect(parentIndex ?? -1).toBeLessThan(childIndex ?? -1)
    }
  })

  it('每条边的端点都指向已经生成的节点，不留悬空引用', () => {
    const elements = build(graphAt(1))
    const nodeIds = new Set(elements.nodes.map((node) => node.id))

    for (const edge of elements.edges) {
      expect(nodeIds.has(edge.source), `dangling source ${edge.source}`).toBe(true)
      expect(nodeIds.has(edge.target), `dangling target ${edge.target}`).toBe(true)
    }
  })

  it('布局没有给出坐标的节点被跳过，而不是画在原点冒充业务数据', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const graph = graphAt(2)
    const full = computeFallbackLayout(graph)
    // `l2.imu` is deliberately left out: only a layout/adapter mismatch can
    // produce this, and drawing it at (0,0) would look like a real position.
    const layout: LayoutResult = {
      ...full,
      nodes: full.nodes.filter((node) => node.id !== 'l2.imu'),
    }

    const elements = build(graph, { layout })

    expect(elements.nodes.map((node) => node.id)).not.toContain('l2.imu')
    expect(elements.nodes).toHaveLength(graph.nodes.length + graph.groups.length - 1)

    const warning = warnSpy.mock.calls.at(0)
    expect(warning?.[1]).toEqual(['l2.imu'])
  })
})

describe('toVueFlowElements — 只读与静态语义', () => {
  it('每个节点都不可拖拽、不可连接、不可删除，但可选中、可聚焦', () => {
    const elements = build(graphAt(2))
    expect(elements.nodes.length).toBeGreaterThan(0)

    for (const node of elements.nodes) {
      expect(node.draggable, node.id).toBe(false)
      expect(node.connectable, node.id).toBe(false)
      expect(node.deletable, node.id).toBe(false)
      expect(node.selectable, node.id).toBe(true)
      expect(node.focusable, node.id).toBe(true)
    }
  })

  it('每条边都不带动画，且不可更新', () => {
    const elements = build(graphAt(2))
    expect(elements.edges.length).toBeGreaterThan(0)

    for (const edge of elements.edges) {
      // Motion would read as live telemetry or a strict execution order
      // (DESIGN.md 10.5, 13.4).
      expect(edge.animated, edge.id).toBe(false)
      expect(edge.updatable, edge.id).toBe(false)
      expect(edge.selectable, edge.id).toBe(true)
      expect(edge.focusable, edge.id).toBe(true)
    }
  })

  /*
   * Vue Flow deletes a selected edge on Backspace by default (`deleteKeyCode`
   * is never overridden in `FlowCanvas.vue`), so an edge left deletable would
   * let the keyboard drop it and leave the canvas showing one edge fewer than
   * the projection — the "Vue Flow is never a second source of truth" case the
   * canvas documents. Nodes are non-deletable for the same reason.
   */
  it('每条边同样不可删除，键盘不能把画布删成与投影不一致', () => {
    const elements = build(graphAt(2))
    expect(elements.edges.length).toBeGreaterThan(0)
    for (const edge of elements.edges) expect(edge.deletable, edge.id).toBe(false)
  })

  /*
   * DESIGN.md 13.4 gives feedback edges a 反向箭头: the arrowhead belongs at the
   * source end, because a feedback flow runs back against the direction the
   * layout draws. Colour and dashing already separate it from a forward edge;
   * only the arrow states which way it actually goes.
   */
  it('反馈边的箭头在源端，普通边的箭头在目标端', () => {
    const graph = graphAt(2)
    const elements = build(graph)

    const feedback = elements.edges.find(
      (edge) => edge.id === edgeOfFlow(graph, 'flow.rate_feedback').id,
    )
    const forward = elements.edges.find(
      (edge) => edge.id === edgeOfFlow(graph, 'flow.attitude_rate').id,
    )
    expect(feedback?.data?.feedback).toBe(true)
    expect(forward?.data?.feedback).toBe(false)

    expect(feedback?.markerStart).toBeDefined()
    expect(feedback?.markerEnd).toBeUndefined()
    expect(forward?.markerEnd).toBeDefined()
    expect(forward?.markerStart).toBeUndefined()
  })

  it('每条边恰好只有一个箭头，方向不重复也不丢失', () => {
    const elements = build(graphAt(2))

    for (const edge of elements.edges) {
      const heads = [edge.markerStart, edge.markerEnd].filter((marker) => marker !== undefined)
      expect(heads, edge.id).toHaveLength(1)
    }
  })

  /*
   * The attribute name is the whole test. Vue Flow's own `focusable` renders
   * `tabIndex` on an SVG `<g>`, where names are case-sensitive, so that
   * attribute is inert and the edge cannot be reached by keyboard at all — a
   * defect that only shows up against a real browser, which is why it is
   * checked here by name as well as end-to-end in `e2e/path4`.
   */
  it('边带有小写 tabindex，否则 SVG 上不可聚焦', () => {
    const elements = build(graphAt(2))

    expect(elements.edges.length).toBeGreaterThan(0)
    for (const edge of elements.edges) {
      expect(edge.focusable, edge.id).toBe(true)
      expect(edge.domAttributes?.['tabindex'], edge.id).toBe('0')
    }
  })

  it('节点类型取自固定映射：group / external / business', () => {
    const elements = build(graphAt(2))

    expect(nodeOf(elements, CONTROLLER_GROUP).type).toBe(NODE_TYPE.group)
    expect(nodeOf(elements, 'ext.rc').type).toBe(NODE_TYPE.external)
    expect(nodeOf(elements, 'l2.attitude').type).toBe(NODE_TYPE.business)
    for (const edge of elements.edges) expect(edge.type).toBe(EDGE_TYPE.semantic)
  })

  it('适配器不把画布状态写回投影数据（单向数据流）', () => {
    const graph = graphAt(2)
    const layout = computeFallbackLayout(graph)
    const before = JSON.stringify(graph)

    build(graph, { layout, hasSelection: true })

    expect(JSON.stringify(graph)).toBe(before)
    // Vue Flow's own vocabulary must never appear on a projected node.
    for (const node of graph.nodes) {
      expect(Object.keys(node)).not.toContain('position')
      expect(Object.keys(node)).not.toContain('parentNode')
    }
  })

  it('元素对象只带 Vue Flow 认识的字段，不夹带域对象或投影数组', () => {
    const graph = graphAt(2)
    const elements = build(graph)

    for (const node of elements.nodes) {
      for (const key of Object.keys(node)) expect(NODE_FIELDS.has(key), `${node.id}.${key}`).toBe(true)
    }
    for (const edge of elements.edges) {
      for (const key of Object.keys(edge)) expect(EDGE_FIELDS.has(key), `${edge.id}.${key}`).toBe(true)
    }
  })

  it('节点数据是渲染摘要（计数），不是域集合的引用', () => {
    const graph = graphAt(1)
    const elements = build(graph)
    // At L1 `flow.attitude_rate` runs between two L2 components of the same
    // domain, so it folds into that node and has no edge of its own.
    const projected = projectedNodeOf(graph, 'domain.control')
    const data = dataOf<BusinessNodeData>(nodeOf(elements, 'domain.control'))

    expect(Array.from(projected.hiddenInternalFlowIds)).toEqual([
      'flow.attitude_rate',
      'flow.rate_feedback',
    ])
    // The folded flows stay in the projection; the node only carries how many
    // there are, so a render can never walk back into the raw configuration.
    expect(data.hiddenFlowCount).toBe(projected.hiddenInternalFlowIds.length)
    expect(typeof data.hiddenFlowCount).toBe('number')
  })

  it('缺失组件时按最弱状态着色，但文案明确说“未声明”', () => {
    const elements = build(graphAt(2), { componentsById: new Map() })
    const data = dataOf<BusinessNodeData>(nodeOf(elements, 'l2.attitude'))

    // The colour token is the weakest one, so a component whose configuration
    // never reached the adapter can never look confirmed...
    expect(data.verification).toBe('inferred')
    // ...while the text says plainly that nothing was declared, instead of
    // claiming the model asserted `inferred`.
    expect(data.verificationLabel).toBe('未声明')
    expect(data.verificationShortLabel).toBe('未声明')
    expect(data.verificationGlyph).toBe('·')
    expect(data.verificationLabel).not.toContain('确认')
    expect(data.verificationLabel).not.toBe(VERIFICATION_LABEL.inferred)
  })
})

/*
 * The synthetic model only declares the ports `in`/`out` that the flow
 * endpoints reference, which cannot tell "kept the declared port" apart from
 * "used the generic fallback" — both are `out`/`in`. This fixture declares
 * ports with real names so the two paths are distinguishable.
 */
function port(id: string, direction: 'input' | 'output'): Port {
  return { id, name: id, direction, data_contract_id: 'data.test' }
}

function handleComponents(): Component[] {
  return [
    { ...makeComponent({ id: 'system.core', level: 0, kind: 'system' }), ports: [port('in', 'input'), port('out', 'output')] },
    {
      ...makeComponent({ id: 'ext.gcs', level: 0, kind: 'actor', scope: 'external' }),
      ports: [port('telemetry', 'output'), port('ack', 'input')],
    },
    {
      ...makeComponent({ id: 'domain.ctl', level: 1, kind: 'capability_domain' }),
      ports: [port('in', 'input'), port('out', 'output')],
    },
    {
      ...makeComponent({ id: 'l2.sink', level: 2, kind: 'controller', parent_id: 'domain.ctl' }),
      ports: [port('in.a', 'input'), port('in.b', 'input'), port('cmd.pitch', 'output')],
    },
    {
      ...makeComponent({ id: 'l2.other', level: 2, kind: 'estimator', parent_id: 'domain.ctl' }),
      ports: [port('in', 'input'), port('out', 'output')],
    },
  ]
}

/** `makeFlow` hard-codes the `in`/`out` endpoints; these flows name their ports. */
function flowThroughPort(
  id: string,
  from: string,
  fromPort: string,
  to: string,
  toPort: string,
  kind: FlowKind = 'command',
): Flow {
  const flow = makeFlow({ id, from, to, kind })
  return {
    ...flow,
    from: { component_id: from, port_id: fromPort },
    to: { component_id: to, port_id: toPort },
  }
}

function handleFlows(): Flow[] {
  return [
    // Both ports are declared by their components.
    flowThroughPort('flow.ports', 'ext.gcs', 'telemetry', 'l2.sink', 'in.a'),
    // `ghost` is declared by nobody: the adapter must fall back rather than
    // hand Vue Flow a handle that does not exist (the edge would vanish).
    flowThroughPort('flow.ghost', 'l2.sink', 'ghost', 'l2.other', 'in'),
    flowThroughPort('flow.cmd', 'l2.sink', 'cmd.pitch', 'l2.other', 'in', 'control'),
  ]
}

function handleBundle(): LoadedBundle {
  const components = handleComponents()
  const flows = handleFlows()
  const bundle = makeModel({
    components,
    flows,
    scenarios: [
      makeScenario({
        id: 'scenario.test',
        component_ids: components.map((component) => component.id),
        flow_ids: flows.map((flow) => flow.id),
      }),
    ],
  })
  return {
    id: bundle.model.id,
    relativePath: 'fixtures/handles.yaml',
    schemaVersion: bundle.schema_version,
    bundle,
    index: buildModelIndex(bundle),
    warnings: [],
  }
}

function projectBundle(bundle: LoadedBundle, level: GraphLevel): ProjectedGraph {
  const slice = selectScenario({ scenarioId: 'scenario.test', index: bundle.index })
  if (slice === null) throw new Error('fixture scenario missing')
  return projectScenario({
    slice,
    index: bundle.index,
    level,
    filters: {
      enabledFlowKinds: ALL_FLOW_KINDS,
      enabledVerificationStates: ALL_VERIFICATIONS,
    },
    order: buildOrderMaps(bundle.bundle),
  })
}

function edgeOfFlow(graph: ProjectedGraph, flowId: string) {
  const edge = graph.edges.find((entry) => entry.sourceFlowIds.includes(flowId))
  if (edge === undefined) throw new Error(`no projected edge for flow ${flowId}`)
  return edge
}

describe('toVueFlowElements — handle 选择', () => {
  const bundle = handleBundle()

  it('L2 的单条 flow 保留声明的端口作为 handle ID', () => {
    const graph = projectBundle(bundle, 2)
    const elements = build(graph, { componentsById: bundle.index.componentsById })

    const projected = edgeOfFlow(graph, 'flow.ports')
    // Guard: the edge must stand for exactly one flow, or aggregation would
    // have dropped the handles and the assertion below would prove nothing.
    expect(projected.sourceFlowIds).toEqual(['flow.ports'])

    const edge = edgeOf(elements, projected.id)
    expect(edge.sourceHandle).toBe('telemetry')
    expect(edge.targetHandle).toBe('in.a')
  })

  it('端口未被组件声明时退回通用 out/in，不让边静默消失', () => {
    const graph = projectBundle(bundle, 2)
    const elements = build(graph, { componentsById: bundle.index.componentsById })

    const projected = edgeOfFlow(graph, 'flow.ghost')
    // The projection kept the undeclared port; the adapter is what must reject
    // it, so the two halves of the rule are asserted separately.
    expect(projected.sourceFlowIds).toEqual(['flow.ghost'])
    expect(projected.sourceHandle).toBe('ghost')

    const edge = edgeOf(elements, projected.id)
    expect(edge.sourceHandle).toBe('out')
    // The target port *is* declared, so it must survive next to the fallback.
    expect(edge.targetHandle).toBe('in')
  })

  it('L0/L1 的聚合边一律使用通用 out/in，无论投影是否保留了端口', () => {
    const graph = projectBundle(bundle, 1)
    const projected = edgeOfFlow(graph, 'flow.ports')

    // The projection kept the source port because `ext.gcs` survives L1, but no
    // single port speaks for an edge that stands for several flows.
    expect(projected.sourceHandle).toBe('telemetry')
    expect(projected.targetHandle).toBeUndefined()

    const edge = edgeOf(build(graph, { componentsById: bundle.index.componentsById }), projected.id)
    expect(edge.sourceHandle).toBe('out')
    expect(edge.targetHandle).toBe('in')
  })

  it('同一侧多个端口按均分百分比错开，不会叠在中心', () => {
    const graph = projectBundle(bundle, 2)
    const elements = build(graph, { componentsById: bundle.index.componentsById })
    const data = dataOf<BusinessNodeData>(nodeOf(elements, 'l2.sink'))

    expect(data.portCounts).toEqual({ inputs: 2, outputs: 1 })

    const handleOf = (id: string): NodePortHandle => {
      const handle = data.ports.find((entry) => entry.id === id)
      if (handle === undefined) throw new Error(`no handle for port ${id}`)
      return handle
    }

    // Two inputs sit at 1/3 and 2/3 of the side; a lone output sits centred.
    expect(handleOf('in.a').offset).toBeCloseTo(100 / 3)
    expect(handleOf('in.b').offset).toBeCloseTo(200 / 3)
    expect(handleOf('cmd.pitch').offset).toBeCloseTo(50)
    expect(handleOf('in.a').direction).toBe('input')
    expect(handleOf('cmd.pitch').direction).toBe('output')
  })

  it('端口渲染数据只保留位置信息，不复制 Schema 端口对象', () => {
    const graph = projectBundle(bundle, 2)
    const elements = build(graph, { componentsById: bundle.index.componentsById })
    const data = dataOf<BusinessNodeData>(nodeOf(elements, 'l2.sink'))

    for (const handle of data.ports) {
      expect(Object.keys(handle).sort()).toEqual(['direction', 'id', 'name', 'offset'])
    }
  })
})

describe('toVueFlowElements — route points', () => {
  it('bend points 从布局复制，端点透传，且改动元素不会污染布局结果', () => {
    const graph = graphAt(2)
    const full = computeFallbackLayout(graph)
    const target = edgeOfFlow(graph, 'flow.attitude_rate')
    const bendPoints = [{ x: 410, y: 220 }, { x: 480, y: 220 }]
    const layout: LayoutResult = {
      ...full,
      edges: full.edges.map((edge) =>
        edge.id === target.id
          ? { ...edge, bendPoints, startPoint: { x: 300, y: 200 }, endPoint: { x: 600, y: 260 } }
          : edge,
      ),
    }

    const elements = build(graph, { layout })
    const data = dataOf<{ bendPoints: { x: number; y: number }[]; startPoint: unknown; endPoint: unknown }>(
      edgeOf(elements, target.id),
    )

    expect(data.bendPoints).toEqual(bendPoints)
    expect(data.startPoint).toEqual({ x: 300, y: 200 })
    expect(data.endPoint).toEqual({ x: 600, y: 260 })

    // A copy, not the layout's own array: mutating what a renderer holds must
    // not be able to move the next route.
    const placed = layout.edges.find((edge) => edge.id === target.id)
    expect(data.bendPoints).not.toBe(placed?.bendPoints)
    data.bendPoints.push({ x: 0, y: 0 })
    expect(placed?.bendPoints).toHaveLength(2)
  })

  it('布局没有折点时 bendPoints 为空，端点回退为 null', () => {
    const graph = graphAt(2)
    const full = computeFallbackLayout(graph)
    const target = edgeOfFlow(graph, 'flow.rc_attitude')
    // The fallback layout routes nothing: `SemanticFlowEdge` then falls back to
    // Vue Flow's own smooth-step path (DESIGN.md 10.5).
    const layout: LayoutResult = { ...full, edges: full.edges.filter((edge) => edge.id !== target.id) }

    const elements = build(graph, { layout })
    const data = dataOf<{ bendPoints: unknown[]; startPoint: unknown; endPoint: unknown; flowCount: number }>(
      edgeOf(elements, target.id),
    )

    expect(data.bendPoints).toEqual([])
    expect(data.startPoint).toBeNull()
    expect(data.endPoint).toBeNull()
    // Route points are the only thing missing; the business payload stays whole.
    expect(data.flowCount).toBe(1)
  })
})

describe('toVueFlowElements — 嵌套坐标与尺寸', () => {
  it('子节点位置是相对父容器的：绝对坐标减去父容器坐标', () => {
    silenceLayoutWarning()
    const graph = graphAt(2)
    const layout: LayoutResult = {
      nodes: [
        { id: CONTROLLER_GROUP, x: 100, y: 50, width: 400, height: 300 },
        { id: 'l2.attitude', x: 140, y: 98, width: 240, height: 124 },
      ],
      edges: [],
      labels: [],
      bounds: { x: 0, y: 0, width: 600, height: 400 },
      width: 600,
      height: 400,
    }

    const child = nodeOf(build(graph, { layout }), 'l2.attitude')

    expect(child.parentNode).toBe(CONTROLLER_GROUP)
    expect(child.position).toEqual({ x: 40, y: 48 })
  })

  it('相对坐标与 nodeMetrics 的容器内边距一致', () => {
    const graph = graphAt(2)
    const elements = build(graph)
    const group = nodeOf(elements, CONTROLLER_GROUP)

    const children = elements.nodes.filter((node) => node.parentNode === CONTROLLER_GROUP)
    expect(children.map((node) => node.id).sort()).toEqual(['l2.attitude', 'l2.rate'])

    for (const child of children) {
      expect(child.position.x).toBe(GROUP_PADDING.left)
      expect(child.position.y).toBeGreaterThanOrEqual(GROUP_PADDING.top)
      // Children stay inside the container the layout sized for them.
      expect(child.position.x + Number(child.width)).toBeLessThanOrEqual(Number(group.width))
    }
  })

  it('容器尺寸取自布局，叶子尺寸取自 nodeMetrics 常量', () => {
    const graph = graphAt(2)
    const layout = computeFallbackLayout(graph)
    const elements = build(graph, { layout })

    const group = nodeOf(elements, CONTROLLER_GROUP)
    const placedGroup = layout.nodes.find((node) => node.id === CONTROLLER_GROUP)
    expect(group.width).toBe(placedGroup?.width)
    expect(group.height).toBe(placedGroup?.height)
    // The container grows with its children, so it is never the leaf footprint.
    expect(Number(group.width)).toBeGreaterThanOrEqual(GROUP_MIN_SIZE.width)

    const leaf = nodeOf(elements, 'l2.attitude')
    expect(leaf.width).toBe(sizeForNode(projectedNodeOf(graph, 'l2.attitude')).width)
    expect(leaf.height).toBe(sizeForNode(projectedNodeOf(graph, 'l2.attitude')).height)
  })

  it('布局只给出 0 尺寸时，叶子退回 nodeMetrics 常量尺寸，避免零面积节点', () => {
    silenceLayoutWarning()
    const graph = graphAt(2)
    const layout: LayoutResult = {
      nodes: [
        { id: 'l2.attitude', x: 0, y: 0, width: 0, height: 0 },
        { id: 'ext.rc', x: 0, y: 0, width: 0, height: 0 },
      ],
      edges: [],
      labels: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      width: 0,
      height: 0,
    }

    const elements = build(graph, { layout })
    const leaf = nodeOf(elements, 'l2.attitude')
    const external = nodeOf(elements, 'ext.rc')

    expect(leaf.width).toBe(sizeForNode(projectedNodeOf(graph, 'l2.attitude')).width)
    expect(external.width).toBe(sizeForNode(projectedNodeOf(graph, 'ext.rc')).width)
  })
})

describe('toVueFlowElements — 选中与关联高亮', () => {
  it('高亮写成 className，节点数据与坐标保持不变', () => {
    const graph = graphAt(2)
    const plain = build(graph)
    const highlighted = build(graph, {
      highlightedNodeIds: new Set(['l2.attitude']),
      highlightedEdgeIds: new Set<string>(),
      hasSelection: true,
    })

    const node = nodeOf(highlighted, 'l2.attitude')
    expect(classesOf(node)).toContain('is-highlighted')
    expect(node.class).toContain('fv-node--business')

    // Selecting is a view concern: it must not reach the node's data or
    // geometry, or the Inspector would describe a different graph.
    const plainNode = nodeOf(plain, 'l2.attitude')
    expect(dataOf<BusinessNodeData>(node)).toEqual(dataOf<BusinessNodeData>(plainNode))
    expect(node.position).toEqual(plainNode.position)
  })

  it('有选中时未关联的节点与边加 is-dimmed，未选中时没有元素变暗', () => {
    const graph = graphAt(2)
    // Element ids are the projected edge ids, not the raw flow ids.
    const related = edgeOfFlow(graph, 'flow.attitude_rate').id
    const selection = build(graph, {
      highlightedNodeIds: new Set(['l2.attitude', 'l2.rate']),
      highlightedEdgeIds: new Set([related]),
      hasSelection: true,
    })

    const relatedEdge = edgeOf(selection, related)
    expect(classesOf(relatedEdge)).toContain('is-highlighted')
    expect(dataOf<{ highlighted: boolean; dimmed: boolean }>(relatedEdge)).toMatchObject({
      highlighted: true,
      dimmed: false,
    })

    const unrelated = edgeOf(selection, edgeOfFlow(graph, 'flow.rc_attitude').id)
    expect(classesOf(unrelated)).toContain('is-dimmed')
    expect(dataOf<{ highlighted: boolean; dimmed: boolean }>(unrelated).dimmed).toBe(true)

    const noSelection = build(graph)
    for (const node of noSelection.nodes) expect(classesOf(node)).not.toContain('is-dimmed')
    for (const edge of noSelection.edges) {
      expect(classesOf(edge)).not.toContain('is-dimmed')
      expect(dataOf<{ dimmed: boolean }>(edge).dimmed).toBe(false)
    }
  })

  it('高亮不改变图的形状：端点、ID 与类型与未选中时一致', () => {
    const graph = graphAt(2)
    const plain = build(graph)
    const highlighted = build(graph, {
      highlightedNodeIds: new Set(['l2.attitude']),
      highlightedEdgeIds: new Set([edgeOfFlow(graph, 'flow.attitude_rate').id]),
      hasSelection: true,
    })

    const shape = (elements: VueFlowElements) =>
      elements.edges.map((edge) => [edge.id, edge.source, edge.target, edge.sourceHandle])

    expect(shape(highlighted)).toEqual(shape(plain))
    // Highlighting is never expressed by hiding unrelated elements.
    expect(highlighted.nodes).toHaveLength(plain.nodes.length)
    expect(highlighted.edges).toHaveLength(plain.edges.length)
  })

  it('适配器只绘制调用方给出的关联集合，高亮不会自己扩散', () => {
    const graph = graphAt(2)
    // The controller hands in the neighbourhood; the adapter only paints it.
    const elements = build(graph, {
      highlightedNodeIds: new Set([CONTROLLER_GROUP, 'l2.attitude', 'l2.rate']),
      highlightedEdgeIds: new Set<string>(),
      hasSelection: true,
    })

    for (const id of [CONTROLLER_GROUP, 'l2.attitude', 'l2.rate']) {
      expect(classesOf(nodeOf(elements, id))).toContain('is-highlighted')
    }
    expect(classesOf(nodeOf(elements, 'l2.ahrs'))).toContain('is-dimmed')
  })
})

describe('toVueFlowElements — 节点数据契约', () => {
  it('group 数据暴露真实组件 ID 与可见子节点数，前缀不外泄', () => {
    const elements = build(graphAt(2))
    const data = dataOf<GroupNodeData>(nodeOf(elements, CONTROLLER_GROUP))

    expect(data.childCount).toBe(2)
    expect(data.domainId).toBe('domain.control')
    expect(data.label).toBe('domain.control')
  })

  it('summary 只取描述的第一句，不把长文堆进节点', () => {
    const base = FIXTURE_COMPONENTS_BY_ID.get('l2.attitude')
    if (base === undefined) throw new Error('fixture component missing')
    const componentsById = new Map<string, Component>([
      ['l2.attitude', { ...base, description: '保持姿态。第二句不应出现。' }],
    ])

    const data = dataOf<BusinessNodeData>(
      nodeOf(build(graphAt(2), { componentsById }), 'l2.attitude'),
    )
    expect(data.summary).toBe('保持姿态')
  })

  it('ariaLabel 用中文 kind 标签，供屏幕阅读器与 E2E 选择器使用', () => {
    const elements = build(graphAt(2))
    const node = nodeOf(elements, 'l2.attitude')

    expect(node.ariaLabel).toBe(`l2.attitude（${COMPONENT_KIND_LABEL.controller}）`)
  })

  /*
   * `edge.kind` is a FlowKind, so it must be looked up in FLOW_KIND_LABEL; the
   * component table would miss and announce the raw Schema value to a screen
   * reader.
   *
   * GRAPH_READABILITY_DESIGN.md 5.1 puts the direction and the verification in
   * the same sentence, and that is what makes shortening the drawn label safe:
   * the canvas can show 控制量 alone only because the accessible name still
   * says which flow it is, which way it runs and how well it is evidenced.
   */
  it('边的 ariaLabel 使用 flow kind 的中文标签，并给出方向与证据', () => {
    const graph = graphAt(2)
    const elements = build(graph)
    const flow = edgeOfFlow(graph, 'flow.attitude_rate')
    const edge = edgeOf(elements, flow.id)

    expect(edge.ariaLabel).toBe(
      `控制量：${flow.label}，${flow.source} → ${flow.target}，证据：${VERIFICATION_LABEL[flow.verification]}`,
    )
  })
})

describe('levelLabel', () => {
  it('三个层级都有可读名称', () => {
    expect(levelLabel(0)).toBe('L0 系统')
    expect(levelLabel(1)).toBe('L1 能力域')
    expect(levelLabel(2)).toBe('L2 业务组件')
  })
})
