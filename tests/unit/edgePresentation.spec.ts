import { describe, expect, it } from 'vitest'

import type { Verification } from '@/domain/model'
import type { ProjectedEdge } from '@/domain/view-model'
import { edgePresentation } from '@/layout/edgePresentation'

/**
 * The wording rules of GRAPH_READABILITY_DESIGN.md 5.1.
 *
 * These are worth pinning because the defect they fix was not a styling bug: at
 * L1 the canvas drew the *full* flow name on every edge, which was both
 * meaningless at that level (the reader is looking at domains, not flows) and
 * wide enough to push the layout apart. The distinction between what is drawn
 * and what is available is the whole point — so the tests below check the
 * compact text and the accessible text separately, and one of them asserts they
 * are allowed to disagree.
 */

function projectedEdge(overrides: Partial<ProjectedEdge> = {}): ProjectedEdge {
  return {
    id: 'edge.test',
    source: 'domain.flight_control',
    target: 'domain.actuation',
    kind: 'control',
    label: '姿态角速率控制律计算',
    feedback: false,
    verification: 'inferred',
    sourceFlowIds: ['flow.attitude_rate'],
    ...overrides,
  }
}

/** Display names, as the projection would have them. */
const NODE_NAMES: Record<string, string> = {
  'domain.flight_control': '飞行控制',
  'domain.actuation': '执行机构',
  'domain.state_estimation': '状态估计',
}

function nodeLabel(id: string): string | undefined {
  return NODE_NAMES[id]
}

function present(overrides: Partial<ProjectedEdge> = {}, level: 0 | 1 | 2 = 2) {
  return edgePresentation({ edge: projectedEdge(overrides), level, nodeLabel })
}

describe('edgePresentation 的紧凑文本', () => {
  it('L0/L1 只画 flow kind，不画完整 Flow 名', () => {
    for (const level of [0, 1] as const) {
      const presentation = present({}, level)
      expect(presentation.compactText).toBe('控制量')
      expect(presentation.compactText).not.toContain('姿态角速率控制律计算')
      expect(presentation.maxLines).toBe(1)
    }
  })

  it('L2 的单 Flow 边显示 Flow 本名，允许两行', () => {
    const presentation = present()
    expect(presentation.compactText).toBe('姿态角速率控制律计算')
    expect(presentation.maxLines).toBe(2)
  })

  it('聚合边画 类型 ×N，不画任何一个成员的名字', () => {
    const edge = { sourceFlowIds: ['flow.a', 'flow.b', 'flow.c'] }
    for (const level of [1, 2] as const) {
      const presentation = present(edge, level)
      expect(presentation.compactText).toBe('控制量 ×3')
      expect(presentation.maxLines).toBe(1)
    }
  })

  it('L2 的聚合边仍不是单 Flow，退回类型标签', () => {
    // The level alone does not decide; a name is only worth showing when the
    // edge stands for exactly one flow.
    const presentation = present({ sourceFlowIds: ['flow.a', 'flow.b'] })
    expect(presentation.compactText).not.toBe('姿态角速率控制律计算')
    expect(presentation.maxLines).toBe(1)
  })

  it('反馈边只画 反馈，不再把 kind 重复一遍', () => {
    const presentation = present({ feedback: true })
    expect(presentation.compactText).toBe('反馈')
    // The old canvas drew a kind label next to a 反馈 badge — the same thing
    // twice, in the space of two words.
    expect(presentation.compactText).not.toContain('控制量')
  })

  it('反馈优先于 L2 的 Flow 名：方向本身就是这条边要说的内容', () => {
    const presentation = present({ feedback: true })
    expect(presentation.compactText).not.toBe('姿态角速率控制律计算')
  })

  it('聚合的反馈边画 反馈 ×N', () => {
    expect(present({ feedback: true, sourceFlowIds: ['a', 'b'] }, 1).compactText).toBe('反馈 ×2')
  })

  it('每种 flow kind 都有中文标签，不会把 undefined 画到画布上', () => {
    const kinds = [
      'command',
      'measurement',
      'state',
      'event',
      'control',
      'actuation',
      'feedback',
    ] as const
    for (const kind of kinds) {
      const text = present({ kind }, 1).compactText
      expect(text).not.toBe('')
      expect(text).not.toContain('undefined')
    }
  })
})

describe('edgePresentation 的无障碍文本', () => {
  it('永远是完整句子：完整 Flow 名、方向与证据一个不少', () => {
    expect(present({}, 1).accessibleText).toBe(
      '控制量：姿态角速率控制律计算，飞行控制 → 执行机构，证据：推断',
    )
  })

  it('不随画布上的紧凑文本一起缩短', () => {
    // The canvas is allowed to say 控制量 at L1 while the accessible name keeps
    // the flow's real name — that disagreement is the design, not a defect.
    const atL1 = present({}, 1)
    const atL2 = present({}, 2)
    expect(atL1.compactText).not.toBe(atL2.compactText)
    expect(atL1.accessibleText).toBe(atL2.accessibleText)
  })

  it('隐藏标签的低缩放不影响无障碍名：文本在投影上，不在视图上', () => {
    // 5.3 hides labels below a zoom threshold. `edgePresentation` has no zoom
    // input at all, which is what guarantees a screen reader still hears it.
    expect(present().accessibleText).toContain('姿态角速率控制律计算')
  })

  it('反馈边仍然说出真实 kind，画布上的 反馈 只是绘制选择', () => {
    const presentation = present({ feedback: true })
    expect(presentation.compactText).toBe('反馈')
    expect(presentation.accessibleText).toContain('控制量')
  })

  it('查不到显示名时退回投影 id，而不是留空', () => {
    const presentation = present({ source: 'domain.unknown' })
    expect(presentation.accessibleText).toContain('domain.unknown')
  })

  it('证据措辞用完整标签，不是紧凑符号', () => {
    expect(present({ verification: 'docs_and_code_confirmed' }).accessibleText).toContain(
      '文档与代码已确认',
    )
  })
})

describe('edgePresentation 的验证标记', () => {
  it('沿用既有的 ✓/?/!/DC 符号，不另造一套', () => {
    // The design doc 5.2 proposed H/I/DC/C/D/!; the project already had a
    // glyph set that the legend and the node badges both read, and a second set
    // is how the legend starts disagreeing with the canvas.
    const mark = (verification: Verification) => present({ verification }).verificationMark
    expect(mark('human_verified')).toBe('✓')
    expect(mark('inferred')).toBe('?')
    expect(mark('conflict')).toBe('!')
    expect(mark('docs_and_code_confirmed')).toBe('DC')
  })
})
