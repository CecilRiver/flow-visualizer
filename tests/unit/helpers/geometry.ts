import { expect } from 'vitest'

/**
 * Axis-aligned box geometry for layout assertions.
 *
 * The same four-comparison overlap test had been copied into three specs
 * (`layout.spec.ts` twice, `realModel.spec.ts` once). Copy three is where a
 * rewrite of the predicate goes into two of them, so it lives here instead.
 *
 * `Box` is structural on purpose: laid-out nodes, groups, layout bounds and the
 * label rectangles the readability work adds all satisfy it without adapting.
 */
export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A box that knows which thing it is. */
export interface IdentifiedBox extends Box {
  readonly id: string
}

/**
 * Whether two boxes share any area.
 *
 * Edges that merely touch do not overlap: the comparisons are strict, so two
 * boxes flush against each other at `x = 10` and `x = 10` are disjoint. That is
 * the intended reading — a layout that packs boxes shoulder to shoulder is
 * correct, and a non-strict test would call it a defect.
 */
export function intersects(first: Box, second: Box): boolean {
  return (
    first.x < second.x + second.width &&
    second.x < first.x + first.width &&
    first.y < second.y + second.height &&
    second.y < first.y + first.height
  )
}

/** A pair of boxes found to share area, in the order they were given. */
export type BoxPair<T> = readonly [T, T]

/** Options for {@link overlappingPairs}. */
export interface OverlapOptions<T> {
  /**
   * Pairs that are allowed to overlap because one contains the other.
   *
   * A group box is drawn around its children and shares their area by design, so
   * a parent/child pair is not a defect and must not be reported as one.
   */
  readonly mayNest?: (first: T, second: T) => boolean
}

/** Every pair of boxes that share area, most useful first is not attempted here. */
export function overlappingPairs<T extends IdentifiedBox>(
  boxes: readonly T[],
  options: OverlapOptions<T> = {},
): BoxPair<T>[] {
  const pairs: BoxPair<T>[] = []
  const mayNest = options.mayNest

  for (let a = 0; a < boxes.length; a += 1) {
    for (let b = a + 1; b < boxes.length; b += 1) {
      const first = boxes[a]
      const second = boxes[b]
      if (first === undefined || second === undefined) continue
      if (mayNest?.(first, second) === true) continue
      if (intersects(first, second)) pairs.push([first, second])
    }
  }

  return pairs
}

/** The overlapping pairs as `id × id`, for a failure message. */
export function describePairs<T extends IdentifiedBox>(pairs: readonly BoxPair<T>[]): string[] {
  return pairs.map(([first, second]) => `${first.id} × ${second.id}`)
}

/**
 * Asserts that no two boxes in `boxes` share area.
 *
 * `label` names the projection under test, because a bare `id × id` pair is
 * ambiguous once the same assertion runs over L0, L1 and L2 in a loop.
 */
export function expectNoOverlaps<T extends IdentifiedBox>(
  boxes: readonly T[],
  label: string,
  options: OverlapOptions<T> = {},
): void {
  expect(describePairs(overlappingPairs(boxes, options)), `${label} 存在重叠`).toEqual([])
}
