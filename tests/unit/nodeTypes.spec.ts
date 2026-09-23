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
    // Only the fields the edge-type helpers read matter here; the presentation
    // is a literal because these cases are about routing, not wording.
    presentation: {
      compactText: '命令',
      accessibleText: '命令：命令',
      verificationMark: '?',
      maxLines: 1,
    },
    verification: 'inferred',
    feedback: false,
    verificationLabel: '推断',
    verificationShortLabel: '推断',
    flowCount: 1,
    sections: [],
    // No layout ran, so no label was placed. A fixture that invented a box here
    // would be asserting on geometry this file has no interest in.
    labelBox: null,
    highlighted: false,
    dimmed: false,
  }

  /** A section with no bend points at all — a straight orthogonal run (8). */
  const STRAIGHT = {
    id: 'e1_s0',
    startPoint: { x: 0, y: 0 },
    bendPoints: [],
    endPoint: { x: 100, y: 0 },
    incomingSections: [],
    outgoingSections: [],
  }

  it('hasRoute 看的是 section，不是折点', () => {
    // The renderer switches on this: with no sections there is nothing to draw
    // and Vue Flow's smooth-step is the last resort (9.3.2).
    expect(hasRoute(base)).toBe(false)

    // And a straight run counts. ELK returns it as one section with the
    // `bendPoints` key *absent* rather than empty, so a predicate reading the
    // bend points would call this unrouted — and the renderer would then fall
    // back to Vue Flow's endpoints, which are a different geometry from the one
    // the layout computed. That is precisely the disagreement 9.1 removes, and
    // it would have survived in the case that looks least like a bug.
    expect(hasRoute({ ...base, sections: [STRAIGHT] })).toBe(true)
    expect(hasRoute({ ...base, sections: [{ ...STRAIGHT, bendPoints: [{ x: 50, y: 0 }] }] })).toBe(
      true,
    )
  })
})
