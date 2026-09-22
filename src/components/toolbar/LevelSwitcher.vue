<script setup lang="ts">
import { computed } from 'vue'

import { levelLabel } from '@/adapters/vueFlow/toVueFlowElements'
import { GRAPH_LEVELS, type GraphLevel } from '@/domain/model'
import { useExplorerStore } from '@/stores/explorer'

/**
 * L0 / L1 / L2 switch (DESIGN.md 15.3).
 *
 * A segmented control rather than a dropdown: there are exactly three levels
 * and the reader changes between them constantly while exploring.
 */
const explorer = useExplorerStore()

const levels = computed(() =>
  GRAPH_LEVELS.map((level) => ({
    level,
    label: levelLabel(level),
    badge: `L${String(level)}`,
  })),
)

function select(level: GraphLevel): void {
  explorer.setLevel(level)
}
</script>

<template>
  <div
    class="level-switcher"
    role="group"
    aria-label="图层级别"
  >
    <button
      v-for="entry in levels"
      :key="entry.level"
      type="button"
      class="level-switcher__option"
      :class="{ 'is-active': explorer.level === entry.level }"
      :aria-pressed="explorer.level === entry.level"
      @click="select(entry.level)"
    >
      <span class="level-switcher__badge">{{ entry.badge }}</span>
      <span class="level-switcher__text">{{ entry.label.replace(/^L\d\s*/, '') }}</span>
    </button>
  </div>
</template>

<style scoped>
.level-switcher {
  display: inline-flex;
  padding: 2px;
  background: var(--surface-sunken);
  border-radius: var(--radius-md);
}

.level-switcher__option {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-3);
  font: inherit;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
}

.level-switcher__option.is-active {
  background: var(--surface-panel);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
  font-weight: 600;
}

.level-switcher__badge {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
}

.level-switcher__option.is-active .level-switcher__badge {
  color: var(--focus-ring);
}
</style>
