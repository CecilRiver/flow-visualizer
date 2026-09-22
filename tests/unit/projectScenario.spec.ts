import { describe, expect, it } from 'vitest'

import { buildModelIndex } from '@/domain/indexes'
import type { FlowKind, GraphLevel, Verification } from '@/domain/model'
import { ISSUE_CODES } from '@/domain/validation'
import type { FlowFilters } from '@/domain/view-model'
import { aggregateVerification, moreConservative } from '@/projection/verificationRank'
import { selectScenario } from '@/projection/selectScenario'
import { GROUP_ID_PREFIX, buildOrderMaps, projectScenario } from '@/projection/projectScenario'

import {
  makeComponent,
  makeFlow,
  makeModel,
  makeScenario,
  makeSource,
  withPorts,
} from '../fixtures/buildModel'

const ALL_KINDS: FlowKind[] = [
  'command',
  'measurement',
  'state',
  'event',
  'control',
  'actuation',
  'feedback',
]

const ALL_VERIFICATIONS: Verification[] = [
  'conflict',
  'inferred',
  'docs_only',
  'code_confirmed',
  'docs_and_code_confirmed',
  'human_verified',
]

const NO_FILTER: FlowFilters = {
  enabledFlowKinds: ALL_KINDS,
  enabledVerificationStates: ALL_VERIFICATIONS,
}

/**
 * Fixture shaped after the real model: an L0 system, two external boundaries,
 * two capability domains each owning two L2 components.
 *
 * `system` has no flows of its own in most cases, which is what makes the
 * L0 view interesting: every internal flow folds onto it.
 */
function buildFixture() {
  const components = [
    makeComponent({ id: 'system.ac', level: 0, kind: 'system', scope: 'internal' }),
    makeComponent({ id: 'ext.rc', level: 0, kind: 'actor', scope: 'external' }),
    makeComponent({ id: 'ext.motors', level: 0, kind: 'physical_device', scope: 'external' }),
    makeComponent({ id: 'domain.control', level: 1, kind: 'capability_domain', parent_id: 'system.ac' }),
    makeComponent({ id: 'domain.estimate', level: 1, kind: 'capability_domain', parent_id: 'system.ac' }),
    makeComponent({ id: 'l2.attitude', level: 2, kind: 'controller', parent_id: 'domain.control' }),
    makeComponent({ id: 'l2.rate', level: 2, kind: 'controller', parent_id: 'domain.control' }),
    makeComponent({ id: 'l2.ahrs', level: 2, kind: 'estimator', parent_id: 'domain.estimate' }),
    makeComponent({ id: 'l2.imu', level: 2, kind: 'estimator', parent_id: 'domain.estimate' }),
  ].map((component) => withPorts(component, ['data.test']))

  return components
}

interface BuildOptions {
  flows: ReturnType<typeof makeFlow>[]
  level: GraphLevel
  filters?: FlowFilters
  components?: ReturnType<typeof makeComponent>[]
}

function project(options: BuildOptions) {
  const components = options.components ?? buildFixture()
  const scenario = makeScenario({
    id: 'scenario.test',
    component_ids: components.map((component) => component.id),
    flow_ids: options.flows.map((flow) => flow.id),
  })
  const model = makeModel({ components, flows: options.flows, scenarios: [scenario] })
  const index = buildModelIndex(model)
  const slice = selectScenario({ scenarioId: 'scenario.test', index })
  if (slice === null) throw new Error('fixture scenario missing')
  const graph = projectScenario({
    slice,
    index,
    level: options.level,
    filters: options.filters ?? NO_FILTER,
    order: buildOrderMaps(model),
  })
  return { graph, index, slice }
}

describe('projectScenario / DESIGN 9.7 matrix', () => {
  it('外部 → L2，切 L0：外部 → system', () => {
    const { graph } = project({
      level: 0,
      flows: [makeFlow({ id: 'flow.rc_attitude', from: 'ext.rc', to: 'l2.attitude' })],
    })

    expect(graph.nodes.map((node) => node.id).sort()).toEqual(['ext.motors', 'ext.rc', 'system.ac'])
    expect(graph.edges).toHaveLength(1)
    const edge = graph.edges[0]
    expect(edge?.source).toBe('ext.rc')
    expect(edge?.target).toBe('system.ac')
    // The external boundary keeps its own identity at every level, so its port
    // is still a real anchor; the endpoint folded onto `system.ac` is not.
    expect(edge?.sourceHandle).toBe('out')
    expect(edge?.targetHandle).toBeUndefined()
  })

  it('L2 → L2，父域不同，切 L1：domain A → domain B', () => {
    const { graph } = project({
      level: 1,
      flows: [makeFlow({ id: 'flow.ahrs_attitude', from: 'l2.ahrs', to: 'l2.attitude' })],
    })

    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]?.source).toBe('domain.estimate')
    expect(graph.edges[0]?.target).toBe('domain.control')
  })

  it('L2 → L2，父域相同，切 L1：不画边，记录 hidden internal flow', () => {
    const { graph } = project({
      level: 1,
      flows: [makeFlow({ id: 'flow.attitude_rate', from: 'l2.attitude', to: 'l2.rate' })],
    })

    expect(graph.edges).toHaveLength(0)
    const domain = graph.nodes.find((node) => node.id === 'domain.control')
    expect(domain?.hiddenInternalFlowIds).toEqual(['flow.attitude_rate'])
  })

  it('多条同 kind 同端点：聚合为一条且保留所有 source flow', () => {
    const { graph } = project({
      level: 2,
      flows: [
        makeFlow({ id: 'flow.a', from: 'l2.ahrs', to: 'l2.attitude', kind: 'state' }),
        makeFlow({ id: 'flow.b', from: 'l2.ahrs', to: 'l2.attitude', kind: 'state' }),
        makeFlow({ id: 'flow.c', from: 'l2.ahrs', to: 'l2.attitude', kind: 'state' }),
      ],
    })

    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]?.sourceFlowIds).toEqual(['flow.a', 'flow.b', 'flow.c'])
    // Configuration order is preserved, so the id is derived, not positional.
    expect(graph.edges[0]?.id).toBe('edge:L2:l2.ahrs:l2.attitude:state:fw')
  })

  it('同端点不同 kind：保持多条边', () => {
    const { graph } = project({
      level: 2,
      flows: [
        makeFlow({ id: 'flow.cmd', from: 'l2.ahrs', to: 'l2.attitude', kind: 'command' }),
        makeFlow({ id: 'flow.state', from: 'l2.ahrs', to: 'l2.attitude', kind: 'state' }),
      ],
    })

    expect(graph.edges.map((edge) => edge.kind).sort()).toEqual(['command', 'state'])
  })

  it('同端点 command 与 feedback：保持多条边', () => {
    const { graph } = project({
      level: 2,
      flows: [
        makeFlow({ id: 'flow.out', from: 'l2.attitude', to: 'l2.rate', kind: 'control' }),
        makeFlow({
          id: 'flow.back',
          from: 'l2.rate',
          to: 'l2.attitude',
          kind: 'feedback',
          feedback: true,
        }),
      ],
    })

    expect(graph.edges).toHaveLength(2)
    expect(graph.edges.map((edge) => edge.id)).toEqual([
      'edge:L2:l2.attitude:l2.rate:control:fw',
      'edge:L2:l2.rate:l2.attitude:feedback:fb',
    ])
  })

  it('feedback 标记不同的同向同 kind 边不会被合并', () => {
    const { graph } = project({
      level: 2,
      flows: [
        makeFlow({ id: 'flow.plain', from: 'l2.attitude', to: 'l2.rate', kind: 'state' }),
        makeFlow({
          id: 'flow.marked',
          from: 'l2.attitude',
          to: 'l2.rate',
          kind: 'state',
          feedback: true,
        }),
      ],
    })

    expect(graph.edges).toHaveLength(2)
  })

  it('任一底层状态 conflict：聚合状态 conflict', () => {
    const { graph } = project({
      level: 2,
      flows: [
        makeFlow({ id: 'flow.a', from: 'l2.ahrs', to: 'l2.attitude', verification: 'human_verified' }),
        makeFlow({
          id: 'flow.b',
          from: 'l2.ahrs',
          to: 'l2.attitude',
          verification: 'docs_and_code_confirmed',
        }),
        makeFlow({ id: 'flow.c', from: 'l2.ahrs', to: 'l2.attitude', verification: 'conflict' }),
      ],
    })

    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]?.verification).toBe('conflict')
  })

  it('先过滤再聚合：数量和状态只来自可见 flow', () => {
    const flowA = makeFlow({
      id: 'flow.a',
      from: 'l2.ahrs',
      to: 'l2.attitude',
      kind: 'state',
      verification: 'docs_and_code_confirmed',
    })
    const flowB = makeFlow({
      id: 'flow.b',
      from: 'l2.ahrs',
      to: 'l2.attitude',
      kind: 'state',
      verification: 'human_verified',
    })
    const hidden = makeFlow({ id: 'flow.hidden', from: 'l2.ahrs', to: 'l2.attitude', kind: 'event' })

    const { graph } = project({
      level: 2,
      flows: [flowA, flowB, hidden],
      filters: { enabledFlowKinds: ALL_KINDS, enabledVerificationStates: ['human_verified'] },
    })

    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]?.sourceFlowIds).toEqual(['flow.b'])
    // The filtered-out conflict/human mix must not bleed into the aggregate.
    expect(graph.edges[0]?.verification).toBe('human_verified')
  })

  it('过滤掉全部 flow 后不产生边，但节点仍然保留', () => {
    const { graph } = project({
      level: 2,
      flows: [makeFlow({ id: 'flow.a', from: 'l2.ahrs', to: 'l2.attitude', kind: 'state' })],
      filters: { enabledFlowKinds: ['command'], enabledVerificationStates: ALL_VERIFICATIONS },
    })

    expect(graph.edges).toHaveLength(0)
    expect(graph.nodes.map((node) => node.id)).toContain('l2.ahrs')
  })

  it('L2 视图遇到 L1 原始端点：保留粗节点并产生 diagnostic', () => {
    const components = buildFixture()
    const flow = makeFlow({ id: 'flow.coarse', from: 'ext.rc', to: 'domain.control' })
    const { graph } = project({ level: 2, flows: [flow], components })

    // The L1 domain has visible L2 children, so it renders as a group node.
    expect(graph.groups.map((group) => group.id)).toContain(`${GROUP_ID_PREFIX}domain.control`)
    expect(graph.nodes.map((node) => node.id)).not.toContain('domain.control')

    // The external boundary that pointed at the domain is retargeted onto the
    // group, so the edge never dangles.
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]?.target).toBe(`${GROUP_ID_PREFIX}domain.control`)

    expect(graph.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      ISSUE_CODES.coarserThanView,
    )
  })

  it('L2 视图遇到没有 L2 子节点的 L1 端点：保留为普通粗节点', () => {
    const components = buildFixture().map((component) =>
      component.id === 'l2.attitude' || component.id === 'l2.rate'
        ? { ...component, parent_id: 'system.ac', level: 1 }
        : component,
    )
    const flow = makeFlow({ id: 'flow.coarse', from: 'ext.rc', to: 'l2.attitude' })
    const { graph } = project({ level: 2, flows: [flow], components })

    expect(graph.nodes.map((node) => node.id)).toContain('l2.attitude')
    expect(graph.edges[0]?.target).toBe('l2.attitude')
    expect(graph.diagnostics.length).toBeGreaterThan(0)
  })
})

describe('projectScenario / grouping and order', () => {
  it('L2 视图把有可见子节点的能力域渲染为 group，并把子节点挂进去', () => {
    const { graph } = project({
      level: 2,
      flows: [makeFlow({ id: 'flow.a', from: 'l2.ahrs', to: 'l2.attitude' })],
    })

    expect(graph.groups.map((group) => group.id).sort()).toEqual([
      `${GROUP_ID_PREFIX}domain.control`,
      `${GROUP_ID_PREFIX}domain.estimate`,
    ])
    expect(graph.nodes.find((node) => node.id === 'l2.ahrs')?.parentGroupId).toBe(
      `${GROUP_ID_PREFIX}domain.estimate`,
    )
  })

  it('L0/L1 视图不产生 group', () => {
    for (const level of [0, 1] as const) {
      const { graph } = project({
        level,
        flows: [makeFlow({ id: 'flow.a', from: 'ext.rc', to: 'l2.attitude' })],
      })
      expect(graph.groups).toHaveLength(0)
    }
  })

  it('同一输入产生完全相同的 id 与顺序', () => {
    const flows = [
      makeFlow({ id: 'flow.a', from: 'ext.rc', to: 'l2.attitude' }),
      makeFlow({ id: 'flow.b', from: 'l2.ahrs', to: 'l2.rate' }),
      makeFlow({ id: 'flow.c', from: 'l2.rate', to: 'ext.motors', kind: 'actuation' }),
    ]
    const first = project({ level: 2, flows }).graph
    const second = project({ level: 2, flows }).graph

    expect(first.nodes.map((node) => node.id)).toEqual(second.nodes.map((node) => node.id))
    expect(first.edges.map((edge) => edge.id)).toEqual(second.edges.map((edge) => edge.id))
  })

  it('节点顺序跟随配置顺序，而不是字母顺序', () => {
    const components = [
      makeComponent({ id: 'system.ac', level: 0, kind: 'system' }),
      makeComponent({ id: 'ext.zulu', level: 0, kind: 'actor', scope: 'external' }),
      makeComponent({ id: 'ext.alpha', level: 0, kind: 'actor', scope: 'external' }),
    ].map((component) => withPorts(component, ['data.test']))

    const { graph } = project({
      level: 1,
      components,
      flows: [makeFlow({ id: 'flow.a', from: 'ext.zulu', to: 'ext.alpha' })],
    })
    expect(graph.nodes.map((node) => node.id)).toEqual(['system.ac', 'ext.zulu', 'ext.alpha'])
  })

  it('只剩内部自环的节点仍然出现在图中', () => {
    // L1 folds the four L2 components onto their two domains: 1 system +
    // 2 externals + 2 domains. The single flow is internal to one domain, so it
    // is hidden and no edge is drawn — the nodes must survive that.
    const { graph } = project({
      level: 1,
      flows: [makeFlow({ id: 'flow.inner', from: 'l2.attitude', to: 'l2.rate' })],
    })
    expect(graph.nodes.map((node) => node.id)).toEqual([
      'system.ac',
      'ext.rc',
      'ext.motors',
      'domain.control',
      'domain.estimate',
    ])
    expect(graph.edges).toHaveLength(0)
  })
})

describe('projectComponentId roll-up rules', () => {
  it('外部节点在每一层都保留自身身份', () => {
    const { graph } = project({
      level: 0,
      flows: [makeFlow({ id: 'flow.a', from: 'ext.rc', to: 'ext.motors' })],
    })
    expect(graph.edges[0]?.source).toBe('ext.rc')
    expect(graph.edges[0]?.target).toBe('ext.motors')
  })

  it('L1 视图保留 L0 system 与 L1 domain，不上升到 system', () => {
    const { graph } = project({
      level: 1,
      flows: [makeFlow({ id: 'flow.rc', from: 'ext.rc', to: 'l2.attitude' })],
    })
    const ids = graph.nodes.map((node) => node.id)
    expect(ids).toContain('system.ac')
    expect(ids).toContain('domain.control')
    expect(ids).not.toContain('l2.attitude')
  })
})

describe('verification aggregation order', () => {
  it('按固定保守顺序取最严重者，不做多数投票', () => {
    expect(aggregateVerification(['human_verified', 'docs_only', 'code_confirmed'])).toBe('docs_only')
    expect(aggregateVerification(['code_confirmed', 'inferred'])).toBe('inferred')
    expect(aggregateVerification(['docs_and_code_confirmed', 'code_confirmed'])).toBe(
      'code_confirmed',
    )
  })

  it('moreConservative 使用固定 rank 而不是任意值', () => {
    expect(moreConservative('conflict', 'human_verified')).toBe('conflict')
    expect(moreConservative('inferred', 'docs_only')).toBe('inferred')
  })

  it('空集合返回最保守的 human_verified，而不是空字符串', () => {
    expect(aggregateVerification([])).toBe('human_verified')
  })
})

describe('aggregate edge labels', () => {
  it('单条 flow 的边沿用 flow 名称，聚合边显示 kind 与计数', () => {
    const { graph } = project({
      level: 2,
      flows: [
        makeFlow({ id: 'flow.a', name: '姿态目标', from: 'l2.ahrs', to: 'l2.attitude', kind: 'state' }),
        makeFlow({ id: 'flow.b', name: '第二路', from: 'l2.ahrs', to: 'l2.attitude', kind: 'state' }),
      ],
    })

    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]?.label).toBe('状态 × 2')
  })

  it('单条 flow 保留原始端口作为 handle', () => {
    const { graph } = project({
      level: 2,
      flows: [makeFlow({ id: 'flow.a', from: 'l2.ahrs', to: 'l2.attitude' })],
    })
    expect(graph.edges[0]?.sourceHandle).toBe('out')
    expect(graph.edges[0]?.targetHandle).toBe('in')
  })

  it('两条 flow 聚合后放弃端口 handle，退回通用 handle', () => {
    const { graph } = project({
      level: 2,
      flows: [
        makeFlow({ id: 'flow.a', from: 'l2.ahrs', to: 'l2.attitude' }),
        makeFlow({ id: 'flow.b', from: 'l2.ahrs', to: 'l2.attitude' }),
      ],
    })
    expect(graph.edges[0]?.sourceHandle).toBeUndefined()
    expect(graph.edges[0]?.targetHandle).toBeUndefined()
  })
})

describe('bundle identity is not rewritten', () => {
  it('缺失的端点组件不会让投影抛错，也不会伪造节点', () => {
    const components = [
      makeComponent({ id: 'system.ac', level: 0, kind: 'system' }),
      withPorts(makeComponent({ id: 'l2.attitude', level: 2, parent_id: 'system.ac' }), ['data.test']),
    ]
    const flow = makeFlow({ id: 'flow.dangling', from: 'l2.attitude', to: 'missing.component' })
    const { graph } = project({ level: 2, flows: [flow], components })

    expect(() => graph).not.toThrow()
    // The unknown endpoint keeps its raw id rather than inventing a label.
    expect(graph.edges.map((edge) => edge.target)).toContain('missing.component')
  })

  it('场景未声明的组件不会因为出现在 flow 端点而悄悄变成节点', () => {
    const components = buildFixture()
    const flow = makeFlow({ id: 'flow.a', from: 'l2.ahrs', to: 'l2.attitude' })

    const scenario = makeScenario({
      id: 'scenario.test',
      // Deliberately omits `l2.rate` and `l2.imu`.
      component_ids: components
        .filter((component) => component.id !== 'l2.rate' && component.id !== 'l2.imu')
        .map((component) => component.id),
      flow_ids: [flow.id],
    })
    const model = makeModel({
      components,
      flows: [flow],
      scenarios: [scenario],
      sources: [makeSource('source.test')],
    })
    const index = buildModelIndex(model)
    const slice = selectScenario({ scenarioId: 'scenario.test', index })
    if (slice === null) throw new Error('fixture scenario missing')

    const graph = projectScenario({
      slice,
      index,
      level: 2,
      filters: NO_FILTER,
      order: buildOrderMaps(model),
    })

    expect(graph.nodes.map((node) => node.id)).not.toContain('l2.rate')
  })
})
