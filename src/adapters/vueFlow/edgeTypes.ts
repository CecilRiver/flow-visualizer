import type { ElkPoint } from 'elkjs/lib/elk-api'

import type { FlowKind, Verification } from '@/domain/model'
import type { EdgePresentation } from '@/layout/edgePresentation'
import type { PlacedLabel } from '@/layout/labelPlacement'

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

/** One orthogonal piece of a route, as the renderer needs it (8). */
export interface SemanticEdgeSection {
  id: string
  startPoint: ElkPoint
  bendPoints: ElkPoint[]
  endPoint: ElkPoint
  incomingSections: string[]
  outgoingSections: string[]
}

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
  /**
   * The route, one entry per orthogonal section, in absolute coordinates.
   *
   * A list rather than a single polyline. The sections of an edge that crosses
   * a container boundary need not meet, and joining them would draw a straight
   * line between the end of one and the start of the next — a segment the
   * layout never routed, presented as part of the route (8, 12.1). The renderer
   * therefore draws each section as its own subpath.
   *
   * Empty only when the layout produced nothing at all, which is the case
   * `hasRoute` reports and 9.3.2's smooth-step answers.
   */
  sections: SemanticEdgeSection[]
  /**
   * Where the layout decided this edge's label goes, or `null` when the layout
   * placed none (14).
   *
   * The box is in graph coordinates with `x`/`y` at its **top-left**, and it is
   * already wrapped: `lines` is the text as it is meant to be drawn, so the
   * renderer must not let CSS re-wrap it. Re-wrapping in the browser would
   * produce a different number of lines from the one ELK reserved room for, and
   * the drawn box would no longer be the box that was checked for collisions.
   *
   * `visibleByDefault` is only the layout's half of the decision — the zoom
   * bucket can still hide the label (5.3) — so a renderer shows it when both
   * agree.
   */
  labelBox: PlacedLabel | null
  /** True while this edge is part of the current selection neighbourhood. */
  highlighted: boolean
  /** True while another element is selected and this one is not related. */
  dimmed: boolean
}

/**
 * Whether the layout produced a route to draw (9.3).
 *
 * Counts sections, not bend points. A straight orthogonal route comes back as
 * one section with **no** `bendPoints` key at all — the field is absent, not
 * empty — so a predicate reading the bend points would call a perfectly good
 * straight route unrouted and fall back to Vue Flow's own endpoints, which are
 * a different geometry from the one the layout computed. That is exactly the
 * disagreement this pass exists to remove, and it would have survived in the
 * one case that looks least like a bug.
 *
 * When this is false there is no route in the layout at all, and Vue Flow's
 * smooth-step is the last resort (9.3.2).
 */
export function hasRoute(data: SemanticEdgeData): boolean {
  return data.sections.length > 0
}
