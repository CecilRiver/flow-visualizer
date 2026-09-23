import { describe, expect, it } from 'vitest'

import type { FlowKind, GraphLevel } from '@/domain/model'
import type { ProjectedEdge, ProjectedGraph } from '@/domain/view-model'
import { computeElkLayout } from '@/layout/elkLayout'
import {
  assignRenderPorts,
  localPortPosition,
  portsById,
  renderPortId,
  resolvePortCoordinates,
  sideForEnd,
  type PortSpec,
} from '@/layout/layoutPorts'
import { sizeForNode } from '@/layout/nodeMetrics'
import { GROUP_ID_PREFIX } from '@/projection/projectScenario'

import type { FlowInit } from '../fixtures/buildModel'

import { projectFixture } from './helpers/projectFixture'

/**
 * Render ports (GRAPH_READABILITY_DESIGN.md 7.3, 18.3).
 *
 * The module exists so that one geometry has two readers instead of two
 * geometries having one reader each. These cases pin the properties that make
 * that true: a port is named after the edge and end it belongs to, its side is
 * decided before the layout runs, and — the one that matters most — the
 * coordinate we hand ELK is the coordinate ELK hands back, so the point the
 * route ends on is the point the handle is drawn at.
 */

function edge(
  id: string,
  source: string,
  target: string,
  handles: { sourceHandle?: string; targetHandle?: string } = {},
): ProjectedEdge {
  return {
    id,
    source,
    target,
    kind: 'command' as FlowKind,
    label: id,
    feedback: false,
    verification: 'inferred',
    sourceFlowIds: [id],
    ...handles,
  }
}

function graphOf(edges: readonly ProjectedEdge[]): ProjectedGraph {
  return { nodes: [], edges, groups: [], diagnostics: [] }
}

/** A port spec with no coordinate, which is what ELK is given. */
function spec(id: string, side: PortSpec['side'], order: number, count: number): PortSpec {
  return { id, nodeId: 'n', end: side === 'WEST' ? 'target' : 'source', side, order, count }
}

describe('renderPortId', () => {
  it('由边与端决定，同一端重复调用得到同一个 id', () => {
    expect(renderPortId('edge:L2:a:b:command:fw', 'source')).toBe(
      'layout-port:edge:L2:a:b:command:fw:source',
    )
    // Rule 3 names the port after the edge, not after the Schema port: an
    // aggregated edge has no Schema port, and it still has two endpoints.
    expect(renderPortId('e', 'target')).toBe('layout-port:e:target')
  })
})

describe('sideForEnd', () => {
  it('前向边离开 EAST、到达 WEST', () => {
    expect(sideForEnd('source')).toBe('EAST')
    expect(sideForEnd('target')).toBe('WEST')
  })
})

describe('assignRenderPorts', () => {
  it('每条边两端各得一个端口，id 唯一', () => {
    const graph = graphOf([edge('e1', 'a', 'b'), edge('e2', 'a', 'c')])
    const specs = assignRenderPorts(graph)

    expect(specs).toHaveLength(4)
    expect(new Set(specs.map((entry) => entry.id)).size).toBe(specs.length)

    const ids = specs.map((entry) => entry.id).sort()
    expect(ids).toEqual(
      [
        renderPortId('e1', 'source'),
        renderPortId('e1', 'target'),
        renderPortId('e2', 'source'),
        renderPortId('e2', 'target'),
      ].sort(),
    )
  })

  it('源端口在 EAST、目标端口在 WEST，且各自挂在正确的节点上', () => {
    const specs = assignRenderPorts(graphOf([edge('e1', 'a', 'b')]))
    const source = specs.find((entry) => entry.end === 'source')
    const target = specs.find((entry) => entry.end === 'target')

    expect(source?.nodeId).toBe('a')
    expect(source?.side).toBe('EAST')
    expect(target?.nodeId).toBe('b')
    expect(target?.side).toBe('WEST')
  })

  it('同侧顺序取自投影顺序，与边的 id 排序无关', () => {
    // Two edges leave `a`; the projection already ordered them, and that order
    // is the whole reason no second sort (and no tie-break) is needed here
    // (7.3 rule 5). `z` sorts after `a` but comes first in the graph.
    const specs = assignRenderPorts(graphOf([edge('z', 'a', 'b'), edge('a', 'a', 'c')]))
    const east = specs.filter((entry) => entry.side === 'EAST')

    expect(east.map((entry) => entry.id)).toEqual([
      renderPortId('z', 'source'),
      renderPortId('a', 'source'),
    ])
    expect(east.map((entry) => entry.order)).toEqual([0, 1])
    expect(east.every((entry) => entry.count === 2)).toBe(true)
  })

  it('输入顺序不变时端口顺序不变，反过来则依次调换', () => {
    const first = assignRenderPorts(graphOf([edge('e1', 'a', 'b'), edge('e2', 'a', 'c')]))
    const again = assignRenderPorts(graphOf([edge('e1', 'a', 'b'), edge('e2', 'a', 'c')]))
    const reversed = assignRenderPorts(graphOf([edge('e2', 'a', 'c'), edge('e1', 'a', 'b')]))

    expect(first).toEqual(again)
    const eastOf = (specs: readonly PortSpec[]) =>
      specs.filter((entry) => entry.side === 'EAST').map((entry) => entry.id)
    expect(eastOf(reversed)).toEqual([...eastOf(first)].reverse())
  })

  it('只有投影保留了端口时才带 semanticPortId', () => {
    const specs = assignRenderPorts(
      graphOf([
        edge('e1', 'a', 'b', { sourceHandle: 'telemetry', targetHandle: 'in.a' }),
        // An aggregated edge: `aggregateEdges` dropped the handles, and the
        // adapter must not invent one (7.3 rule 4).
        edge('e2', 'a', 'c'),
      ]),
    )
    const byId = new Map(specs.map((entry) => [entry.id, entry]))

    expect(byId.get(renderPortId('e1', 'source'))?.semanticPortId).toBe('telemetry')
    expect(byId.get(renderPortId('e1', 'target'))?.semanticPortId).toBe('in.a')
    expect(byId.get(renderPortId('e2', 'source'))).not.toHaveProperty('semanticPortId')
    expect(byId.get(renderPortId('e2', 'target'))).not.toHaveProperty('semanticPortId')
  })

  it('从不分配 SOUTH：下方的通道要等布局之后才知道是否需要', () => {
    const specs = assignRenderPorts(
      graphOf([edge('e1', 'a', 'b'), edge('e2', 'b', 'a')]),
    )
    expect(specs.every((entry) => entry.side === 'EAST' || entry.side === 'WEST')).toBe(true)
  })
})

describe('localPortPosition', () => {
  const size = { width: 240, height: 124 }

  it('同侧按 (k+1)/(n+1) 均分，单位是像素', () => {
    expect(localPortPosition(spec('p0', 'EAST', 0, 3), size).y).toBeCloseTo(31, 6)
    expect(localPortPosition(spec('p1', 'EAST', 1, 3), size).y).toBeCloseTo(62, 6)
    expect(localPortPosition(spec('p2', 'EAST', 2, 3), size).y).toBeCloseTo(93, 6)
  })

  it('EAST 贴右边、WEST 贴左边、SOUTH 贴下边的中点', () => {
    expect(localPortPosition(spec('p', 'EAST', 0, 1), size)).toEqual({ x: 240, y: 62 })
    expect(localPortPosition(spec('p', 'WEST', 0, 1), size)).toEqual({ x: 0, y: 62 })
    expect(localPortPosition(spec('p', 'SOUTH', 0, 2), size)).toEqual({ x: 80, y: 124 })
    expect(localPortPosition(spec('p', 'SOUTH', 1, 2), size)).toEqual({ x: 160, y: 124 })
  })

  it('同侧坐标单调递增且互不重叠', () => {
    // 8 ports on a 124px-tall node sit ~13.8px apart, which is still wider than
    // the 6px handle Vue Flow draws. The failure this guards against is a
    // distribution that collapses two ports onto one point — visually a single
    // dot with two edges leaving it.
    const count = 8
    const positions = Array.from({ length: count }, (_, index) =>
      localPortPosition(spec(`p${String(index)}`, 'EAST', index, count), size),
    )
    for (let index = 1; index < positions.length; index += 1) {
      const previous = positions[index - 1]
      const current = positions[index]
      expect(current?.y ?? 0).toBeGreaterThan(previous?.y ?? 0)
    }
    const gaps = positions.slice(1).map((point, index) => point.y - (positions[index]?.y ?? 0))
    expect(Math.min(...gaps)).toBeGreaterThan(6)
  })
})

describe('resolvePortCoordinates', () => {
  it('把节点局部坐标搬到根图绝对坐标', () => {
    const ports = resolvePortCoordinates(
      [spec('p', 'EAST', 0, 1)],
      new Map([['p', { x: 240, y: 30 }]]),
      new Map([['n', { x: 100, y: 200 }]]),
    )
    expect(ports).toEqual([
      { id: 'p', nodeId: 'n', end: 'source', side: 'EAST', order: 0, x: 340, y: 230 },
    ])
  })

  it('节点或局部坐标缺失时丢弃端口，而不是放在原点', () => {
    // A port at (0, 0) would draw a confident handle in the corner of the canvas
    // for an edge that has nowhere to attach.
    const nodeless = resolvePortCoordinates(
      [spec('p', 'EAST', 0, 1)],
      new Map([['p', { x: 1, y: 1 }]]),
      new Map(),
    )
    const unplaced = resolvePortCoordinates(
      [spec('p', 'EAST', 0, 1)],
      new Map(),
      new Map([['n', { x: 1, y: 1 }]]),
    )
    expect(nodeless).toEqual([])
    expect(unplaced).toEqual([])
  })

  it('semanticPortId 原样带过去，缺失时字段不出现', () => {
    const withName: PortSpec = { ...spec('p1', 'EAST', 0, 1), semanticPortId: 'telemetry' }
    const ports = resolvePortCoordinates(
      [withName, spec('p2', 'WEST', 0, 1)],
      new Map([
        ['p1', { x: 1, y: 1 }],
        ['p2', { x: 2, y: 2 }],
      ]),
      new Map([['n', { x: 0, y: 0 }]]),
    )
    const byId = portsById(ports)

    expect(byId.get('p1')?.semanticPortId).toBe('telemetry')
    expect(byId.get('p2')).not.toHaveProperty('semanticPortId')
  })
})

/*
 * The round trip, measured against ELK rather than argued from the source.
 *
 * `FIXED_POS` means ELK echoes the leaf coordinate we declared instead of
 * choosing one, so "what we computed" and "what it returned" are the same
 * number. That equality is 18.3 in its machine-checkable form: the route leaves
 * from the port, and the port is where the handle is drawn, so a route that
 * starts anywhere else would have to be a second geometry.
 */
const BASE_FLOWS: readonly FlowInit[] = [
  { id: 'flow.rc_attitude', from: 'ext.rc', to: 'l2.attitude', kind: 'command' },
  { id: 'flow.ahrs_attitude', from: 'l2.ahrs', to: 'l2.attitude', kind: 'state' },
  { id: 'flow.attitude_rate', from: 'l2.attitude', to: 'l2.rate', kind: 'control' },
  { id: 'flow.rate_motors', from: 'l2.rate', to: 'ext.motors', kind: 'actuation' },
]

/**
 * The canonical flows plus one that ends on the L1 domain itself.
 *
 * That is the only shape that produces a container endpoint: at L2 a domain
 * owning visible children becomes a display group, and an edge whose endpoint
 * is the domain is retargeted onto it (`projectScenario` step 5). Without it the
 * container case has nothing to measure.
 */
const CONTAINER_FLOWS: readonly FlowInit[] = [
  ...BASE_FLOWS,
  { id: 'flow.domain_cmd', from: 'ext.rc', to: 'domain.control', kind: 'command' },
]

function graphAt(level: GraphLevel, flows: readonly FlowInit[] = BASE_FLOWS): ProjectedGraph {
  return projectFixture({ level, flows })
}

describe('ELK 往返：我们算出的端口坐标就是 ELK 回传的坐标', () => {
  it('叶节点逐点相等', async () => {
    const graph = graphAt(2)
    const result = await computeElkLayout(graph)
    const specs = assignRenderPorts(graph)
    const portById = portsById(result.ports)
    const boxById = new Map(result.nodes.map((entry) => [entry.id, entry]))
    const nodeById = new Map([...graph.nodes, ...graph.groups].map((entry) => [entry.id, entry]))

    expect(specs.length).toBeGreaterThan(0)
    let compared = 0

    for (const entry of specs) {
      // Containers are the other case: their box is ELK's output, so
      // `FIXED_SIDE` lets ELK distribute the ports itself and there is no
      // declared coordinate of ours to compare against.
      if (entry.nodeId.startsWith(GROUP_ID_PREFIX)) continue
      const node = nodeById.get(entry.nodeId)
      const box = boxById.get(entry.nodeId)
      const port = portById.get(entry.id)
      if (node === undefined || box === undefined || port === undefined) continue

      const local = localPortPosition(entry, sizeForNode(node))
      expect(port.x, `${entry.id} 的 x 与声明值不符`).toBeCloseTo(box.x + local.x, 6)
      expect(port.y, `${entry.id} 的 y 与声明值不符`).toBeCloseTo(box.y + local.y, 6)
      compared += 1
    }

    // Without this the loop above is satisfiable by skipping every port.
    expect(compared, '没有任何叶节点端口被比较，这条断言就失去意义').toBeGreaterThan(0)
  })

  it('端口按声明的侧落在节点边界上，而不是浮在盒子里', async () => {
    const graph = graphAt(2)
    const result = await computeElkLayout(graph)
    const boxById = new Map(result.nodes.map((entry) => [entry.id, entry]))

    for (const port of result.ports) {
      const box = boxById.get(port.nodeId)
      expect(box, `${port.id} 挂在没有布局坐标的节点上`).toBeDefined()
      if (box === undefined) continue
      if (port.side === 'EAST') expect(port.x).toBeCloseTo(box.x + box.width, 6)
      else if (port.side === 'WEST') expect(port.x).toBeCloseTo(box.x, 6)
      else expect(port.y).toBeCloseTo(box.y + box.height, 6)
    }
  })

  it('每个端口都挂在一个投影真实存在的节点上', async () => {
    const graph = graphAt(2)
    const result = await computeElkLayout(graph)
    const known = new Set([...graph.nodes, ...graph.groups].map((entry) => entry.id))

    expect(result.ports.length).toBeGreaterThan(0)
    for (const port of result.ports) {
      expect(known.has(port.nodeId), `${port.id} 挂在未知节点 ${port.nodeId}`).toBe(true)
    }
  })

  it('每条边两端各有一个端口，且 id 与边自报的一致', async () => {
    const graph = graphAt(2)
    const result = await computeElkLayout(graph)
    const byId = portsById(result.ports)

    for (const entry of result.edges) {
      expect(byId.get(entry.sourcePortId), `${entry.id} 缺 source port`).toBeDefined()
      expect(byId.get(entry.targetPortId), `${entry.id} 缺 target port`).toBeDefined()
      expect(entry.sourcePortId).toBe(renderPortId(entry.id, 'source'))
      expect(entry.targetPortId).toBe(renderPortId(entry.id, 'target'))
    }
  })

  it('容器上的端口由 ELK 自己分布，仍然落在容器的边界上', async () => {
    // Nothing here compares against our formula, and that is the point: a
    // container's size is ELK's output, so `FIXED_SIDE` has ELK place the port
    // and the only thing left to assert is that we read its answer rather than
    // recomputing one of our own from a box we assumed.
    const graph = graphAt(2, CONTAINER_FLOWS)
    const result = await computeElkLayout(graph)
    const boxById = new Map(result.nodes.map((entry) => [entry.id, entry]))
    const groupIds = new Set(graph.groups.map((entry) => entry.id))

    const containerPorts = result.ports.filter((port) => groupIds.has(port.nodeId))
    expect(containerPorts.length, 'L1 夹具没有容器端口，这条断言就失去意义').toBeGreaterThan(0)

    for (const port of containerPorts) {
      const box = boxById.get(port.nodeId)
      expect(box).toBeDefined()
      if (box === undefined) continue
      if (port.side === 'EAST') expect(port.x).toBeCloseTo(box.x + box.width, 6)
      else if (port.side === 'WEST') expect(port.x).toBeCloseTo(box.x, 6)
      else expect(port.y).toBeCloseTo(box.y + box.height, 6)
      // And it stays inside the container's own extent along the other axis, so
      // a route to it never has to cross the container to get there.
      expect(port.y).toBeGreaterThanOrEqual(box.y)
      expect(port.y).toBeLessThanOrEqual(box.y + box.height)
    }
  })
})
