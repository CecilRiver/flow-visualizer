import { FLOW_KIND_LABEL, VERIFICATION_LABEL, labelFor } from '@/domain/labels'
import type { GraphLevel } from '@/domain/model'
import type { ProjectedEdge, ProjectedGraph } from '@/domain/view-model'
import { severityRank } from '@/projection/verificationRank'
import { verificationGlyph } from '@/styles/semanticTokens'

import type { EdgeLayoutInput } from './elkLayout'
import { measureEdgeLabel } from './labelMetrics'

/**
 * What an edge says, derived from the projection without changing it
 * (GRAPH_READABILITY_DESIGN.md 5.1, 13.1).
 *
 * A projected edge keeps its semantic `label`. What the canvas *draws* is a
 * second, shorter thing: at L0 and L1 the reader is looking at domains, so a
 * full flow name is noise that also happens to be wide enough to push the
 * layout apart. `ProjectedEdge` is not rewritten — a flow name is still needed
 * by the Inspector, the tooltip and the accessible name, all of which are
 * derived here from the same object.
 */
export interface EdgePresentation {
  /** The text drawn on the canvas. */
  compactText: string
  /**
   * The full wording for `aria-label` and tooltips.
   *
   * Never shortened, and never affected by what the canvas is currently
   * showing: hiding a label at low zoom must not hide it from a screen reader.
   */
  accessibleText: string
  /** The compact verification mark, or `''` when there is nothing to mark. */
  verificationMark: string
  /** How many lines `compactText` may occupy before it is elided. */
  maxLines: 1 | 2
}

/** What `edgePresentation` needs beyond the edge itself. */
export interface EdgePresentationInput {
  edge: ProjectedEdge
  level: GraphLevel
  /** Display name for a projected node or group id, for the direction clause. */
  nodeLabel: (id: string) => string | undefined
}

/**
 * The three-part text an edge carries, in one derivation.
 *
 * Order matters: feedback wins over everything. A feedback edge states its
 * direction on the line itself, and repeating the kind next to a 反馈 badge —
 * which is what the canvas did before — says the same thing twice in the space
 * of two words.
 */
export function edgePresentation(input: EdgePresentationInput): EdgePresentation {
  const { edge, level, nodeLabel } = input
  const kindLabel = labelFor(FLOW_KIND_LABEL, edge.kind)
  const flowCount = edge.sourceFlowIds.length
  const aggregated = flowCount > 1
  const countSuffix = aggregated ? ` ×${String(flowCount)}` : ''

  // Only an L2 edge that stands for exactly one flow has a name worth showing:
  // below that the reader is looking at domains and the name would be both
  // meaningless and long (5.1).
  const showsFlowName = level === 2 && !aggregated && !edge.feedback

  let compactText: string
  let maxLines: 1 | 2

  if (edge.feedback) {
    compactText = `反馈${countSuffix}`
    maxLines = 1
  } else if (showsFlowName) {
    compactText = edge.label
    maxLines = 2
  } else {
    compactText = `${kindLabel}${countSuffix}`
    maxLines = 1
  }

  const from = nodeLabel(edge.source) ?? edge.source
  const to = nodeLabel(edge.target) ?? edge.target
  const verification = labelFor(VERIFICATION_LABEL, edge.verification)

  return {
    compactText,
    accessibleText: `${kindLabel}：${edge.label}，${from} → ${to}，证据：${verification}`,
    verificationMark: verificationGlyph(edge.verification),
    maxLines,
  }
}

/**
 * Everything the layout needs to know about each edge's label (10).
 *
 * This is the one place where the drawn text and the space reserved for it are
 * derived together, and that is deliberate: measuring a different string from
 * the one that gets rendered is how a label comes to be wider than its box, and
 * a box that is wider than the text pushes the layers further apart than they
 * need to be.
 *
 * The measurement is an estimate from the font metrics in `labelMetrics`, never
 * a DOM read — see that module for why.
 */
export function edgeLayoutInputs(
  graph: ProjectedGraph,
  input: { level: GraphLevel; nodeLabel: (id: string) => string | undefined },
): Map<string, EdgeLayoutInput> {
  const inputs = new Map<string, EdgeLayoutInput>()

  for (const edge of graph.edges) {
    const presentation = edgePresentation({ edge, level: input.level, nodeLabel: input.nodeLabel })
    inputs.set(edge.id, {
      metrics: measureEdgeLabel({
        text: presentation.compactText,
        mark: presentation.verificationMark,
        maxLines: presentation.maxLines,
      }),
      // Lower places first: the most severe verification picks first, because
      // that is the edge a reader most needs to read.
      placementRank: severityRank(edge.verification),
    })
  }

  return inputs
}
