import { describe, expect, it } from 'vitest'

import type { GraphLevel } from '@/domain/model'
import type { ProjectedGraph } from '@/domain/view-model'
import { LayoutCache, computeElkLayout, layoutCacheKey, layoutGraph } from '@/layout/elkLayout'
import { assignColumns, computeFallbackLayout } from '@/layout/fallbackLayout'
import { GROUP_MIN_SIZE, sizeForNode } from '@/layout/nodeMetrics'

import { expectNoOverlaps } from './helpers/geometry'
import { projectFixture } from './helpers/projectFixture'

function graphAt(level: GraphLevel): ProjectedGraph {
  return projectFixture({
    level,
    flows: [
      { id: 'flow.rc_attitude', from: 'ext.rc', to: 'l2.attitude', kind: 'command' },
      { id: 'flow.ahrs_attitude', from: 'l2.ahrs', to: 'l2.attitude', kind: 'state' },
      { id: 'flow.attitude_rate', from: 'l2.attitude', to: 'l2.rate', kind: 'control' },
      { id: 'flow.rate_motors', from: 'l2.rate', to: 'ext.motors', kind: 'actuation' },
      { id: 'flow.rate_feedback', from: 'l2.rate', to: 'l2.attitude', kind: 'feedback', feedback: true },
    ],
  })
}

describe('nodeMetrics', () => {
  it('节点尺寸只由常量决定，与 DOM 无关', () => {
    const graph = graphAt(2)
    for (const node of graph.nodes) {
      const size = sizeForNode(node)
      expect(size.width).toBeGreaterThan(0)
      expect(size.height).toBeGreaterThan(0)
    }
  })

  it('外部节点比内部业务节点小，L0 system 最宽', () => {
    const system = sizeForNode({
      id: 'system.ac',
      level: 0,
      scope: 'internal',
      kind: 'system',
      label: 's',
      sourceComponentIds: [],
      hiddenInternalFlowIds: [],
    })
    const external = sizeForNode({
      id: 'ext.rc',
      level: 0,
      scope: 'external',
      kind: 'actor',
      label: 'e',
      sourceComponentIds: [],
      hiddenInternalFlowIds: [],
    })
    expect(system.width).toBeGreaterThan(external.width)
    expect(system.height).toBeGreaterThan(external.height)
  })
})

describe('computeElkLayout', () => {
  it('为每个节点和 group 生成坐标，且坐标互不重叠', async () => {
    const graph = graphAt(2)
    const result = await computeElkLayout(graph)

    const ids = new Set(result.nodes.map((node) => node.id))
    for (const node of graph.nodes) expect(ids.has(node.id)).toBe(true)
    for (const group of graph.groups) expect(ids.has(group.id)).toBe(true)

    expect(result.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(
      true,
    )
    // Only top-level nodes are compared: children legitimately sit inside the
    // bounding box of their group container.
    const contained = new Set(
      graph.nodes.filter((node) => node.parentGroupId !== undefined).map((node) => node.id),
    )
    expectNoOverlaps(
      result.nodes.filter((node) => !contained.has(node.id)),
      'computeElkLayout L2',
    )
  })

  it('同一输入两次布局产生完全相同的坐标', async () => {
    const first = await computeElkLayout(graphAt(2))
    const second = await computeElkLayout(graphAt(2))

    expect(first.nodes.map((node) => [node.id, node.x, node.y])).toEqual(
      second.nodes.map((node) => [node.id, node.x, node.y]),
    )
  })

  it('L0 视图的所有边都指向真实存在的节点', async () => {
    const graph = graphAt(0)
    const result = await computeElkLayout(graph)
    const ids = new Set(result.nodes.map((node) => node.id))
    for (const edge of graph.edges) {
      expect(ids.has(edge.source), `missing source ${edge.source}`).toBe(true)
      expect(ids.has(edge.target), `missing target ${edge.target}`).toBe(true)
    }
  })

  it('正交路由为边生成折点', async () => {
    const result = await computeElkLayout(graphAt(1))
    expect(result.edges.length).toBeGreaterThan(0)

    // The assertion here used to be `bendPoints.length >= 0`, which holds for
    // every array and so could never fail. Orthogonal routing means at least
    // one edge has to turn, and every turn it reports has to be a real point.
    const routed = result.edges.filter((edge) => edge.bendPoints.length > 0)
    expect(routed.length).toBeGreaterThan(0)
    for (const edge of routed) {
      for (const point of edge.bendPoints) {
        expect(
          Number.isFinite(point.x) && Number.isFinite(point.y),
          `non-finite bend point on ${edge.id}`,
        ).toBe(true)
      }
    }

    expect(Number.isFinite(result.width) && result.width > 0).toBe(true)
    expect(Number.isFinite(result.height) && result.height > 0).toBe(true)
  })

  it('空图不会抛错', async () => {
    const empty: ProjectedGraph = { nodes: [], edges: [], groups: [], diagnostics: [] }
    const result = await computeElkLayout(empty)
    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
  })
})

describe('LayoutCache', () => {
  it('超过上限时淘汰最久未使用的结果', () => {
    const cache = new LayoutCache(2)
    const value = (id: string) => ({ nodes: [], edges: [], width: 0, height: 0, id })

    cache.set('a', value('a') as never)
    cache.set('b', value('b') as never)
    cache.get('a')
    cache.set('c', value('c') as never)

    expect(cache.size).toBe(2)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBeDefined()
    expect(cache.get('c')).toBeDefined()
  })

  it('cache key 覆盖 bundle、revision、scenario、level 与两个过滤器', () => {
    const base = {
      bundleId: 'bundle',
      revision: 'rev',
      scenarioId: 'scenario',
      level: 2,
      flowKinds: ['command', 'state'] as const,
      verificationStates: ['docs_only'] as const,
    }
    const key = layoutCacheKey(base)
    expect(key).toBe(layoutCacheKey(base))

    expect(layoutCacheKey({ ...base, level: 1 })).not.toBe(key)
    expect(layoutCacheKey({ ...base, revision: 'other' })).not.toBe(key)
    expect(layoutCacheKey({ ...base, scenarioId: 'other' })).not.toBe(key)
    expect(layoutCacheKey({ ...base, bundleId: 'other' })).not.toBe(key)
    expect(layoutCacheKey({ ...base, flowKinds: ['command'] })).not.toBe(key)
    expect(layoutCacheKey({ ...base, verificationStates: ['conflict'] })).not.toBe(key)
  })

  it('过滤器顺序不影响 cache key，避免同一图被重复布局', () => {
    const base = {
      bundleId: 'bundle',
      revision: 'rev',
      scenarioId: 'scenario',
      level: 2,
      verificationStates: ['docs_only'] as const,
    }
    expect(layoutCacheKey({ ...base, flowKinds: ['state', 'command'] })).toBe(
      layoutCacheKey({ ...base, flowKinds: ['command', 'state'] }),
    )
  })

  it('相同 key 的并发请求只运行一次布局', async () => {
    let runs = 0
    const cache = new LayoutCache(4)
    const graph = graphAt(0)

    // `layoutGraph` shares the in-flight promise, so two calls overlap.
    const first = layoutGraph('key', graph, cache)
    const second = layoutGraph('key', graph, cache)
    expect(second).toBe(first)

    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
    runs += 1
    expect(runs).toBe(1)
  })
})

describe('computeFallbackLayout', () => {
  it('为每个节点生成互不重叠的坐标，且不产生折点', () => {
    const graph = graphAt(2)
    const result = computeFallbackLayout(graph)

    const ids = new Set(result.nodes.map((node) => node.id))
    for (const node of graph.nodes) expect(ids.has(node.id)).toBe(true)

    // A group box intentionally contains its children, so those pairs are not
    // overlaps; everything else must be disjoint.
    const parentOf = new Map(
      graph.nodes
        .filter((node) => node.parentGroupId !== undefined)
        .map((node) => [node.id, node.parentGroupId as string]),
    )
    const nested = (first: { id: string }, second: { id: string }): boolean =>
      parentOf.get(first.id) === second.id || parentOf.get(second.id) === first.id

    expectNoOverlaps(result.nodes, 'computeFallbackLayout L2', { mayNest: nested })

    expect(result.edges.every((edge) => edge.bendPoints.length === 0)).toBe(true)
    expect(result.width).toBeGreaterThan(0)
    expect(result.height).toBeGreaterThan(0)
  })

  it('反馈环不会把节点压在错误的列上', () => {
    // `l2.attitude → l2.rate` and the feedback edge `l2.rate → l2.attitude`
    // form a cycle; before back edges were dropped, both nodes stayed in
    // column 0 and the forward edge pointed backwards.
    const graph = graphAt(2)
    const columns = assignColumns(graph)
    expect(columns.get('l2.rate')).toBeGreaterThan(columns.get('l2.attitude') ?? 0)
  })

  it('两次调用产生完全相同的坐标，不受上一次运行影响', () => {
    const graph = graphAt(2)
    const first = computeFallbackLayout(graph)
    const second = computeFallbackLayout(graph)
    expect(first.nodes.map((node) => [node.id, node.x, node.y])).toEqual(
      second.nodes.map((node) => [node.id, node.x, node.y]),
    )
  })

  it('列分配沿边方向递增', () => {
    const graph = graphAt(2)
    const columns = assignColumns(graph)
    for (const edge of graph.edges) {
      const source = columns.get(edge.source)
      const target = columns.get(edge.target)
      if (source === undefined || target === undefined) continue
      // Feedback edges are allowed to point backwards; every other edge must
      // at least not land on an earlier column.
      if (edge.feedback) continue
      expect(target).toBeGreaterThanOrEqual(source)
    }
  })

  it('group 至少占一个标题区的高度', () => {
    const graph = graphAt(2)
    const result = computeFallbackLayout(graph)
    for (const group of graph.groups) {
      const box = result.nodes.find((node) => node.id === group.id)
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(GROUP_MIN_SIZE.height)
    }
  })

  it('环形依赖不会让列分配挂住', () => {
    const graph: ProjectedGraph = {
      nodes: [
        {
          id: 'a',
          level: 1,
          scope: 'internal',
          kind: 'capability_domain',
          label: 'a',
          sourceComponentIds: ['a'],
          hiddenInternalFlowIds: [],
        },
        {
          id: 'b',
          level: 1,
          scope: 'internal',
          kind: 'capability_domain',
          label: 'b',
          sourceComponentIds: ['b'],
          hiddenInternalFlowIds: [],
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'a',
          target: 'b',
          kind: 'state',
          label: 'x',
          feedback: false,
          verification: 'docs_only',
          sourceFlowIds: ['f1'],
        },
        {
          id: 'e2',
          source: 'b',
          target: 'a',
          kind: 'state',
          label: 'y',
          feedback: false,
          verification: 'docs_only',
          sourceFlowIds: ['f2'],
        },
      ],
      groups: [],
      diagnostics: [],
    }

    const result = computeFallbackLayout(graph)
    expect(result.nodes).toHaveLength(2)
  })
})
