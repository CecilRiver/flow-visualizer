<script setup lang="ts">
import { EdgeLabelRenderer, type EdgeProps } from '@vue-flow/core'
import { computed } from 'vue'

import { hasRoute, type SemanticEdgeData } from '@/adapters/vueFlow/edgeTypes'
import { GRAPH_READABILITY } from '@/layout/readabilityOptions'
import { edgeStroke, verificationTokenName } from '@/styles/semanticTokens'

import { useZoomBucket } from './graphRenderContext'

/**
 * The one edge renderer (DESIGN.md 13.4).
 *
 * Line style and label repeat what the colour says, so a reader who cannot
 * separate the hues still gets the kind. Feedback edges are dashed; their
 * wording already says 反馈, so the badge that used to repeat it is gone
 * (GRAPH_READABILITY_DESIGN.md 5.1).
 *
 * The line is never animated: this is a static statement of business data
 * dependency, and motion would read as live telemetry.
 *
 * What this component decides is only *how* an edge is drawn. What it says was
 * already decided by `edgePresentation`, before it arrived here.
 */
const props = defineProps<EdgeProps<SemanticEdgeData>>()

const style = computed(() =>
  edgeStroke(props.data.kind, props.data.feedback),
)

const presentation = computed(() => props.data.presentation)

const zoomBucket = useZoomBucket()

/**
 * Below the hidden band the label is not rendered at all.
 *
 * Removed rather than made transparent: an invisible label that still occupied
 * its box would keep taking clicks meant for whatever is underneath it, and the
 * design document asks for the edge to stay clickable and focusable with only
 * the inline text gone (5.3).
 */
const labelVisible = computed(() => zoomBucket.value !== 'hidden')

/**
 * Route through ELK's bend points when it produced one; otherwise a straight
 * line between the handles.
 *
 * There is no smooth-step fallback here — `hasRoute` is false exactly when the
 * layout produced nothing, and Vue Flow's own router is not consulted.
 */
const path = computed(() => {
  const points = props.data.bendPoints
  if (!hasRoute(props.data)) {
    return `M ${props.sourceX},${props.sourceY} L ${props.targetX},${props.targetY}`
  }
  const segments = [`M ${props.sourceX},${props.sourceY}`]
  for (const point of points) segments.push(`L ${point.x},${point.y}`)
  segments.push(`L ${props.targetX},${props.targetY}`)
  return segments.join(' ')
})

/**
 * Midpoint of the route, used to park the label away from the arrowheads.
 *
 * Still a local guess. The layout takes this over in R2, which is why the
 * label's own width is not consulted here.
 */
const labelPosition = computed(() => {
  const points = props.data.bendPoints
  if (points.length === 0) {
    return {
      x: (props.sourceX + props.targetX) / 2,
      y: (props.sourceY + props.targetY) / 2,
    }
  }
  const middle = points[Math.floor(points.length / 2)]
  return middle === undefined
    ? { x: (props.sourceX + props.targetX) / 2, y: (props.sourceY + props.targetY) / 2 }
    : { x: middle.x, y: middle.y }
})

const strokeDash = computed(() =>
  style.value.dashArray === '' ? undefined : style.value.dashArray,
)

/**
 * The label's own measurements, taken from the shared constants.
 *
 * Bound rather than written into the style block below: the same numbers size
 * the box the layout reserves, so a value that lived only in CSS could drift
 * away from the space actually allocated for it (6.1).
 */
const labelStyle = computed(() => ({
  transform: `translate(-50%, -50%) translate(${labelPosition.value.x}px, ${labelPosition.value.y}px)`,
  '--edge-color': style.value.color,
  '--label-max-width': `${
    presentation.value.maxLines === 2
      ? GRAPH_READABILITY.label.detailMaxWidth
      : GRAPH_READABILITY.label.compactMaxWidth
  }px`,
  '--label-font-size': `${GRAPH_READABILITY.label.fontSize}px`,
  '--label-line-height': `${GRAPH_READABILITY.label.lineHeight}px`,
}))

/** The mark carries the verification colour, the letter carries its meaning. */
const markStyle = computed(() => ({
  color: `var(${verificationTokenName(props.data.verification)})`,
}))
</script>

<template>
  <g
    class="semantic-edge"
    :class="{
      'is-highlighted': data.highlighted,
      'is-dimmed': data.dimmed,
      'is-feedback': data.feedback,
    }"
    :style="{ '--edge-color': style.color }"
  >
    <!--
      The full sentence hangs on the edge, not on the label. The label is
      `pointer-events: none` (6.3), so a tooltip anchored to it could never be
      reached; SVG's own `<title>` gives the edge a native hover tooltip with no
      JavaScript, and says exactly what the accessible name already says.
    -->
    <title>{{ presentation.accessibleText }}</title>

    <!-- Thick invisible companion: a 1.25px line is hard to click. -->
    <path
      class="semantic-edge__hit"
      :d="path"
    />
    <path
      class="semantic-edge__line"
      :d="path"
      :stroke="style.color"
      :stroke-width="style.strokeWidth"
      :stroke-dasharray="strokeDash"
      fill="none"
    />
  </g>

  <EdgeLabelRenderer>
    <div
      v-if="labelVisible"
      class="semantic-edge__label"
      :data-edge-id="id"
      :data-source="source"
      :data-target="target"
      :class="{
        'is-dimmed': data.dimmed,
        'is-multiline': presentation.maxLines === 2,
      }"
      :style="labelStyle"
    >
      <span
        class="semantic-edge__kind"
        :class="{ 'u-clamp-2': presentation.maxLines === 2 }"
      >{{ presentation.compactText }}</span>
      <span
        class="semantic-edge__mark"
        :style="markStyle"
      >{{ presentation.verificationMark }}</span>
    </div>
  </EdgeLabelRenderer>
</template>

<style scoped>
.semantic-edge__line {
  transition: opacity 120ms ease;
}

.semantic-edge__hit {
  stroke: transparent;
  stroke-width: 14px;
  fill: none;
  cursor: pointer;
}

.semantic-edge.is-dimmed {
  opacity: var(--graph-dimmed-opacity);
}

.semantic-edge.is-highlighted .semantic-edge__line {
  filter: drop-shadow(0 0 3px var(--edge-color, var(--graph-selection)));
}

.semantic-edge__label {
  position: absolute;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 1px var(--space-2);
  max-width: var(--label-max-width, 112px);
  background: var(--surface-panel);
  border: 1px solid var(--edge-color, var(--border-subtle));
  border-radius: var(--radius-pill);
  font-size: var(--label-font-size, 11px);
  line-height: var(--label-line-height, 16px);
  color: var(--text-primary);
  /*
   * The halo is what separates the box from the line running under it. It is a
   * shadow rather than a thicker border so it does not read as part of the edge
   * colour, and it is deliberately outside `getBoundingClientRect()` — the
   * readability measurement works on the box, and a 2px ring is far below the
   * overlap areas that matter.
   */
  box-shadow: 0 0 0 2px var(--label-halo, var(--surface-panel));
  /*
   * The edge's own hit path takes the clicks (6.3). A label that accepted them
   * would steal the click from whatever it happens to sit on top of, and it is
   * the element least likely to have been the intended target.
   */
  pointer-events: none;
}

.semantic-edge__label.is-dimmed {
  opacity: var(--graph-dimmed-opacity);
}

.semantic-edge__kind {
  color: var(--edge-color, var(--text-primary));
  white-space: nowrap;
}

/* A two-line label is allowed to wrap where the one-line form is not. */
.semantic-edge__label.is-multiline .semantic-edge__kind {
  white-space: normal;
  overflow-wrap: anywhere;
}

/*
 * The mark states a verification state in one or two characters, so it never
 * carries the meaning alone: the legend, the node badges and this edge's own
 * accessible name all spell the state out.
 */
.semantic-edge__mark {
  flex: none;
  border-left: 1px solid var(--border-subtle);
  padding-left: var(--space-1);
  font-variant-numeric: tabular-nums;
}
</style>
