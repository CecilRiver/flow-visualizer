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
const labelVisible = computed(
  () =>
    zoomBucket.value !== 'hidden' &&
    props.data.labelBox !== null &&
    props.data.labelBox.visibleByDefault,
)

/**
 * The verification mark is drawn only at detail zoom (5.3).
 *
 * Its width is reserved in every bucket regardless. `measureEdgeLabel` measures
 * the text and the mark as one box, so the space is always there — which is what
 * lets the mark appear on zoom without the label changing size, and therefore
 * without a re-layout. Reserving it only in the detail bucket would mean the box
 * grew when the reader zoomed in, which is the one thing 5.3 forbids.
 */
const markVisible = computed(() => zoomBucket.value === 'detail')

/** `…` when the text did not fit, so the reader knows the name is cut short. */
const lines = computed(() => {
  const box = props.data.labelBox
  if (box === null) return []
  if (!box.truncated) return [...box.lines]
  return box.lines.map((line, index) => (index === box.lines.length - 1 ? `${line}…` : line))
})

/**
 * The layout's own route, one subpath per section (9.1).
 *
 * Every point comes from the layout result, including the two ends. They are
 * not taken from Vue Flow's `sourceX`/`sourceY`/`targetX`/`targetY`, which are
 * measured from the handle elements in the DOM: mixing the two geometries is
 * how an edge came to be drawn from somewhere other than the point the layout
 * routed to, and it showed up as a short diagonal near the node.
 *
 * Each section starts its own `M`, so two sections that do not meet are drawn
 * as two lines rather than joined by one that was never routed (12.1). The
 * path is unfilled, so multiple subpaths are exactly what is wanted.
 *
 * Vue Flow's endpoints are the final fallback and nothing else (9.3.2): when
 * the layout produced no sections there is no route to draw, and a straight
 * line between the handles is a more honest answer than no line at all.
 */
const path = computed(() => {
  if (!hasRoute(props.data)) {
    return `M ${props.sourceX},${props.sourceY} L ${props.targetX},${props.targetY}`
  }
  return props.data.sections
    .map((section) => {
      const commands = [`M ${section.startPoint.x},${section.startPoint.y}`]
      for (const point of section.bendPoints) commands.push(`L ${point.x},${point.y}`)
      commands.push(`L ${section.endPoint.x},${section.endPoint.y}`)
      return commands.join(' ')
    })
    .join(' ')
})

const strokeDash = computed(() =>
  style.value.dashArray === '' ? undefined : style.value.dashArray,
)

/**
 * The label's box, exactly as the layout measured it (6.2, 10).
 *
 * `x`/`y` are the top-left corner in graph coordinates — the same space Vue
 * Flow's node positions live in, since `EdgeLabelRenderer` teleports the label
 * inside the already-transformed viewport. So they are used directly, and the
 * old `translate(-50%, -50%)` is gone: it centred the box on a point chosen
 * for its midpoint, which is not the same thing as the box the collisions were
 * checked against.
 *
 * Width and height are pinned to the measured values rather than left to the
 * content. The browser's own layout would be a second opinion about how big the
 * label is, and the overlap check only ever consulted the first one.
 *
 * The numbers come from `GRAPH_READABILITY` rather than from the style block
 * below, because the same numbers size the box the layout reserves — a value
 * that lived only in CSS could drift away from the space actually allocated.
 */
const labelStyle = computed(() => {
  const box = props.data.labelBox
  return {
    left: `${String(box?.x ?? 0)}px`,
    top: `${String(box?.y ?? 0)}px`,
    width: `${String(box?.width ?? 0)}px`,
    height: `${String(box?.height ?? 0)}px`,
    '--edge-color': style.value.color,
    '--label-padding-x': `${String(GRAPH_READABILITY.label.horizontalPadding)}px`,
    '--label-padding-y': `${String(GRAPH_READABILITY.label.verticalPadding)}px`,
    '--label-gap': `${String(GRAPH_READABILITY.label.iconGap)}px`,
    '--label-font-size': `${String(GRAPH_READABILITY.label.fontSize)}px`,
    '--label-line-height': `${String(GRAPH_READABILITY.label.lineHeight)}px`,
  }
})

/** The mark carries the verification colour, the letter carries its meaning. */
const markStyle = computed(() => ({
  color: `var(${verificationTokenName(props.data.verification)})`,
}))
</script>

<template>
  <g
    class="semantic-edge"
    :data-edge-id="id"
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
    <!--
      `data-edge-id` is on both this group and the label below, so the geometry
      measurement can name the edge it is complaining about. Without it a
      failure over a route in the wrong place would report coordinates and no
      identity.
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
      :data-truncated="data.labelBox?.truncated === true ? 'true' : 'false'"
      :class="{ 'is-dimmed': data.dimmed }"
      :style="labelStyle"
    >
      <!--
        One span per line, from the measurement. Letting the browser wrap this
        instead would produce its own line count, and the box it wrapped into is
        one the collision check never saw.
      -->
      <span class="semantic-edge__kind">
        <span
          v-for="(line, index) in lines"
          :key="index"
          class="semantic-edge__line-text"
        >{{ line }}</span>
      </span>
      <span
        v-if="markVisible && presentation.verificationMark !== ''"
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
  display: flex;
  align-items: center;
  gap: var(--label-gap, 4px);
  /*
   * Every one of these has a counterpart in `measureEdgeLabel`, and they have to
   * agree to the pixel: the layout reserved `width` × `height` and checked that
   * box against the nodes and the other labels, so a box that renders even a
   * little larger is a box whose collisions were never checked.
   *
   *   border-box     the declared width includes the border and the padding,
   *                  which is how `measureEdgeLabel` computes it too
   *   border         1px per side
   *   padding        3px vertical, 8px horizontal — per side, not the sum
   *   line-height    one line is exactly this tall
   */
  box-sizing: border-box;
  overflow: hidden;
  padding: var(--label-padding-y, 3px) var(--label-padding-x, 8px);
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

/*
 * The lines stack because they are blocks, which is what makes `lines.length ×
 * line-height` the real height — the same arithmetic `measureEdgeLabel` did.
 */
.semantic-edge__kind {
  display: flex;
  flex-direction: column;
  min-width: 0;
  color: var(--edge-color, var(--text-primary));
}

.semantic-edge__line-text {
  display: block;
  white-space: pre;
}

/*
 * The mark states a verification state in one or two characters, so it never
 * carries the meaning alone: the legend, the node badges and this edge's own
 * accessible name all spell the state out.
 *
 * `margin-left: auto` pins it to the right edge of the box rather than letting
 * it sit against the text. The box reserves a fixed width for the mark, so a
 * short name would otherwise leave the mark floating in the middle of the label
 * with the reserved space trailing after it.
 */
.semantic-edge__mark {
  flex: none;
  margin-left: auto;
  border-left: 1px solid var(--border-subtle);
  padding-left: var(--label-gap, 4px);
  font-variant-numeric: tabular-nums;
}
</style>
