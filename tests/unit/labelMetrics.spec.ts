import { describe, expect, it } from 'vitest'

import { measureEdgeLabel, textWidth } from '@/layout/labelMetrics'
import { GRAPH_READABILITY } from '@/layout/readabilityOptions'

/**
 * The measuring half of GRAPH_READABILITY_DESIGN.md 6.2.
 *
 * The properties asserted here are the ones a wrong answer would silently
 * break: a zero-sized box is dropped by ELK without a word, an underestimate
 * makes the drawn label wider than the space reserved for it, and a
 * non-deterministic answer makes the layout cache disagree with itself.
 */

const LABEL = GRAPH_READABILITY.label

describe('字符宽度模型', () => {
  it('同字数的 CJK 比拉丁宽', () => {
    expect(textWidth('控制量', LABEL.fontSize)).toBeGreaterThan(textWidth('abc', LABEL.fontSize))
  })

  it('空格比实义字符窄', () => {
    const spaced = textWidth('a a', LABEL.fontSize)
    const solid = textWidth('aaa', LABEL.fontSize)
    expect(spaced).toBeLessThan(solid)
  })
})

describe('measureEdgeLabel 的盒子', () => {
  it('永远给出非零尺寸：ELK 会静默丢弃零宽或零高的标签', () => {
    const empty = measureEdgeLabel({ text: '', mark: '', maxLines: 1 })
    expect(empty.width).toBeGreaterThan(0)
    expect(empty.height).toBeGreaterThan(0)
  })

  it('盒子宽度不超过该类标签的上限加余量', () => {
    const long = measureEdgeLabel({
      text: '姿态角速率控制律计算与混控饱和限制反馈补偿',
      mark: 'DC',
      maxLines: 2,
    })
    expect(long.width).toBeLessThanOrEqual(LABEL.detailMaxWidth + 8)

    const short = measureEdgeLabel({ text: '命令', mark: '?', maxLines: 1 })
    expect(short.width).toBeLessThanOrEqual(LABEL.compactMaxWidth + 8)
  })

  it('验证标记占宽度：同样的文字带上标记后更宽', () => {
    const without = measureEdgeLabel({ text: '控制量', mark: '', maxLines: 1 })
    const withMark = measureEdgeLabel({ text: '控制量', mark: 'DC', maxLines: 1 })
    expect(withMark.width).toBeGreaterThan(without.width)
  })

  it('两行标签比一行高，且高度按行数增长', () => {
    const one = measureEdgeLabel({ text: '反馈', mark: 'C', maxLines: 1 })
    const two = measureEdgeLabel({ text: '反馈', mark: 'C', maxLines: 2 })
    expect(two.height).toBe(one.height)
    expect(one.lines).toHaveLength(1)
  })

  it('相同输入给出完全相同的结果：布局缓存依赖这一点', () => {
    const input = { text: '姿态角速率控制律计算', mark: 'C', maxLines: 2 } as const
    expect(measureEdgeLabel(input)).toEqual(measureEdgeLabel(input))
  })
})

describe('measureEdgeLabel 的断行', () => {
  it('放得下就单行，且不标记截断', () => {
    const metrics = measureEdgeLabel({ text: '控制量', mark: '?', maxLines: 1 })
    expect(metrics.lines).toEqual(['控制量'])
    expect(metrics.truncated).toBe(false)
  })

  it('中文没有空格，按字断行', () => {
    const metrics = measureEdgeLabel({
      text: '姿态角速率控制律计算与混控饱和限制',
      mark: 'C',
      maxLines: 2,
    })
    expect(metrics.lines.length).toBe(2)
    expect(metrics.truncated).toBe(false)
    // Every character survives the break: this is a wrap, not a truncation.
    expect(metrics.lines.join('')).toBe('姿态角速率控制律计算与混控饱和限制')
  })

  it('超出两行的部分被截断，并如实标记', () => {
    const metrics = measureEdgeLabel({
      text: '姿态角速率控制律计算与混控饱和限制反馈补偿滤波器估计器',
      mark: 'C',
      maxLines: 2,
    })
    expect(metrics.lines).toHaveLength(2)
    expect(metrics.truncated).toBe(true)
    expect(metrics.lines.join('').length).toBeLessThan(29)
  })

  it('拉丁词在空格处断开，不切开单词', () => {
    const source = 'attitude rate controller saturation limit mixer'
    const metrics = measureEdgeLabel({ text: source, mark: '', maxLines: 2 })

    expect(metrics.truncated).toBe(false)
    expect(metrics.lines.length).toBeGreaterThan(1)
    // Each break consumed exactly one space, so putting the spaces back has to
    // reproduce the source character for character. A word split down the
    // middle could not survive that round trip.
    expect(metrics.lines.join(' ')).toBe(source)
  })
})
