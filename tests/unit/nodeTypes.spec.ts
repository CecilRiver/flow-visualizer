import { describe, expect, it } from 'vitest'

import { EDGE_TYPE, hasRoute, type SemanticEdgeData } from '@/adapters/vueFlow/edgeTypes'
import { NODE_TYPE, nodeTypeFor, type NodeTypeName } from '@/adapters/vueFlow/nodeTypes'
import type { ProjectedNode } from '@/domain/view-model'
import { GROUP_ID_PREFIX } from '@/projection/projectScenario'

/**
 * The node/edge type maps are small, but they are the contract between the
 * adapter and the renderers: `FlowCanvas.vue` keys its `nodeTypes`/`edgeTypes`
 * lookup by these exact strings, and DESIGN.md 17.2 requires the choice to come
 * from fixed code rather than from a configuration field. A rename or a
 * configuration-driven mapping would silently drop every node to Vue Flow's
 * default renderer, so the mapping is worth pinning.
 */

function projectedNode(overrides: Partial<ProjectedNode> & { id: string }): ProjectedNode {
  return {
    level: 2,
    scope: 'internal',
    kind: 'controller',
    label: overrides.id,
    sourceComponentIds: [overrides.id],
    hiddenInternalFlowIds: [],
    ...overrides,
  }
}

describe('nodeTypeFor', () => {
  it('类型名就是渲染器注册用的固定字符串', () => {
    expect(NODE_TYPE).toEqual({ business: 'business', external: 'external', group: 'group' })
    expect(EDGE_TYPE).toEqual({ semantic: 'semantic' })
  })

  it('group 前缀优先于 scope：容器即便被标成 external 也仍是 group', () => {
    // The prefix is owned by the projection layer and is the only thing that
    // marks a display container; trusting a second signal here could draw a
    // container as a boundary node.
    const group = projectedNode({ id: `${GROUP_ID_PREFIX}domain.control`, scope: 'external' })
    expect(nodeTypeFor(group)).toBe(NODE_TYPE.group)
  })

  it('外部边界按其 scope 判定，与 level 无关', () => {
    expect(nodeTypeFor(projectedNode({ id: 'ext.rc', scope: 'external', level: 0 }))).toBe(
      NODE_TYPE.external,
    )
    expect(nodeTypeFor(projectedNode({ id: 'ext.rc.l1', scope: 'external', level: 1 }))).toBe(
      NODE_TYPE.external,
    )
  })

  it('内部节点一律是 business，L0/L1/L2 都一样', () => {
    const levels = [0, 1, 2] as const
    for (const level of levels) {
      expect(nodeTypeFor(projectedNode({ id: `sys.${level}`, level }))).toBe(NODE_TYPE.business)
    }
  })

  it('kind 不能决定渲染器：配置改不了画的是哪种节点', () => {
    const kinds = ['system', 'actor', 'capability_domain', 'controller', 'estimator']
    const types = kinds.map((kind) =>
      nodeTypeFor(projectedNode({ id: `n.${kind}`, kind, scope: 'internal' })),
    )

    expect(new Set<NodeTypeName>(types)).toEqual(new Set<NodeTypeName>([NODE_TYPE.business]))
  })
})

describe('edgeTypes', () => {
  const base: SemanticEdgeData = {
    id: 'edge.test',
    kind: 'command',
    label: '命令',
    feedback: false,
    verificationLabel: '推断',
    verificationShortLabel: '推断',
    flowCount: 1,
    bendPoints: [],
    startPoint: null,
    endPoint: null,
    highlighted: false,
    dimmed: false,
  }

  it('hasRoute 只在 ELK 给出折点时为真', () => {
    // The renderer switches on this: no bend points means Vue Flow's own
    // smooth-step routing draws the line (DESIGN.md 10.5).
    expect(hasRoute(base)).toBe(false)
    expect(hasRoute({ ...base, bendPoints: [{ x: 10, y: 10 }] })).toBe(true)
  })

})
