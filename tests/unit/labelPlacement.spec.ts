import { describe, expect, it } from 'vitest'

import { measureEdgeLabel, type EdgeLabelMetrics } from '@/layout/labelMetrics'
import {
  comparePlacementPriority,
  placeEdgeLabels,
  type PlacementEdge,
  type PlacementNode,
} from '@/layout/labelPlacement'

/**
 * GRAPH_READABILITY_DESIGN.md 10: every label is checked before it is drawn.
 *
 * The property that matters most here is the last resort — a label with nowhere
 * free is *not drawn*, rather than drawn on top of something. An overlapping
 * label is worse than an absent one, because the reader cannot tell what the
 * text belongs to (14).
 */

const METRICS = measureEdgeLabel({ text: '命令', mark: 'C', maxLines: 1 })

function metricsFor(text: string): EdgeLabelMetrics {
  return measureEdgeLabel({ text, mark: 'C', maxLines: 1 })
}

function edge(overrides: Partial<PlacementEdge> & { id: string }): PlacementEdge {
  return {
    source: 'a',
    target: 'b',
    routes: [
      [
        { x: 100, y: 25 },
        { x: 300, y: 25 },
      ],
    ],
    verificationRank: 0,
    feedback: false,
    sourceOrder: 0,
    ...overrides,
  }
}

function node(id: string, x: number, y: number, width = 100, height = 50): PlacementNode {
  return { id, x, y, width, height }
}

/** Two nodes with a straight horizontal run between them. */
const TWO_NODES = [node('a', 0, 0), node('b', 300, 0)]

describe('placeEdgeLabels 的候选位置', () => {
  it('有位置就放下，并标记为默认可见', () => {
    const labels = placeEdgeLabels({
      edges: [edge({ id: 'e1' })],
      nodes: TWO_NODES,
      metrics: new Map([['e1', METRICS]]),
    })

    expect(labels).toHaveLength(1)
    expect(labels[0]?.visibleByDefault).toBe(true)
    expect(labels[0]?.issue).toBeNull()
    expect(labels[0]?.lines).toEqual(METRICS.lines)
  })

  it('首选位置被占时退到下一个候选，而不是压上去', () => {
    // An obstacle sits exactly where the "above the line" candidate would go.
    const obstacle = node('obstacle', 150, -40, 100, 40)
    const labels = placeEdgeLabels({
      edges: [edge({ id: 'e1' })],
      nodes: [...TWO_NODES, obstacle],
      metrics: new Map([['e1', METRICS]]),
    })

    const label = labels[0]
    expect(label?.visibleByDefault).toBe(true)
    // Moved below the run (y = 25) instead of above it.
    expect(label?.y).toBeGreaterThan(25)
  })

  it('允许压住自己两端的节点（设计文档 10）', () => {
    // A short run whose label is wider than the gap between the two nodes, so
    // both endpoints are covered. Forbidding that would silence exactly the
    // edges whose endpoints are closest together.
    const labels = placeEdgeLabels({
      edges: [
        edge({
          id: 'e1',
          routes: [
            [
              { x: 200, y: 25 },
              { x: 250, y: 25 },
            ],
          ],
        }),
      ],
      nodes: [node('a', 0, 0, 200), node('b', 250, 0, 200)],
      metrics: new Map([['e1', METRICS]]),
    })

    const label = labels[0]
    expect(label?.visibleByDefault).toBe(true)
    // The box really does reach into the source node — that is the exemption.
    expect(label?.x).toBeLessThan(200)
  })

  it('四个方向都被堵死时隐藏标签，并给出原因', () => {
    const labels = placeEdgeLabels({
      edges: [edge({ id: 'e1' })],
      nodes: [
        ...TWO_NODES,
        node('above', 0, -60, 400, 50),
        node('below', 0, 60, 400, 50),
      ],
      metrics: new Map([['e1', METRICS]]),
    })

    const label = labels[0]
    expect(label?.visibleByDefault).toBe(false)
    expect(label?.issue).toBe('NODE_OVERLAP')
    // Hidden means hidden: no box was handed out for something not drawn.
    expect(label?.lines).toEqual(METRICS.lines)
  })

  it('两段不相邻的路由之间不算作一条线段', () => {
    // The reason `routes` is a list of polylines rather than one polyline.
    //
    // Two sections that do not meet — which an edge crossing a container
    // boundary can produce — leave a gap the layout never routed. Joining them
    // would hand the placement pass a 250px "segment" spanning that gap, it
    // would prefer it as the longest horizontal run, and the label would be
    // drawn floating over empty canvas between two pieces of the same route.
    //
    // The assertion is on where the label landed, not on whether it was drawn:
    // both versions produce a visible label, and only one of them puts it
    // somewhere a line exists.
    const labels = placeEdgeLabels({
      edges: [
        edge({
          id: 'e1',
          routes: [
            [
              { x: 100, y: 25 },
              { x: 150, y: 25 },
            ],
            [
              { x: 400, y: 25 },
              { x: 450, y: 25 },
            ],
          ],
        }),
      ],
      nodes: [node('a', 0, 0, 100), node('b', 300, 0, 100)],
      metrics: new Map([['e1', METRICS]]),
    })

    const label = labels[0]
    expect(label?.visibleByDefault).toBe(true)
    // The longest real segment is the first one, centred on 125. The joined
    // form would have centred the label on 275, in the gap.
    expect((label?.x ?? 0) + (label?.width ?? 0) / 2).toBeCloseTo(125, 6)
  })

  it('没有可用线段时报 NO_SAFE_SEGMENT，而不是崩溃', () => {
    const labels = placeEdgeLabels({
      edges: [edge({ id: 'e1', routes: [[{ x: 10, y: 10 }]] })],
      nodes: TWO_NODES,
      metrics: new Map([['e1', METRICS]]),
    })

    expect(labels[0]?.visibleByDefault).toBe(false)
    expect(labels[0]?.issue).toBe('NO_SAFE_SEGMENT')
  })

  it('没有度量的边不产出标签', () => {
    const labels = placeEdgeLabels({
      edges: [edge({ id: 'e1' }), edge({ id: 'e2' })],
      nodes: TWO_NODES,
      metrics: new Map([['e1', METRICS]]),
    })

    expect(labels.map((label) => label.edgeId)).toEqual(['e1'])
  })

  it('返回顺序与传入的边一致，调用方可以按下标对应', () => {
    const labels = placeEdgeLabels({
      edges: [edge({ id: 'e2', sourceOrder: 1 }), edge({ id: 'e1', sourceOrder: 0 })],
      nodes: TWO_NODES,
      metrics: new Map([
        ['e1', METRICS],
        ['e2', METRICS],
      ]),
    })

    expect(labels.map((label) => label.edgeId)).toEqual(['e2', 'e1'])
  })
})

describe('placeEdgeLabels 的争夺顺序', () => {
  /** Only the space above the run is free; below is blocked. */
  const CONTESTED = [...TWO_NODES, node('below', 0, 60, 400, 50)]

  function contest(rankOfFirst: number, rankOfSecond: number) {
    return placeEdgeLabels({
      edges: [
        edge({ id: 'e1', sourceOrder: 0, verificationRank: rankOfFirst }),
        edge({ id: 'e2', sourceOrder: 1, verificationRank: rankOfSecond }),
      ],
      nodes: CONTESTED,
      metrics: new Map([
        ['e1', METRICS],
        ['e2', METRICS],
      ]),
    })
  }

  it('验证状态更严重的边先挑位置', () => {
    const labels = contest(0, 3)
    const visible = labels.filter((label) => label.visibleByDefault)
    const hidden = labels.filter((label) => !label.visibleByDefault)

    expect(visible.map((label) => label.edgeId)).toEqual(['e1'])
    expect(hidden.map((label) => label.edgeId)).toEqual(['e2'])
    // Blocked by the label e1 already took, which is what "first pick" means
    // here — the obstacle below is the fallback, not the reason.
    expect(hidden[0]?.issue).toBe('LABEL_OVERLAP')
  })

  it('严重度相同时先后顺序由投影顺序决定', () => {
    // Same rank, so `sourceOrder` decides: e1 is earlier in the projection.
    const labels = contest(2, 2)
    expect(labels.filter((label) => label.visibleByDefault).map((label) => label.edgeId)).toEqual([
      'e1',
    ])
  })

  it('顺序完全由输入决定，两次运行结果一致', () => {
    const build = () => contest(1, 4)
    expect(build()).toEqual(build())
  })
})

describe('comparePlacementPriority', () => {
  it('严重度优先，其次是反馈，再是投影顺序，最后是 id', () => {
    const base = edge({ id: 'x', verificationRank: 1, sourceOrder: 0 })
    expect(comparePlacementPriority(base, edge({ ...base, id: 'y', verificationRank: 0 }))).toBeGreaterThan(0)
    expect(comparePlacementPriority(base, edge({ ...base, id: 'y', feedback: true }))).toBeGreaterThan(0)
    expect(comparePlacementPriority(base, edge({ ...base, id: 'y', sourceOrder: 1 }))).toBeLessThan(0)
    expect(comparePlacementPriority(base, edge({ ...base, id: 'a' }))).toBeGreaterThan(0)
    expect(comparePlacementPriority(base, edge({ ...base }))).toBe(0)
  })
})

describe('placeEdgeLabels 的确定性', () => {
  it('打乱输入顺序不改变放置结果', () => {
    const edges = [
      edge({ id: 'e1', sourceOrder: 0 }),
      edge({ id: 'e2', sourceOrder: 1 }),
      edge({ id: 'e3', sourceOrder: 2 }),
    ]
    const metrics = new Map(edges.map((entry) => [entry.id, metricsFor(entry.id)]))

    const forward = placeEdgeLabels({ edges, nodes: TWO_NODES, metrics })
    const backward = placeEdgeLabels({ edges: [...edges].reverse(), nodes: TWO_NODES, metrics })

    const normalise = (labels: typeof forward) =>
      [...labels].sort((a, b) => (a.edgeId < b.edgeId ? -1 : 1))
    expect(normalise(backward)).toEqual(normalise(forward))
  })
})
