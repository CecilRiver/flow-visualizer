import type { ProjectedGraph, ProjectedNode } from '@/domain/view-model'

/**
 * Node footprints are constants, never DOM measurements (DESIGN.md 10.1).
 *
 * Measuring rendered nodes would make layout depend on render timing, which
 * produces flicker and a measure → layout → measure loop. Long text is clamped
 * to two lines in CSS instead of growing the node.
 */
export interface NodeSize {
  width: number
  height: number
}

export const NODE_SIZE: Record<'system' | 'external' | 'domain' | 'component', NodeSize> = {
  system: { width: 280, height: 130 },
  external: { width: 220, height: 96 },
  domain: { width: 240, height: 110 },
  component: { width: 240, height: 124 },
}

/** Minimum footprint of an L1 group's own title band; children + padding grow it. */
export const GROUP_MIN_SIZE: NodeSize = { width: 280, height: 64 }

/** Padding ELK leaves inside a hierarchy node, matching `elk.padding` below. */
export const GROUP_PADDING = { top: 48, left: 40, bottom: 40, right: 40 } as const

export function sizeForNode(node: ProjectedNode): NodeSize {
  if (node.scope === 'external') return NODE_SIZE.external
  if (node.level === 0) return NODE_SIZE.system
  if (node.level === 1) return NODE_SIZE.domain
  return NODE_SIZE.component
}

/** Picks the footprint kind used by the CSS custom properties in the nodes. */
export function sizeKindForNode(node: ProjectedNode): keyof typeof NODE_SIZE {
  if (node.scope === 'external') return 'external'
  if (node.level === 0) return 'system'
  if (node.level === 1) return 'domain'
  return 'component'
}

export function nodeSizeById(graph: ProjectedGraph): Map<string, NodeSize> {
  const sizes = new Map<string, NodeSize>()
  for (const node of graph.nodes) sizes.set(node.id, sizeForNode(node))
  // Groups are sized by ELK from their children, but a minimum keeps the title
  // band readable when a domain has a single small child.
  for (const group of graph.groups) sizes.set(group.id, GROUP_MIN_SIZE)
  return sizes
}
