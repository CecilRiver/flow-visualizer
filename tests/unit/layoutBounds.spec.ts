import { describe, expect, it } from 'vitest'

import { BOUNDS_MARGIN, layoutBounds, shapeBounds, unionBox } from '@/layout/layoutBounds'

/**
 * GRAPH_READABILITY_DESIGN.md 11: the first fit has to cover the labels too.
 *
 * ELK's own width and height describe the shapes it placed. The labels are HTML
 * outside the SVG, so a fit driven by ELK's extent leaves them hanging off the
 * canvas — the defect the design document opens with. These cases pin the
 * extent that replaces it.
 */

describe('shapeBounds', () => {
  it('取节点盒的紧包围盒', () => {
    const box = shapeBounds([
      { x: 0, y: 0, width: 100, height: 50 },
      { x: 300, y: 80, width: 100, height: 50 },
    ])
    expect(box).toEqual({ x: 0, y: 0, width: 400, height: 130 })
  })

  it('把路径点算进去：路线可能伸出节点之外', () => {
    const nodes = [{ x: 0, y: 0, width: 100, height: 50 }]
    const withoutPath = shapeBounds(nodes)
    const withPath = shapeBounds(nodes, [[{ x: 200, y: 300 }]])
    expect(withPath.width).toBeGreaterThan(withoutPath.width)
    expect(withPath.height).toBeGreaterThan(withoutPath.height)
  })

  it('空输入给出零盒而不是 NaN', () => {
    expect(shapeBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('unionBox', () => {
  it('是对称的', () => {
    const first = { x: 0, y: 0, width: 10, height: 10 }
    const second = { x: 20, y: 5, width: 10, height: 10 }
    expect(unionBox(first, second)).toEqual(unionBox(second, first))
  })

  it('包含两个盒', () => {
    const union = unionBox({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 5, width: 10, height: 10 })
    expect(union).toEqual({ x: 0, y: 0, width: 30, height: 15 })
  })
})

describe('layoutBounds', () => {
  it('把标签并进来：标签在右下方时边界随之扩大', () => {
    const shape = { x: 0, y: 0, width: 100, height: 100 }
    const withLabel = layoutBounds(shape, [{ x: 100, y: 100, width: 60, height: 30 }])
    const withoutLabel = layoutBounds(shape)
    expect(withLabel.width).toBeGreaterThan(withoutLabel.width)
    expect(withLabel.height).toBeGreaterThan(withoutLabel.height)
  })

  it('留出四周余量，且右下的余量比左上大：小地图压在那里', () => {
    const bounds = layoutBounds({ x: 0, y: 0, width: 100, height: 100 })
    expect(bounds.x).toBe(-BOUNDS_MARGIN.left)
    expect(bounds.y).toBe(-BOUNDS_MARGIN.top)
    expect(bounds.width).toBe(100 + BOUNDS_MARGIN.left + BOUNDS_MARGIN.right)
    expect(bounds.height).toBe(100 + BOUNDS_MARGIN.top + BOUNDS_MARGIN.bottom)
    expect(BOUNDS_MARGIN.right).toBeGreaterThan(BOUNDS_MARGIN.top)
    expect(BOUNDS_MARGIN.bottom).toBeGreaterThan(BOUNDS_MARGIN.top)
  })

  it('没有标签时就是形状本身加余量', () => {
    const shape = { x: 10, y: 20, width: 30, height: 40 }
    expect(layoutBounds(shape, [])).toEqual(layoutBounds(shape))
  })
})
