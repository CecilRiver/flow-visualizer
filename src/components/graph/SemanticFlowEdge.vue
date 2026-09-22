<script setup lang="ts">
import { EdgeLabelRenderer, type EdgeProps } from '@vue-flow/core'
import { computed } from 'vue'

import { hasRoute, type SemanticEdgeData } from '@/adapters/vueFlow/edgeTypes'
import { edgeStroke } from '@/styles/semanticTokens'

/**
 * The one edge renderer (DESIGN.md 13.4).
 *
 * Line style and label repeat what the colour says, so a reader who cannot
 * separate the hues still gets the kind. Feedback edges are dashed and carry a
 * fixed 反馈 marker rather than relying on a different purple.
 *
 * The line is never animated: this is a static statement of business data
 * dependency, and motion would read as live telemetry.
 */
const props = defineProps<EdgeProps<SemanticEdgeData>>()

const style = computed(() =>
  edgeStroke(props.data.kind, props.data.feedback),
)

const verification = computed(() => props.data.verificationShortLabel)

/**
 * Route through ELK's bend points when it produced one; otherwise let Vue Flow's
 * own smooth-step routing connect the handles.
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

/** Midpoint of the route, used to park the label away from the arrowheads. */
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
      class="semantic-edge__label"
      :class="{ 'is-dimmed': data.dimmed }"
      :style="{
        transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)`,
        '--edge-color': style.color,
      }"
    >
      <span class="semantic-edge__kind">{{ data.label }}</span>
      <span
        v-if="data.flowCount > 1"
        class="semantic-edge__count"
      >×{{ data.flowCount }}</span>
      <span
        v-if="data.feedback"
        class="semantic-edge__feedback"
      >反馈</span>
      <span class="semantic-edge__verification">{{ verification }}</span>
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
  background: var(--surface-panel);
  border: 1px solid var(--edge-color, var(--border-subtle));
  border-radius: var(--radius-pill);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  pointer-events: all;
  white-space: nowrap;
}

.semantic-edge__label.is-dimmed {
  opacity: var(--graph-dimmed-opacity);
}

.semantic-edge__kind {
  color: var(--edge-color, var(--text-primary));
}

.semantic-edge__count {
  color: var(--text-muted);
}

.semantic-edge__feedback {
  color: var(--flow-feedback);
  border-left: 1px solid var(--border-subtle);
  padding-left: var(--space-1);
}

.semantic-edge__verification {
  color: var(--text-muted);
  border-left: 1px solid var(--border-subtle);
  padding-left: var(--space-1);
}
</style>
