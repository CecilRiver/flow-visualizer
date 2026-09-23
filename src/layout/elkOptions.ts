import type { LayoutOptions } from 'elkjs/lib/elk-api'

/**
 * ELK option constants (DESIGN.md 10.2).
 *
 * `LayoutOptions` is a `Record<string, string>` in the locked elkjs typings, so
 * the compiler checks the values and *not* the keys: a misspelled option is
 * accepted here and then silently ignored by ELK, which is the worst possible
 * combination — a layout change that looks applied and is not.
 * `tests/unit/elkOptions.spec.ts` therefore checks every key against the strings
 * present in the ELK bundle.
 *
 * That check is a spelling check, not a registration check, and it is the
 * strongest one available: at runtime `elk.knownLayoutOptions()` returns an
 * empty object in the bundled build, so there is nothing to enumerate.
 */

/**
 * Clearance ELK keeps around a label box it was told about.
 *
 * These matter even though the final label position is decided later by
 * `placeEdgeLabels`: they are what makes ELK's *node* placement leave room for
 * the labels, which is the root cause the readability work is about. ELK was
 * previously routing as if no label existed.
 */
const LABEL_SPACING: LayoutOptions = {
  'elk.spacing.edgeLabel': '8',
  'elk.spacing.labelLabel': '6',
  'elk.spacing.labelNode': '12',
}

/**
 * Where ELK would put a label along its edge.
 *
 * The position itself is discarded — `labelPlacement` computes the real one —
 * but the strategy still feeds ELK's spacing arithmetic, and the median of the
 * layer is the choice that keeps the widest layer from being widened twice.
 */
const LABEL_PLACEMENT: LayoutOptions = {
  'elk.layered.edgeLabels.centerLabelPlacementStrategy': 'MEDIAN_LAYER',
}

const BETWEEN_LAYERS = {
  /** Below this the graph stops reading left to right. */
  min: 160,
  /** Above this the drawing is mostly empty channel. */
  max: 240,
  /** Room a label needs beside the line, on top of its own width. */
  slack: 48,
} as const

/**
 * The layer gap a given label width calls for (DESIGN.md 10.2).
 *
 * Fixed at 100px it was narrower than many flow names, which is why a label
 * landed on the node in the next layer: ELK had no reason to leave more room.
 */
export function betweenLayersFor(maxLabelWidth: number): number {
  return Math.min(
    BETWEEN_LAYERS.max,
    Math.max(BETWEEN_LAYERS.min, maxLabelWidth + BETWEEN_LAYERS.slack),
  )
}

/**
 * Routes edges that cross a container boundary.
 *
 * Without this, an edge declared between two nodes that live in different
 * hierarchy nodes comes back with **no sections at all** — measured on the L2
 * fixture, three of five edges were unrouted, and those were exactly the three
 * that cross a domain boundary. The renderer then draws them as a straight line
 * between the two node centres, cutting through whatever is in between, and
 * `placeEdgeLabels` has no route to anchor a label to, so those edges never get
 * one.
 *
 * The default is `SEPARATE_CHILDREN`, which lays each container out on its own
 * and leaves the edge between them to nobody. The name and the enum are both
 * checked against the bundle by `elkOptions.spec.ts`.
 */
const HIERARCHY: LayoutOptions = {
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
}

/** Shared by the root graph and by containers, so a nested edge gets the same treatment. */
function baseOptions(maxLabelWidth: number): LayoutOptions {
  return {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.edgeRouting': 'ORTHOGONAL',
    ...HIERARCHY,
    'elk.layered.spacing.nodeNodeBetweenLayers': String(betweenLayersFor(maxLabelWidth)),
    ...LABEL_SPACING,
    ...LABEL_PLACEMENT,
    // ELK does not inherit options into hierarchy children, so containers carry
    // their own copy of the subset that matters.
    'elk.randomSeed': '1',
    'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  }
}

/** Root graph: layered layout flowing left to right, orthogonal edge routing. */
export function rootLayoutOptions(maxLabelWidth: number): LayoutOptions {
  return {
    ...baseOptions(maxLabelWidth),
    'elk.spacing.nodeNode': '48',
    // Room for the group title band and for edges that hug the container.
    'elk.padding': '[top=48,left=40,bottom=40,right=40]',
    // Keeps the drawing close to a normal screen aspect so the initial fit
    // stays readable instead of zooming out to a hairline.
    'elk.aspectRatio': '1.6',
  }
}

/** Hierarchy containers for L2 domain groups. */
export function groupLayoutOptions(maxLabelWidth: number): LayoutOptions {
  return {
    ...baseOptions(maxLabelWidth),
    'elk.spacing.nodeNode': '32',
    'elk.padding': '[top=48,left=40,bottom=40,right=40]',
  }
}
