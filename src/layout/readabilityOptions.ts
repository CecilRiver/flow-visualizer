/**
 * Every number the readability work depends on, in one place
 * (GRAPH_READABILITY_DESIGN.md 6.1).
 *
 * These are deliberately not CSS custom properties. The label geometry is
 * decided during layout, before anything is rendered, so the same numbers have
 * to be readable from plain TypeScript — a value that only existed in a
 * stylesheet could not size an ELK label box. Components that draw a label take
 * the values from here and bind them, rather than restating them in a scoped
 * style block where they could drift.
 */

export const GRAPH_READABILITY = {
  label: {
    /** Longest a single-line L0/L1 label may be before it is elided. */
    compactMaxWidth: 112,
    /** Longest a line of an L2 flow-name label may be. */
    detailMaxWidth: 176,
    /** Horizontal padding inside the label box, both sides together. */
    horizontalPadding: 8,
    /** Vertical padding inside the label box, top and bottom together. */
    verticalPadding: 3,
    /** Space between the verification mark and the text that follows it. */
    iconGap: 4,
    fontSize: 11,
    lineHeight: 16,
    /** Two lines is the most a flow name may occupy before it is elided. */
    maxLines: 2,
    /** Minimum clearance between two label boxes. */
    collisionGap: 6,
    /** Minimum clearance between a label box and a node it does not belong to. */
    nodeGap: 12,
  },
  feedback: {
    /** Distance from the lowest drawn shape to the first feedback lane. */
    baseGap: 48,
    /** Distance between two feedback lanes. */
    laneGap: 30,
  },
  viewport: {
    topPadding: 40,
    rightPadding: 64,
    bottomPadding: 64,
    leftPadding: 40,
  },
} as const

/**
 * When inline edge labels are drawn (GRAPH_READABILITY_DESIGN.md 5.3).
 *
 * `hiddenBelow` and `normalFrom` are the same zoom on purpose: one reads as the
 * end of the hidden band and the other as the start of the normal band, and the
 * two bands meet exactly there. They are written separately because the band
 * boundaries are easier to check against the document this way, but they must
 * stay equal — a gap would leave a zoom level in neither band.
 */
export const EDGE_LABEL_ZOOM = {
  hiddenBelow: 0.55,
  normalFrom: 0.55,
  detailFrom: 0.85,
} as const

/** Which band the current zoom falls in. */
export type ZoomBucket = 'hidden' | 'normal' | 'detail'

/**
 * Classifies a zoom factor.
 *
 * A zoom of exactly `0.55` is `normal`, not `hidden`: the document's hidden
 * band is written as strictly below the threshold.
 */
export function zoomBucket(zoom: number): ZoomBucket {
  if (zoom < EDGE_LABEL_ZOOM.hiddenBelow) return 'hidden'
  if (zoom < EDGE_LABEL_ZOOM.detailFrom) return 'normal'
  return 'detail'
}
