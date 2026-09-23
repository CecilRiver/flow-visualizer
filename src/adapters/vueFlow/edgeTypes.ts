import type { ElkPoint } from 'elkjs/lib/elk-api'

import type { FlowKind, Verification } from '@/domain/model'
import type { EdgePresentation } from '@/layout/edgePresentation'

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
  /**
   * The projection's own semantic label, unchanged.
   *
   * What the canvas draws is `presentation.compactText`; this stays because the
   * Inspector and the tooltip still quote it verbatim (13.1).
   */
  label: string
  /** What the canvas draws and announces, derived in `edgePresentation` (5.1). */
  presentation: EdgePresentation
  /**
   * The most conservative verification state on the edge.
   *
   * The renderer needs the state itself, not just its wording, to pick the
   * colour token for the compact mark (5.2).
   */
  verification: Verification
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
