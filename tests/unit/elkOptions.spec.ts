import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

import { betweenLayersFor, groupLayoutOptions, rootLayoutOptions } from '@/layout/elkOptions'

/**
 * Every ELK option name this project passes has to be one ELK knows
 * (GRAPH_READABILITY_DESIGN.md 10.2).
 *
 * The reason this needs a test at all is that the compiler cannot help. In the
 * locked elkjs typings `LayoutOptions` is `Record<string, string>`, so the
 * *value* is checked and the *key* is not: `'elk.spacing.edgeLable': '8'` (note
 * the spelling) type-checks, ships, and is silently dropped by ELK. The failure
 * that produces is the worst kind — a layout change that looks applied and is
 * not, with a green build.
 *
 * ## What this checks, and what it does not
 *
 * This is a **spelling check**, not a registration check. It confirms each name
 * appears verbatim in the ELK bundle, so a typo or an invented option fails.
 * It cannot confirm that ELK would honour the option in this algorithm, or that
 * the value is one of the accepted enum members.
 *
 * That limit is not a choice. `elk.knownLayoutOptions()` — the API that would
 * answer properly — resolves to an **empty array** in the bundled build, so
 * there is nothing to enumerate against:
 *
 *     > await new ELK().knownLayoutOptions()
 *     []
 *
 * Checking against the bundle text is therefore the strongest check available
 * without loading a second copy of ELK into the test process, and it is enough
 * to catch the mistake this file exists for.
 */

/**
 * The bundle is read as text rather than imported.
 *
 * Importing it would construct a second ELK instance and run its initialisation
 * in the test process, for a question that is about which strings are present.
 * The file is ~1.4 MB and the read is a few milliseconds.
 *
 * The path is resolved through Node's own resolver rather than assembled from
 * `__dirname`, so it is guaranteed to be the same file the application imports —
 * if the dependency's layout ever moves, this test fails loudly instead of
 * quietly reading a stale copy that still contains the old strings.
 */
const BUNDLE_PATH = createRequire(import.meta.url).resolve('elkjs/lib/elk.bundled.js')

const BUNDLE = readFileSync(BUNDLE_PATH, 'utf8')

/** A width well above the clamp, so every option path is exercised. */
const WIDE = 400

function keysOf(options: Record<string, string>): string[] {
  return Object.keys(options)
}

describe('ELK option 名字必须在 bundle 里真实存在', () => {
  it('根图的每个 key 都能在 elk.bundled.js 里找到', () => {
    const keys = keysOf(rootLayoutOptions(WIDE))
    expect(keys.length).toBeGreaterThan(0)

    const missing = keys.filter((key) => !BUNDLE.includes(key))
    expect(missing, 'rootLayoutOptions 里有 ELK 不认识的选项名').toEqual([])
  })

  it('容器的每个 key 都能在 elk.bundled.js 里找到', () => {
    const missing = keysOf(groupLayoutOptions(WIDE)).filter((key) => !BUNDLE.includes(key))
    expect(missing, 'groupLayoutOptions 里有 ELK 不认识的选项名').toEqual([])
  })

  it('枚举值也必须存在，否则同样被静默忽略', () => {
    // A misspelled enum is dropped exactly like a misspelled key, so the values
    // need the same treatment as the names.
    const options = rootLayoutOptions(WIDE)
    const values = [
      options['elk.algorithm'],
      options['elk.direction'],
      options['elk.edgeRouting'],
      options['elk.layered.cycleBreaking.strategy'],
      options['elk.layered.crossingMinimization.strategy'],
      options['elk.layered.edgeLabels.centerLabelPlacementStrategy'],
      options['elk.hierarchyHandling'],
    ].filter((value): value is string => value !== undefined)

    expect(values.length).toBeGreaterThan(0)
    const missing = values.filter((value) => !BUNDLE.includes(value))
    expect(missing, 'ELK 不认识的枚举值').toEqual([])
  })

  it('两套选项都覆盖了标签间距与层间距', () => {
    // The label spacing is the whole point of the pass: without it ELK routes
    // as if no label existed, which is the defect the design document opens
    // with. A refactor that dropped it would otherwise be invisible.
    for (const options of [rootLayoutOptions(WIDE), groupLayoutOptions(WIDE)]) {
      expect(options['elk.spacing.edgeLabel']).toBeDefined()
      expect(options['elk.spacing.labelLabel']).toBeDefined()
      expect(options['elk.spacing.labelNode']).toBeDefined()
      expect(options['elk.layered.spacing.nodeNodeBetweenLayers']).toBeDefined()
    }
  })
})

describe('betweenLayersFor', () => {
  it('窄标签用下限，宽标签用上限', () => {
    expect(betweenLayersFor(0)).toBe(160)
    expect(betweenLayersFor(10_000)).toBe(240)
  })

  it('中间宽度按标签宽度加余量，且单调不减', () => {
    // 112 is where the floor stops winning: below it `min` clamps, above it the
    // label's own width drives the gap.
    const widths = [0, 40, 111, 120, 160, 200, 300]
    const gaps = widths.map(betweenLayersFor)

    expect(betweenLayersFor(111)).toBe(160)
    expect(betweenLayersFor(120)).toBe(120 + 48)
    for (let index = 1; index < gaps.length; index += 1) {
      const previous = gaps[index - 1]
      const current = gaps[index]
      if (previous === undefined || current === undefined) continue
      expect(current).toBeGreaterThanOrEqual(previous)
    }
  })

  it('间隙一定大于标签本身，标签才不会压到下一层的节点上', () => {
    // The relation, not the number: a gap narrower than the label it was sized
    // for puts the label back on top of the following layer's node, which is
    // the defect being fixed.
    for (const width of [0, 50, 100, 150]) {
      expect(betweenLayersFor(width)).toBeGreaterThan(width)
    }
  })
})
