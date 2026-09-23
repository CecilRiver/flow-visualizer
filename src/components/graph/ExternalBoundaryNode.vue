<script setup lang="ts">
import { Handle } from '@vue-flow/core'
import { computed } from 'vue'

import type { ExternalNodeData } from '@/adapters/vueFlow/nodeTypes'
import { verificationTokenName } from '@/styles/semanticTokens'

import { handlePosition, handleStyle } from './handlePlacement'

/**
 * A boundary actor or device outside the system (DESIGN.md 13.2).
 *
 * Deliberately shaped differently from a business component: an external node
 * keeps its identity at every level, so the reader must never mistake one for a
 * capability that got coarser.
 */
const props = defineProps<{
  data: ExternalNodeData
  selected?: boolean
}>()

const verificationStyle = computed(() => ({
  '--node-accent': `var(${verificationTokenName(props.data.verification)})`,
}))
</script>

<template>
  <div
    class="external-node"
    :style="verificationStyle"
  >
    <span class="external-node__kind">{{ data.kindLabel }}</span>
    <h3 class="external-node__title u-clamp-2">
      {{ data.label }}
    </h3>
    <!--
      Same contract as a business node (GRAPH_READABILITY_DESIGN.md 5.4): the
      truncated line is a summary, and the full sentence stays reachable by
      hover and by keyboard. A boundary is where a reader most often has to
      check what an outside actor actually is.
    -->
    <ElTooltip
      v-if="data.responsibility !== ''"
      :content="data.responsibility"
      :trigger="['hover', 'focus']"
      placement="top"
    >
      <p
        class="external-node__responsibility u-truncate"
        tabindex="0"
      >
        {{ data.responsibility }}
      </p>
    </ElTooltip>

    <!--
      Its own render ports, exactly as a business node has (7.3).
      A boundary used to declare a generic pair named `in` and `out` while the
      adapter handed its edges whatever handle id the Schema port was called —
      a handle that existed on no element, which Vue Flow answers by quietly
      attaching the edge to the node's centre instead.
    -->
    <Handle
      v-for="port in data.ports"
      :id="port.id"
      :key="port.id"
      :type="port.end"
      :position="handlePosition(port.side)"
      :style="handleStyle(port)"
      :title="port.semanticPortId ?? ''"
    />
  </div>
</template>

<style scoped>
.external-node {
  width: 100%;
  height: 100%;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  justify-content: center;
  /* Dashed border: outside the system's responsibility boundary. */
  background: var(--node-external-surface);
  border: 1px dashed var(--node-external-accent);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.external-node__kind {
  font-size: var(--font-size-xs);
  color: var(--node-external-accent);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.external-node__title {
  margin: 0;
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--text-primary);
}

.external-node__responsibility {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}

/* Same as a business node: a visible tab stop, since it carries a tooltip. */
.external-node__responsibility:focus-visible {
  outline: 2px solid var(--graph-selection);
  outline-offset: 1px;
  border-radius: var(--radius-sm);
}
</style>
