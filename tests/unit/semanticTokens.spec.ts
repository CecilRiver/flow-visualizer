import { beforeEach, describe, expect, it } from 'vitest'

import { VERIFICATION_VALUES } from '@/app/urlState'
import type { FlowKind } from '@/domain/model'
import {
  NODE_SURFACE,
  cssVar,
  edgeStroke,
  flowKindColor,
  flowKindLegend,
  installSemanticTokens,
  scopeLegend,
  semanticTokenEntries,
  verificationColor,
  verificationLegend,
  verificationTokenName,
  verificationTokenNameOf,
} from '@/styles/semanticTokens'

/**
 * The palette has two halves that must agree: the custom properties
 * `installSemanticTokens()` writes onto the document root, and the `var()`
 * references the legend, the node renderers, the edges and the Inspector build
 * from the same table (DESIGN.md 15.2, 16.1).
 *
 * A reference to a property nothing defines is not a visible error — the
 * declaration simply becomes invalid and the element falls back to its inherited
 * colour. That is why this is asserted by name rather than by eye: `var(--x)`
 * and `var(--x)` have to be the same `--x`, exactly once each.
 *
 * `tokens.css` deliberately declares none of these, so a mismatch here means an
 * element that silently draws with no colour at all.
 */
function declaredOn(element: HTMLElement, reference: string): string {
  // 'var(--status-conflict)' -> '--status-conflict'
  const name = /^var\((--[^)]+)\)$/.exec(reference)?.[1]
  if (name === undefined) throw new Error(`not a plain var() reference: ${reference}`)
  return element.style.getPropertyValue(name)
}

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  installSemanticTokens(root)
})

describe('semantic tokens', () => {
  it('declares every entry it publishes', () => {
    const entries = semanticTokenEntries()

    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(root.style.getPropertyValue(entry.name), entry.name).toBe(entry.value)
    }
  })

  it('declares each name exactly once, with a single `--` prefix', () => {
    const names = semanticTokenEntries().map((entry) => entry.name)

    expect(new Set(names).size).toBe(names.length)
    for (const name of names) {
      expect(name.startsWith('--')).toBe(true)
      expect(name.startsWith('----')).toBe(false)
    }
  })

  it('reads back every verification colour it installs', () => {
    for (const verification of VERIFICATION_VALUES) {
      // Both spellings are used in the codebase: the raw variable name for
      // scoped CSS bindings, and `cssVar()` for inline styles.
      expect(declaredOn(root, verificationColor(verification))).not.toBe('')
      expect(declaredOn(root, `var(${verificationTokenName(verification)})`)).not.toBe('')
      expect(
        declaredOn(root, `var(${verificationTokenName(verification)}-bg)`),
      ).not.toBe('')
    }
  })

  it('reads back every flow-kind colour on an edge, including the feedback override', () => {
    const kinds: FlowKind[] = [
      'command',
      'measurement',
      'state',
      'event',
      'control',
      'actuation',
      'feedback',
    ]

    for (const kind of kinds) {
      expect(declaredOn(root, flowKindColor(kind)), kind).not.toBe('')
      expect(declaredOn(root, edgeStroke(kind, false).color), kind).not.toBe('')
      // `feedback: true` on any kind is drawn as a feedback edge.
      expect(declaredOn(root, edgeStroke(kind, true).color), kind).not.toBe('')
    }
  })

  it('reads back every legend and node-surface colour', () => {
    for (const entry of verificationLegend()) {
      expect(declaredOn(root, entry.color), entry.verification).not.toBe('')
      expect(declaredOn(root, entry.surface), entry.verification).not.toBe('')
    }
    for (const entry of flowKindLegend()) {
      expect(declaredOn(root, entry.color), entry.kind).not.toBe('')
    }
    for (const entry of scopeLegend()) {
      expect(declaredOn(root, entry.color), entry.scope).not.toBe('')
      expect(declaredOn(root, entry.surface), entry.scope).not.toBe('')
    }
    for (const reference of Object.values(NODE_SURFACE)) {
      expect(declaredOn(root, reference)).not.toBe('')
    }
  })

  it('renders every glyph without repeating one across states', () => {
    const glyphs = verificationLegend().map((entry) => entry.glyph)

    expect(new Set(glyphs).size).toBe(VERIFICATION_VALUES.length)
  })

  it('falls back to the weakest state for an unknown value instead of colouring it verified', () => {
    // The minimap reads its value out of node data, which may be a bare string.
    expect(verificationTokenNameOf('not-a-state')).toBe(verificationTokenName('inferred'))
    expect(verificationTokenNameOf('conflict')).toBe(verificationTokenName('conflict'))
    expect(declaredOn(root, `var(${verificationTokenNameOf('not-a-state')})`)).not.toBe('')
  })

  it('accepts a bare name as well as a prefixed one', () => {
    expect(cssVar('--status-conflict')).toBe('var(--status-conflict)')
    expect(cssVar('status-conflict')).toBe('var(--status-conflict)')
  })
})
