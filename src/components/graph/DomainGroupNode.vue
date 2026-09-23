<script setup lang="ts">
import { Handle } from '@vue-flow/core'

import type { GroupNodeData } from '@/adapters/vueFlow/nodeTypes'

import { handlePosition, handleStyle } from './handlePlacement'

/**
 * A display-only container for the L2 children of one capability domain
 * (DESIGN.md 13.3).
 *
 * It is not a component: the underlying L1 domain still exists in the model and
 * is what the Inspector opens. The container only says "these belong together",
 * so it is drawn as a frame rather than a card.
 */
defineProps<{
  data: GroupNodeData
  selected?: boolean
}>()
</script>

<template>
  <div class="domain-group">
    <header class="domain-group__head">
      <span class="domain-group__title u-truncate">{{ data.label }}</span>
      <span class="domain-group__count">{{ data.childCount }} 个组件</span>
    </header>

    <!--
      Edges retarget onto the container, so it has render ports of its own (7.3).
      On a container the layout asks ELK to distribute them along a side, since
      the box they sit on is the one ELK is still computing — so these are read
      back from the result like every other port, not derived from a formula.
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
.domain-group {
  width: 100%;
  height: 100%;
  border: 1px solid var(--node-group-border);
  border-radius: var(--radius-lg);
  background: var(--node-group-surface);
  /* Children are drawn inside; the head sits above them. */
  pointer-events: none;
}

.domain-group__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--node-group-border);
  pointer-events: auto;
}

.domain-group__title {
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--text-secondary);
}

.domain-group__count {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  white-space: nowrap;
}
</style>
