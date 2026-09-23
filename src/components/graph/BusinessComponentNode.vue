<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { computed } from 'vue'

import type { BusinessNodeData } from '@/adapters/vueFlow/nodeTypes'
import { verificationTokenName } from '@/styles/semanticTokens'

/**
 * A business component at its own level (DESIGN.md 13.2).
 *
 * Renders only what its data carries; it never reaches into a store, so the
 * same node is correct in the canvas, in a test and in a static export.
 */
const props = defineProps<{
  data: BusinessNodeData
  selected?: boolean
}>()

const inputs = computed(() => props.data.ports.filter((port) => port.direction === 'input'))
const outputs = computed(() => props.data.ports.filter((port) => port.direction === 'output'))

const verificationStyle = computed(() => ({
  '--node-accent': `var(${verificationTokenName(props.data.verification)})`,
}))
</script>

<template>
  <div
    class="business-node"
    :style="verificationStyle"
  >
    <header class="business-node__head">
      <span class="business-node__kind">{{ data.kindLabel }}</span>
      <span
        class="business-node__verification"
        :title="data.verificationLabel"
      >
        <span
          class="business-node__glyph"
          aria-hidden="true"
        >{{ data.verificationGlyph }}</span>
        {{ data.verificationShortLabel }}
      </span>
    </header>

    <h3 class="business-node__title u-clamp-2">
      {{ data.label }}
    </h3>

    <!--
      GRAPH_READABILITY_DESIGN.md 5.4: the ellipsis is the canvas summarising,
      not data going missing, so the full sentence has to be reachable — by
      hover *and* by keyboard. `focus` is added to the trigger list because the
      default is hover only, and the trigger is given a tab stop because a
      `focus` trigger on an unfocusable element can never fire.
    -->
    <ElTooltip
      v-if="data.responsibility !== ''"
      :content="data.responsibility"
      :trigger="['hover', 'focus']"
      placement="top"
    >
      <p
        class="business-node__responsibility u-truncate"
        tabindex="0"
      >
        {{ data.responsibility }}
      </p>
    </ElTooltip>

    <footer class="business-node__foot">
      <span v-if="data.portCounts.inputs > 0">入 {{ data.portCounts.inputs }}</span>
      <span v-if="data.portCounts.outputs > 0">出 {{ data.portCounts.outputs }}</span>
      <span
        v-if="data.hiddenFlowCount > 0"
        class="business-node__hidden"
      >
        折叠 {{ data.hiddenFlowCount }} 条内部流
      </span>
    </footer>

    <!-- One handle per declared port, so an edge keeps its real endpoint. -->
    <Handle
      v-for="port in inputs"
      :id="port.id"
      :key="`in-${port.id}`"
      type="target"
      :position="Position.Left"
      :style="{ top: `${port.offset}%` }"
      :title="port.name"
    />
    <Handle
      v-for="port in outputs"
      :id="port.id"
      :key="`out-${port.id}`"
      type="source"
      :position="Position.Right"
      :style="{ top: `${port.offset}%` }"
      :title="port.name"
    />

    <!--
      Generic handles for aggregated edges. They must exist or those edges would
      not render at all, but they are not drawn: at this level an aggregate has
      no single port to point at, so a visible dot would claim one does.
    -->
    <Handle
      id="in"
      type="target"
      :position="Position.Left"
      class="business-node__aggregate-handle"
    />
    <Handle
      id="out"
      type="source"
      :position="Position.Right"
      class="business-node__aggregate-handle"
    />
  </div>
</template>

<style scoped>
.business-node {
  width: 100%;
  height: 100%;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  background: var(--surface-panel);
  border: 1px solid var(--border-subtle);
  border-left: 4px solid var(--node-accent, var(--border-strong));
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.business-node__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.business-node__kind {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  background: var(--surface-sunken);
  border-radius: var(--radius-pill);
  padding: 0 var(--space-2);
}

.business-node__verification {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--font-size-xs);
  color: var(--node-accent, var(--text-secondary));
  white-space: nowrap;
}

.business-node__glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  border: 1px solid currentColor;
  border-radius: var(--radius-sm);
  font-size: 10px;
  line-height: 1;
}

.business-node__title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--text-primary);
}

.business-node__responsibility {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  flex: 1;
}

/*
 * The responsibility line is a tab stop so the keyboard can reach its tooltip,
 * and a tab stop the user cannot see is worse than none — so it shows focus the
 * same way the canvas shows selection.
 */
.business-node__responsibility:focus-visible {
  outline: 2px solid var(--graph-selection);
  outline-offset: 1px;
  border-radius: var(--radius-sm);
}

.business-node__foot {
  display: flex;
  gap: var(--space-3);
  font-size: var(--font-size-xs);
  color: var(--text-muted);
}

.business-node__hidden {
  margin-left: auto;
  font-style: italic;
}

.business-node__aggregate-handle {
  opacity: 0;
}
</style>
