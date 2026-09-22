import type { LayoutOptions } from 'elkjs/lib/elk-api'

/**
 * ELK option constants (DESIGN.md 10.2).
 *
 * `LayoutOptions` is a `Record<string, string>` in the locked elkjs typings, so
 * every key below is checked against that type instead of being cast through
 * `any`. A misspelled option is silently ignored by ELK, which is exactly the
 * failure mode the cast would hide.
 */

/** Root graph: layered layout flowing left to right, orthogonal edge routing. */
export const ROOT_LAYOUT_OPTIONS: LayoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.spacing.nodeNode': '48',
  'elk.layered.spacing.nodeNodeBetweenLayers': '100',
  // Room for the group title band and for edges that hug the container.
  'elk.padding': '[top=48,left=40,bottom=40,right=40]',
  // ELK does not inherit options into hierarchy children, so containers carry
  // their own copy of the subset that matters.
  'elk.randomSeed': '1',
  'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  // Keeps the drawing close to a normal screen aspect so the initial fitView
  // stays readable instead of zooming out to a hairline.
  'elk.aspectRatio': '1.6',
}

/** Hierarchy containers for L2 domain groups. */
export const GROUP_LAYOUT_OPTIONS: LayoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.spacing.nodeNode': '32',
  'elk.padding': '[top=48,left=40,bottom=40,right=40]',
  'elk.randomSeed': '1',
}
