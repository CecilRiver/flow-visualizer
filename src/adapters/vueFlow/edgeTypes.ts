import type { ElkPoint } from 'elkjs/lib/elk-api'

import type { FlowKind } from '@/domain/model'

/**
 * Edge type names and the data the semantic edge renderer needs.
 *
 * There is exactly one custom edge type. Rendering is driven by the fields
 * below, never by a configuration-supplied component name (DESIGN.md 17.2).
 */
export const EDGE_TYPE = {
  semantic: 'semantic',
} as const

export type EdgeTypeName = (typeof EDGE_TYPE)[keyof typeof EDGE_TYPE]

export interface SemanticEdgeData {
  id: string
  kind: FlowKind
  label: string
  feedback: boolean
  verificationLabel: string
  verificationShortLabel: string
  /** Number of raw flows aggregated into this edge. */
  flowCount: number
  /** Orthogonal route from ELK, absolute coordinates. Empty on fallback. */
  bendPoints: ElkPoint[]
  startPoint: ElkPoint | null
  endPoint: ElkPoint | null
  /** True while this edge is part of the current selection neighbourhood. */
  highlighted: boolean
  /** True while another element is selected and this one is not related. */
  dimmed: boolean
}

/** Vue Flow's own routing is used when ELK produced no route (10.5). */
export function hasRoute(data: SemanticEdgeData): boolean {
  return data.bendPoints.length > 0
}
