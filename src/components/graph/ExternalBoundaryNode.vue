<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { computed } from 'vue'

import type { ExternalNodeData } from '@/adapters/vueFlow/nodeTypes'
import { verificationTokenName } from '@/styles/semanticTokens'

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
    <p
      v-if="data.responsibility !== ''"
      class="external-node__responsibility u-truncate"
    >
      {{ data.responsibility }}
    </p>

    <Handle
      id="in"
      type="target"
      :position="Position.Left"
    />
    <Handle
      id="out"
      type="source"
      :position="Position.Right"
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
</style>
