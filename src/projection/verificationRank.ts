import type { Verification } from '@/domain/model'

/**
 * Fixed severity order used when aggregating verification states
 * (DESIGN.md 9.5). Lower rank wins: a single `conflict` underneath forces the
 * aggregate edge to read as conflicted, and no amount of majority voting can
 * promote a state.
 */
const SEVERITY_RANK: Record<Verification, number> = {
  conflict: 0,
  inferred: 1,
  docs_only: 2,
  code_confirmed: 3,
  docs_and_code_confirmed: 4,
  human_verified: 5,
}

/** Same order as `SEVERITY_RANK`, most severe first. */
export const VERIFICATION_SEVERITY_ORDER: readonly Verification[] = [
  'conflict',
  'inferred',
  'docs_only',
  'code_confirmed',
  'docs_and_code_confirmed',
  'human_verified',
]

/** Returns whichever of the two states is more conservative. */
export function moreConservative(a: Verification, b: Verification): Verification {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b
}

/** Folds a list of states into the most conservative one. `human_verified` when empty. */
export function aggregateVerification(states: readonly Verification[]): Verification {
  let result: Verification = 'human_verified'
  for (const state of states) {
    result = moreConservative(result, state)
  }
  return result
}

export function severityRank(state: Verification): number {
  return SEVERITY_RANK[state]
}
