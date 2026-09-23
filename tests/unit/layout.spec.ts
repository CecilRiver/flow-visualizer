import { describe, expect, it } from 'vitest'

import type { GraphLevel } from '@/domain/model'
import type { ProjectedGraph } from '@/domain/view-model'
import { edgeLayoutInputs } from '@/layout/edgePresentation'
import {
  LayoutCache,
  computeElkLayout,
  layoutCacheKey,
  layoutGraph,
  layoutInputSignature,
  toElkGraph,
} from '@/layout/elkLayout'
import { assignColumns, computeFallbackLayout } from '@/layout/fallbackLayout'
import { GROUP_MIN_SIZE, sizeForNode } from '@/layout/nodeMetrics'

import type { FlowInit } from '../fixtures/buildModel'

import { expectNoOverlaps, overlapArea } from './helpers/geometry'
import { projectFixture } from './helpers/projectFixture'

/** The canonical flow set, kept separate so a test can vary exactly one field. */
const BASE_FLOWS: readonly FlowInit[] = [
  { id: 'flow.rc_attitude', from: 'ext.rc', to: 'l2.attitude', kind: 'command' },
  { id: 'flow.ahrs_attitude', from: 'l2.ahrs', to: 'l2.attitude', kind: 'state' },
  { id: 'flow.attitude_rate', from: 'l2.attitude', to: 'l2.rate', kind: 'control' },
  { id: 'flow.rate_motors', from: 'l2.rate', to: 'ext.motors', kind: 'actuation' },
  { id: 'flow.rate_feedback', from: 'l2.rate', to: 'l2.attitude', kind: 'feedback', feedback: true },
]

function graphAt(level: GraphLevel, flows: readonly FlowInit[] = BASE_FLOWS): ProjectedGraph {
  return projectFixture({ level, flows })
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

describe('toElkGraph 交给 ELK 的输入', () => {
  function inputsFor(graph: ProjectedGraph, level: GraphLevel) {
    return edgeLayoutInputs(graph, { level, nodeLabel: (id) => id })
  }

  it('带上标签尺寸的边，ELK 才会为标签留出空间', async () => {
    const graph = graphAt(2)
    const inputs = inputsFor(graph, 2)
    expect(inputs.size).toBe(graph.edges.length)

    const elkGraph = toElkGraph(graph, inputs)
    for (const edge of elkGraph.edges ?? []) {
      const label = edge.labels?.[0]
      expect(label, `${edge.id} 没有带标签`).toBeDefined()
      // ELK drops a label with a zero width or height without saying so, and the
      // whole point of declaring it is to make ELK reserve room — so a zero here
      // is a silent return to the old behaviour rather than a cosmetic problem.
      expect(label?.width ?? 0).toBeGreaterThan(0)
      expect(label?.height ?? 0).toBeGreaterThan(0)
    }
  })

  it('不给输入时边不带标签，而不是带一个空标签', async () => {
    const elkGraph = toElkGraph(graphAt(2))
    for (const edge of elkGraph.edges ?? []) expect(edge.labels).toBeUndefined()
  })

  it('层间距随最宽标签变化：宽标签把层推得更开', async () => {
    const narrow = toElkGraph(graphAt(2), new Map())
    const wide = toElkGraph(
      graphAt(2),
      new Map([
        [
          'edge.wide',
          { metrics: { width: 400, height: 30, lines: ['x'], truncated: false }, placementRank: 0 },
        ],
      ]),
    )

    const gapOf = (node: { layoutOptions?: Record<string, string> }): number =>
      Number(node.layoutOptions?.['elk.layered.spacing.nodeNodeBetweenLayers'] ?? 0)

    expect(gapOf(wide)).toBeGreaterThan(gapOf(narrow))
  })

  it('读全部 sections，不是只读第一段', async () => {
    // A route that crosses a container boundary comes back in pieces. Reading
    // only `sections[0]` drew a line that stopped mid-graph, so the whole route
    // has to survive into `points`.
    const result = await computeElkLayout(graphAt(2), inputsFor(graphAt(2), 2))
    for (const edge of result.edges) {
      expect(edge.points.length, `${edge.id} 没有路径点`).toBeGreaterThanOrEqual(2)
      expect(edge.startPoint).toEqual(edge.points[0])
      expect(edge.endPoint).toEqual(edge.points[edge.points.length - 1])
      // The bend points are the interior of the route and nothing else.
      expect(edge.bendPoints).toEqual(edge.points.slice(1, -1))
    }
  })

  it('跨容器的边也有路径，而不是退化成一条直线', async () => {
    // The regression this pins is silent. ELK's default `SEPARATE_CHILDREN`
    // does not route an edge whose endpoints sit in different containers — the
    // edge comes back with no sections, the renderer draws a straight line
    // between the two node centres, and `placeEdgeLabels` finds no route to
    // anchor a label to. Nothing errors; the graph just looks wrong.
    //
    // Measured before the fix on the L2 fixture: 3 of 5 edges unrouted, and all
    // 3 of them the ones crossing a domain boundary.
    const graph = graphAt(2)
    const result = await computeElkLayout(graph, inputsFor(graph, 2))

    const routed = new Set(result.edges.map((edge) => edge.id))
    const groupIds = new Set(graph.groups.map((group) => group.id))
    const groupOf = new Map(
      graph.nodes
        .filter((node) => node.parentGroupId !== undefined)
        .map((node) => [node.id, node.parentGroupId as string]),
    )
    const crosses = (edge: { source: string; target: string }): boolean => {
      const from = groupOf.get(edge.source)
      const to = groupOf.get(edge.target)
      // An edge with a container on one side and a loose node on the other
      // crosses just as much as one between two containers.
      return from !== to
    }

    const crossingEdges = graph.edges.filter(
      (edge) => crosses(edge) && !groupIds.has(edge.source) && !groupIds.has(edge.target),
    )
    expect(crossingEdges.length, '夹具里没有跨容器的边，这条断言就失去意义').toBeGreaterThan(0)

    const missing = crossingEdges.filter((edge) => !routed.has(edge.id)).map((edge) => edge.id)
    expect(missing, '跨容器边没有路径').toEqual([])
  })

  it('每条边都带上了自己的 source/target，供碰撞检查排除端点', async () => {
    const graph = graphAt(2)
    const result = await computeElkLayout(graph, inputsFor(graph, 2))
    const byId = new Map(graph.edges.map((edge) => [edge.id, edge]))

    for (const edge of result.edges) {
      const projected = byId.get(edge.id)
      if (projected === undefined) continue
      expect(edge.source).toBe(projected.source)
      expect(edge.target).toBe(projected.target)
    }
  })
})

describe('computeElkLayout 的标签放置', () => {
  it('给了度量就产出对应的标签盒，且盒的左上角是坐标原点之外的位置', async () => {
    const graph = graphAt(2)
    const inputs = edgeLayoutInputs(graph, { level: 2, nodeLabel: (id) => id })
    const result = await computeElkLayout(graph, inputs)

    expect(result.labels.length).toBe(graph.edges.length)
    for (const label of result.labels) {
      expect(label.width).toBeGreaterThan(0)
      expect(label.height).toBeGreaterThan(0)
      expect(label.lines.length).toBeGreaterThan(0)
    }
  })

  it('bounds 覆盖所有节点与标签，而不只是 ELK 报告的形状范围', async () => {
    const graph = graphAt(2)
    const inputs = edgeLayoutInputs(graph, { level: 2, nodeLabel: (id) => id })
    const result = await computeElkLayout(graph, inputs)

    const inside = (box: { x: number; y: number; width: number; height: number }): boolean =>
      box.x >= result.bounds.x &&
      box.y >= result.bounds.y &&
      box.x + box.width <= result.bounds.x + result.bounds.width &&
      box.y + box.height <= result.bounds.y + result.bounds.height

    for (const node of result.nodes) expect(inside(node), `节点 ${node.id} 在 bounds 之外`).toBe(true)
    for (const label of result.labels.filter((entry) => entry.visibleByDefault)) {
      expect(inside(label), `标签 ${label.edgeId} 在 bounds 之外`).toBe(true)
    }
    // The margin is what stops a label from being drawn flush against the edge
    // of the canvas after the first fit.
    expect(result.bounds.width).toBeGreaterThan(
      Math.max(...result.nodes.map((node) => node.x + node.width)),
    )
  })

  it('标签不与它不连接的节点相交', async () => {
    const graph = graphAt(2)
    const inputs = edgeLayoutInputs(graph, { level: 2, nodeLabel: (id) => id })
    const result = await computeElkLayout(graph, inputs)

    const groupIds = new Set(graph.groups.map((group) => group.id))
    // Groups are backgrounds, and a label is allowed to cover its own endpoints
    // (10) — the same two exemptions the e2e measurement applies.
    const obstacles = result.nodes.filter((node) => !groupIds.has(node.id))
    const byId = new Map(graph.edges.map((edge) => [edge.id, edge]))

    const defects: string[] = []
    for (const label of result.labels) {
      if (!label.visibleByDefault) continue
      const edge = byId.get(label.edgeId)
      for (const node of obstacles) {
        if (node.id === edge?.source || node.id === edge?.target) continue
        const area = overlapArea(label, node)
        if (area > 0) defects.push(`${label.edgeId} 压住 ${node.id}（${area.toFixed(0)}px²）`)
      }
    }

    expect(defects).toEqual([])
  })

  it('标签之间互不相交', async () => {
    const graph = graphAt(2)
    const inputs = edgeLayoutInputs(graph, { level: 2, nodeLabel: (id) => id })
    const result = await computeElkLayout(graph, inputs)
    const visible = result.labels.filter((label) => label.visibleByDefault)

    const defects: string[] = []
    for (let a = 0; a < visible.length; a += 1) {
      for (let b = a + 1; b < visible.length; b += 1) {
        const first = visible[a]
        const second = visible[b]
        if (first === undefined || second === undefined) continue
        const area = overlapArea(first, second)
        if (area > 0) defects.push(`${first.edgeId} × ${second.edgeId}（${area.toFixed(0)}px²）`)
      }
    }

    expect(defects).toEqual([])
  })

  it('没有任何标签被画在画布之外的左上角', async () => {
    // A hidden label must not be handed a box at the origin: `toVueFlowElements`
    // would render it as a real label in the corner of the drawing.
    const graph = graphAt(2)
    const inputs = edgeLayoutInputs(graph, { level: 2, nodeLabel: (id) => id })
    const result = await computeElkLayout(graph, inputs)

    for (const label of result.labels) {
      if (label.visibleByDefault) continue
      expect(label.issue).not.toBeNull()
    }
  })

  it('两次布局的标签位置完全相同', async () => {
    const graph = graphAt(2)
    const inputs = edgeLayoutInputs(graph, { level: 2, nodeLabel: (id) => id })

    const first = await computeElkLayout(graph, inputs)
    const second = await computeElkLayout(graph, inputs)

    expect(first.labels).toEqual(second.labels)
    expect(first.bounds).toEqual(second.bounds)
  })
})

describe('fallback 与 ELK 的结果形状一致', () => {
  it('fallback 产出同样的字段，且不放置任何标签', () => {
    const graph = graphAt(2)
    const result = computeFallbackLayout(graph)

    expect(result.labels).toEqual([])
    expect(result.bounds.width).toBeGreaterThan(0)
    expect(result.bounds.height).toBeGreaterThan(0)
    for (const edge of result.edges) {
      expect(edge.source).toBeTruthy()
      expect(edge.target).toBeTruthy()
      // No routing is attempted, so there is no path to anchor a label to (14).
      expect(edge.points).toEqual([])
    }
  })

  it('fallback 的 bounds 覆盖所有节点', () => {
    const graph = graphAt(2)
    const result = computeFallbackLayout(graph)

    for (const node of result.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(result.bounds.x)
      expect(node.y).toBeGreaterThanOrEqual(result.bounds.y)
      expect(node.x + node.width).toBeLessThanOrEqual(result.bounds.x + result.bounds.width)
      expect(node.y + node.height).toBeLessThanOrEqual(result.bounds.y + result.bounds.height)
    }
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

  it('cache key 覆盖 bundle、schemaVersion、scenario、level 与两个过滤器', () => {
    const base = {
      bundleId: 'bundle',
      schemaVersion: '0.1',
      scenarioId: 'scenario',
      level: 2,
      flowKinds: ['command', 'state'] as const,
      verificationStates: ['docs_only'] as const,
      inputs: 'sig',
    }
    const key = layoutCacheKey(base)
    expect(key).toBe(layoutCacheKey(base))

    expect(layoutCacheKey({ ...base, level: 1 })).not.toBe(key)
    expect(layoutCacheKey({ ...base, schemaVersion: 'other' })).not.toBe(key)
    expect(layoutCacheKey({ ...base, scenarioId: 'other' })).not.toBe(key)
    expect(layoutCacheKey({ ...base, bundleId: 'other' })).not.toBe(key)
    expect(layoutCacheKey({ ...base, flowKinds: ['command'] })).not.toBe(key)
    expect(layoutCacheKey({ ...base, verificationStates: ['conflict'] })).not.toBe(key)
    expect(layoutCacheKey({ ...base, inputs: 'other' })).not.toBe(key)
  })

  it('过滤器顺序不影响 cache key，避免同一图被重复布局', () => {
    const base = {
      bundleId: 'bundle',
      schemaVersion: '0.1',
      scenarioId: 'scenario',
      level: 2,
      verificationStates: ['docs_only'] as const,
      inputs: 'sig',
    }
    expect(layoutCacheKey({ ...base, flowKinds: ['state', 'command'] })).toBe(
      layoutCacheKey({ ...base, flowKinds: ['command', 'state'] }),
    )
  })

  /**
   * The signature is what makes the key a function of the *data*, not just of
   * where the data came from. These cover acceptance criteria 9 (same input,
   * same result) and 10 (edited content must not reuse the old layout).
   */
  describe('layoutInputSignature', () => {
    /** The label inputs `useGraphController` would build for this graph. */
    function inputsOf(graph: ProjectedGraph) {
      const nameById = new Map(
        [...graph.nodes, ...graph.groups].map((node) => [node.id, node.label]),
      )
      return edgeLayoutInputs(graph, { level: 2, nodeLabel: (id) => nameById.get(id) })
    }

    function signatureOf(graph: ProjectedGraph): string {
      return layoutInputSignature(graph, inputsOf(graph))
    }

    /**
     * The projected edge standing for one flow.
     *
     * Looked up through `sourceFlowIds` rather than by rebuilding the id, so a
     * change to the id scheme moves the test with the code instead of quietly
     * pointing at nothing. The `throw` is what makes that true: a lookup that
     * silently returned `undefined` would turn the assertions below into
     * comparisons of `undefined` with `undefined`.
     */
    function edgeForFlow(graph: ProjectedGraph, flowId: string): string {
      const edge = graph.edges.find((candidate) => candidate.sourceFlowIds.includes(flowId))
      if (edge === undefined) throw new Error(`no projected edge stands for ${flowId}`)
      return edge.id
    }

    it('两个独立构建、内容相同的图签名一致（验收 9）', () => {
      // Two separate projections, not the same object twice: the signature has
      // to be a function of the content, or a cache rebuilt after a reload
      // would miss for no reason.
      expect(signatureOf(graphAt(2))).toBe(signatureOf(graphAt(2)))
    })

    it('只改 flow 名（标签文本）就改变签名（验收 10）', () => {
      const renamed = BASE_FLOWS.map((flow) =>
        flow.id === 'flow.rc_attitude'
          ? { ...flow, name: 'RC 姿态指令通道（已改名）' }
          : flow,
      )
      const before = graphAt(2)
      const after = graphAt(2, renamed)

      const edgeId = edgeForFlow(before, 'flow.rc_attitude')

      // The rename has to reach the measurement, otherwise the assertion below
      // would hold for a reason that has nothing to do with label text.
      expect(inputsOf(after).get(edgeId)?.metrics.width).not.toBe(
        inputsOf(before).get(edgeId)?.metrics.width,
      )

      expect(signatureOf(after)).not.toBe(signatureOf(before))
    })

    it('节点集合变化就改变签名', () => {
      const fewer = projectFixture({ level: 2, flows: BASE_FLOWS, omit: ['l2.imu'] })
      const full = graphAt(2)

      expect(fewer.nodes.length).not.toBe(full.nodes.length)
      expect(signatureOf(fewer)).not.toBe(signatureOf(full))
    })

    it('仅 placementRank 变化就改变签名', () => {
      // Written against the inputs rather than through the projection, because
      // a verification edit is *not* a clean way to isolate the rank: the
      // verification mark is measured inside the label box, so editing it
      // changes the ELK graph as well. Measured: swapping
      // docs_and_code_confirmed for conflict took the label from 149px to
      // 141px. The rank half would have been covered twice over, and the test
      // would have said "the rank matters" while proving nothing of the sort.
      const graph = graphAt(2)
      const inputs = inputsOf(graph)
      const edgeId = edgeForFlow(graph, 'flow.rate_motors')

      const original = inputs.get(edgeId)
      expect(original).toBeDefined()
      if (original === undefined) return

      const bumped = new Map(inputs)
      bumped.set(edgeId, { ...original, placementRank: original.placementRank + 1 })

      expect(layoutInputSignature(graph, bumped)).not.toBe(
        layoutInputSignature(graph, inputs),
      )
    })
  })

  it('相同 key 的并发请求只运行一次布局', async () => {
    let runs = 0
    const cache = new LayoutCache(4)
    const graph = graphAt(0)

    // `layoutGraph` shares the in-flight promise, so two calls overlap.
    const first = layoutGraph('key', graph, new Map(), cache)
    const second = layoutGraph('key', graph, new Map(), cache)
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
