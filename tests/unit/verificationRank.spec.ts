import { describe, expect, it } from 'vitest'

import type { Verification } from '@/domain/model'
import {
  VERIFICATION_SEVERITY_ORDER,
  aggregateVerification,
  moreConservative,
  severityRank,
} from '@/projection/verificationRank'

/**
 * The fixed severity order used when flows aggregate into one edge
 * (DESIGN.md 9.5, 15.3, 19.1).
 *
 * The order is a business rule rather than a sort: one `conflict` underneath
 * forces the aggregate edge to read as conflicted, and no number of weaker
 * states may vote it away. `ALL` is spelled out here instead of imported so the
 * module's own order is checked against an independent copy of 9.5.
 */
const ALL: readonly Verification[] = [
  'conflict',
  'inferred',
  'docs_only',
  'code_confirmed',
  'docs_and_code_confirmed',
  'human_verified',
]

/**
 * The oracle: for a non-empty list, the expected result is the state that comes
 * first in `ALL`. Deliberately not implemented with `severityRank`, so a wrong
 * rank table cannot agree with itself.
 */
function mostSevere(states: readonly Verification[]): Verification {
  for (const candidate of ALL) {
    if (states.includes(candidate)) return candidate
  }
  throw new Error(`no verification state to aggregate: ${states.length}`)
}

describe('固定严重度顺序', () => {
  it('导出的顺序与第 9.5 节的顺序完全一致', () => {
    expect([...VERIFICATION_SEVERITY_ORDER]).toEqual([...ALL])
    expect(VERIFICATION_SEVERITY_ORDER).toHaveLength(ALL.length)
  })

  it('每个状态都有唯一的 rank，conflict 最小、human_verified 最大', () => {
    const ranks = ALL.map((state) => severityRank(state))

    expect(ranks).toEqual([0, 1, 2, 3, 4, 5])
    expect(new Set(ranks).size).toBe(ALL.length)
    expect(severityRank('conflict')).toBe(0)
    expect(severityRank('human_verified')).toBe(Math.max(...ranks))
  })
})

describe('两两组合（6 × 6 全矩阵）', () => {
  it('任意两个状态取更严重者，且与参数顺序无关', () => {
    for (const a of ALL) {
      for (const b of ALL) {
        const expected = mostSevere([a, b])

        expect(moreConservative(a, b)).toBe(expected)
        // Commutative: the order the projection happens to fold in must not
        // change the label the edge carries.
        expect(moreConservative(b, a)).toBe(expected)
        // Idempotent: a repeated state is still that state.
        expect(moreConservative(a, a)).toBe(a)
      }
    }
  })

  it('conflict 压过任何状态，无论出现在哪一侧', () => {
    for (const other of ALL) {
      expect(moreConservative('conflict', other)).toBe('conflict')
      expect(moreConservative(other, 'conflict')).toBe('conflict')
    }
  })

  it('结果永远是最严重的输入，而不会凭空升级', () => {
    for (const a of ALL) {
      for (const b of ALL) {
        const result = moreConservative(a, b)

        expect(severityRank(result)).toBe(Math.min(severityRank(a), severityRank(b)))
        expect(severityRank(result)).toBeLessThanOrEqual(severityRank(a))
        expect(severityRank(result)).toBeLessThanOrEqual(severityRank(b))
      }
    }
  })
})

describe('三状态全矩阵（6 × 6 × 6）', () => {
  it('三个状态的任意组合都取最严重者，不做多数投票', () => {
    for (const a of ALL) {
      for (const b of ALL) {
        for (const c of ALL) {
          const expected = mostSevere([a, b, c])

          expect(aggregateVerification([a, b, c])).toBe(expected)
          // Permutation invariance: the aggregation is a fold over a set of
          // facts, not a vote whose outcome depends on the order.
          expect(aggregateVerification([c, b, a])).toBe(expected)
          expect(aggregateVerification([b, a, c])).toBe(expected)
        }
      }
    }
  })

  it('折叠顺序无关：先两项再第三项，结果相同', () => {
    for (const a of ALL) {
      for (const b of ALL) {
        for (const c of ALL) {
          const pairwise = aggregateVerification([a, b])

          expect(aggregateVerification([pairwise, c])).toBe(aggregateVerification([a, b, c]))
        }
      }
    }
  })

  it('多个弱状态无法用数量压过一条更严重状态', () => {
    // Majority voting would return whichever state appears most often; the
    // fixed order returns the most severe one instead.
    expect(
      aggregateVerification(['human_verified', 'human_verified', 'human_verified', 'docs_only']),
    ).toBe('docs_only')
    expect(
      aggregateVerification([
        'docs_and_code_confirmed',
        'docs_and_code_confirmed',
        'code_confirmed',
      ]),
    ).toBe('code_confirmed')
    expect(
      aggregateVerification([
        'human_verified',
        'human_verified',
        'human_verified',
        'inferred',
        'human_verified',
      ]),
    ).toBe('inferred')
  })

  it('只要有一条 conflict，聚合边就必须是 conflict', () => {
    for (const position of [0, 1, 2] as const) {
      const states: Verification[] = ['human_verified', 'human_verified', 'human_verified']
      states[position] = 'conflict'

      expect(aggregateVerification(states)).toBe('conflict')
    }
    expect(
      aggregateVerification([
        'docs_and_code_confirmed',
        'human_verified',
        'conflict',
        'human_verified',
        'code_confirmed',
      ]),
    ).toBe('conflict')
  })

  it('没有 conflict 输入时不会输出 conflict', () => {
    const withoutConflict = ALL.filter((state) => state !== 'conflict')

    for (const a of withoutConflict) {
      for (const b of withoutConflict) {
        expect(aggregateVerification([a, b, 'human_verified'])).not.toBe('conflict')
      }
    }
  })
})

describe('空集合与单元素', () => {
  it('空集合回退到最宽松的 human_verified，而不是最严重的 conflict', () => {
    const empty = aggregateVerification([])

    expect(empty).toBe('human_verified')
    // The fallback must not invent an alarm: nothing was aggregated, so the
    // result is the *least* severe end of the order.
    expect(severityRank(empty)).toBe(Math.max(...ALL.map((state) => severityRank(state))))
    expect(empty).not.toBe('conflict')
  })

  it('单元素聚合返回它自己', () => {
    for (const state of ALL) {
      expect(aggregateVerification([state])).toBe(state)
      expect(aggregateVerification([state, state])).toBe(state)
    }
  })

  it('长列表的聚合等于逐个折叠的结果', () => {
    const longList: Verification[] = [
      'human_verified',
      'docs_and_code_confirmed',
      'human_verified',
      'code_confirmed',
      'docs_only',
      'inferred',
    ]

    expect(aggregateVerification(longList)).toBe('inferred')

    let folded: Verification = 'human_verified'
    for (const state of longList) folded = moreConservative(folded, state)
    expect(aggregateVerification(longList)).toBe(folded)
  })
})
