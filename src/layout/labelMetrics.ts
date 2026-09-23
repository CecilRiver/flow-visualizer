import { GRAPH_READABILITY } from './readabilityOptions'

/**
 * Deterministic edge-label measurement (GRAPH_READABILITY_DESIGN.md 6.2).
 *
 * ELK routes around a label only if it is told how big that label is, and it
 * has to be told before anything is drawn — so the size cannot come from the
 * DOM, and it cannot come from canvas text metrics either (that would need a
 * canvas, a font that has finished loading, and a browser to run in). What
 * replaces both is a character-class width table: the same answer on every
 * machine, at any moment, with no rendering involved.
 *
 * The same call that produces the box also produces the lines the renderer
 * shows. That is the point of doing both here rather than letting CSS wrap:
 * a browser that broke a line somewhere else would draw outside the box ELK
 * left for it, and the layout would be describing a label that does not exist.
 */

const LABEL = GRAPH_READABILITY.label

/** Width of one character, as a fraction of the font size. */
const SPACE_RATIO = 0.33
const LATIN_RATIO = 0.58
const WIDE_RATIO = 1
const PUNCTUATION_RATIO = 0.5

/** The label box's own 1px border, per side. */
const BORDER = 1

/**
 * Slack added to every box.
 *
 * The table above is an estimate, and an estimate that comes out one pixel
 * short would hand back a box narrower than the text inside it — the exact
 * defect the layout work exists to remove. The margin is deliberately larger
 * than any per-character error can accumulate to.
 */
const SLACK = 8

/**
 * Code point ranges drawn at full width.
 *
 * Han, Hangul, Kana and the fullwidth forms: these are the scripts where one
 * character fills an em. Everything outside them is measured as Latin or
 * punctuation, both of which are wider than the truth for a script this table
 * has never seen — erring wide is the safe direction.
 */
function isWideCodePoint(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0x303e) || // CJK radicals, Kangxi, punctuation
    (code >= 0x3041 && code <= 0x33ff) || // Kana, CJK compatibility
    (code >= 0x3400 && code <= 0x4dbf) || // CJK extension A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK unified ideographs
    (code >= 0xa000 && code <= 0xa4cf) || // Yi
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
    (code >= 0xfe30 && code <= 0xfe4f) || // CJK compatibility forms
    (code >= 0xff00 && code <= 0xff60) || // Fullwidth forms
    (code >= 0xffe0 && code <= 0xffe6)
  )
}

function isLatinCodePoint(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) || // 0-9
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) // a-z
  )
}

/** One character's advance width at `fontSize`. */
function charWidth(char: string, fontSize: number): number {
  const code = char.codePointAt(0) ?? 0
  if (char === ' ' || char === '\t') return SPACE_RATIO * fontSize
  if (isWideCodePoint(code)) return WIDE_RATIO * fontSize
  if (isLatinCodePoint(code)) return LATIN_RATIO * fontSize
  return PUNCTUATION_RATIO * fontSize
}

/** The width `text` occupies on one line. Exported so placement can reuse it. */
export function textWidth(text: string, fontSize: number): number {
  let total = 0
  for (const char of text) total += charWidth(char, fontSize)
  return total
}

interface Wrapped {
  lines: string[]
  truncated: boolean
}

/**
 * Greedy line breaking, stopping after `maxLines`.
 *
 * Greedy rather than optimal because the answer has to be reproducible from the
 * text alone: an optimal-break algorithm is free to change its mind when
 * unrelated code changes, and the layout is cached against this result.
 *
 * Each line takes as much as fits, then backs up to the last space if there was
 * one. That keeps a Latin word whole, which is what the browser did before this
 * function existed; a wide script has no spaces to back up to and breaks
 * between any two characters, which is also what it needs.
 */
function wrap(text: string, maxTextWidth: number, maxLines: number, fontSize: number): Wrapped {
  const chars = [...text]
  const lines: string[] = []
  let start = 0

  while (start < chars.length && lines.length < maxLines) {
    let end = start
    let width = 0
    let lastSpace = -1

    while (end < chars.length) {
      const char = chars[end]
      if (char === undefined) break
      const next = width + charWidth(char, fontSize)
      // `end > start` guarantees progress: a single character wider than the
      // whole line still gets a line of its own instead of looping forever.
      if (next > maxTextWidth && end > start) break
      width = next
      if (char === ' ') lastSpace = end
      end += 1
    }

    if (lastSpace > start && end < chars.length) {
      lines.push(chars.slice(start, lastSpace).join(''))
      start = lastSpace + 1
    } else {
      lines.push(chars.slice(start, end).join(''))
      start = end
    }
  }

  const truncated = start < chars.length
  if (lines.length === 0) lines.push('')
  return { lines, truncated }
}

export interface MeasureEdgeLabelInput {
  /** The compact text the label draws, before wrapping. */
  text: string
  /** The verification mark drawn beside it, or `''` when there is none. */
  mark: string
  /** How many lines the text may occupy before it is elided. */
  maxLines: 1 | 2
}

export interface EdgeLabelMetrics {
  /** Box width the layout must reserve. Always greater than zero. */
  width: number
  /** Box height the layout must reserve. Always greater than zero. */
  height: number
  /** The text already broken to fit — the renderer draws these, not the source. */
  lines: readonly string[]
  /** True when `lines` ends the text early, so the renderer adds an ellipsis. */
  truncated: boolean
}

/**
 * Measures and breaks one edge label.
 *
 * The mark is measured as part of the box rather than placed freely beside it:
 * ELK is reserving room for the whole box, and a mark that stuck out of it
 * would overlap whatever sits to the right.
 */
export function measureEdgeLabel(input: MeasureEdgeLabelInput): EdgeLabelMetrics {
  const maxWidth = input.maxLines === 2 ? LABEL.detailMaxWidth : LABEL.compactMaxWidth
  const markBlock =
    input.mark === '' ? 0 : LABEL.iconGap + BORDER + LABEL.iconGap + textWidth(input.mark, LABEL.fontSize)

  const innerWidth = maxWidth - 2 * LABEL.horizontalPadding - 2 * BORDER - markBlock
  const wrapped = wrap(input.text, Math.max(innerWidth, LABEL.fontSize), input.maxLines, LABEL.fontSize)

  const widest = wrapped.lines.reduce(
    (max, line) => Math.max(max, textWidth(line, LABEL.fontSize)),
    0,
  )

  return {
    width: Math.ceil(2 * BORDER + 2 * LABEL.horizontalPadding + widest + markBlock + SLACK),
    height: Math.ceil(
      2 * BORDER + 2 * LABEL.verticalPadding + wrapped.lines.length * LABEL.lineHeight + SLACK,
    ),
    lines: wrapped.lines,
    truncated: wrapped.truncated,
  }
}
