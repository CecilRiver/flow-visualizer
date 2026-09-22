import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import GraphLegend from '@/components/graph/GraphLegend.vue'
import VerificationBadge from '@/components/inspector/VerificationBadge.vue'
import { VERIFICATION_LABEL } from '@/domain/labels'
import { VERIFICATION_VALUES } from '@/app/urlState'
import type { Verification } from '@/domain/model'
import {
  verificationGlyph,
  verificationLegend,
} from '@/styles/semanticTokens'

/**
 * DESIGN.md 19.2: 所有 verification 都有文字标签和非颜色提示.
 *
 * Verification is the claim the whole viewer exists to make honest, so it is
 * never allowed to be a colour alone. Every state must reach the reader as a
 * word *and* as a glyph, in the legend and in the Inspector alike — and the two
 * must be the same glyph, or the legend would be describing a different diagram.
 */
describe('verification presentation', () => {
  it('covers every declared state, with no extra or missing one', () => {
    const legend = verificationLegend()

    expect(legend.map((entry) => entry.verification)).toEqual([...VERIFICATION_VALUES])
  })

  it('gives every state a distinct glyph and a written label', () => {
    const glyphs = new Set<string>()

    for (const verification of VERIFICATION_VALUES) {
      const glyph = verificationGlyph(verification)
      expect(glyph).not.toBe('')
      // A shared glyph would make two states indistinguishable without colour.
      expect(glyphs.has(glyph)).toBe(false)
      glyphs.add(glyph)

      expect(VERIFICATION_LABEL[verification]).not.toBe('')
    }
  })

  it('shows the label and the glyph together in the legend', () => {
    const wrapper = mount(GraphLegend)
    const items = wrapper.findAll('.legend__item')

    for (const verification of VERIFICATION_VALUES) {
      const label = VERIFICATION_LABEL[verification]
      const item = items.find((candidate) => candidate.text().includes(label))
      if (item === undefined) throw new Error(`legend is missing ${verification}`)

      expect(item.find('.legend__glyph').text()).toBe(verificationGlyph(verification))
      // The description is the longer explanation, available on hover.
      expect(item.attributes('title')).toBeTruthy()
    }
  })

  it('repeats the same glyph in the Inspector badge as in the legend', () => {
    for (const verification of VERIFICATION_VALUES) {
      const wrapper = mount(VerificationBadge, {
        props: { verification, label: VERIFICATION_LABEL[verification] },
      })

      expect(wrapper.find('.verification-badge__glyph').text()).toBe(
        verificationGlyph(verification),
      )
      expect(wrapper.text()).toContain(VERIFICATION_LABEL[verification])
    }
  })

  it('paints the badge from the shared token table, not from a local hex value', () => {
    const wrapper = mount(VerificationBadge, {
      props: { verification: 'conflict', label: '冲突' },
    })

    const style = wrapper.attributes('style') ?? ''
    expect(style).toContain('var(--status-conflict)')
    expect(style).toContain('var(--status-conflict-bg)')
    // A hard-coded colour here is exactly the drift the token table prevents.
    expect(style).not.toMatch(/#[0-9a-f]{3,8}/i)
  })

  it('says "unknown" rather than implying a verified state', () => {
    const wrapper = mount(VerificationBadge, { props: { verification: null, label: '未知' } })

    // An unresolved item must not borrow the weakest *known* state's colour and
    // read as a genuine verdict.
    expect(wrapper.find('.verification-badge__glyph').text()).toBe('–')
    expect(wrapper.attributes('style') ?? '').toContain('var(--text-muted)')
  })

  it('keeps the note beside the label, e.g. for an aggregated edge', () => {
    const wrapper = mount(VerificationBadge, {
      props: { verification: 'inferred' as Verification, label: '推断', note: '取最保守状态' },
    })

    expect(wrapper.find('.verification-badge__note').text()).toBe('取最保守状态')
    expect(wrapper.text()).toContain('推断')
  })

  it('puts every flow kind in the legend with a non-colour line pattern', () => {
    const wrapper = mount(GraphLegend)
    const swatches = wrapper.findAll('.legend__swatch')

    // Kinds are drawn as lines; thickness/dash carries the meaning for a reader
    // who cannot separate the hues.
    expect(swatches.length).toBeGreaterThan(0)
    for (const swatch of swatches) {
      const line = swatch.find('line')
      expect(Number(line.attributes('stroke-width'))).toBeGreaterThan(0)
      expect(line.attributes('stroke') ?? '').toContain('var(--flow-')
    }
  })
})
