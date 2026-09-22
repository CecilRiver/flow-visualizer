<script setup lang="ts">
import { computed } from 'vue'

import { useExplorerStore } from '@/stores/explorer'

/**
 * Explains an empty canvas (DESIGN.md 15.1).
 *
 * An empty graph is almost always a filtered one, so the message names the
 * filters that caused it and offers the one action that fixes it. It never
 * claims the model is empty when only the view is.
 */
const props = defineProps<{
  /** True when the filters removed everything, rather than the scenario. */
  byFilter: boolean
}>()

const explorer = useExplorerStore()

const hiddenKinds = computed(() =>
  explorer.filtersHideEverything && explorer.enabledFlowKinds.length === 0,
)
const hiddenVerifications = computed(() => explorer.enabledVerificationStates.length === 0)
</script>

<template>
  <div class="empty-state">
    <template v-if="props.byFilter">
      <h2 class="empty-state__title">
        当前筛选条件下没有可显示的数据流
      </h2>
      <ul class="empty-state__list">
        <li v-if="hiddenKinds">
          已停用全部数据流类型
        </li>
        <li v-if="hiddenVerifications">
          已停用全部验证状态
        </li>
      </ul>
      <button
        type="button"
        class="empty-state__action"
        @click="explorer.resetFlowKinds(); explorer.resetVerifications()"
      >
        恢复全部筛选
      </button>
    </template>

    <template v-else>
      <h2 class="empty-state__title">
        当前场景在该层级下没有可显示的数据流
      </h2>
      <p class="empty-state__hint">
        这表示配置中该场景与当前层级的组合本身为空，而不是被筛选掉了。
      </p>
    </template>
  </div>
</template>

<style scoped>
.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-6);
  text-align: center;
  background: var(--graph-canvas-bg);
  z-index: 1;
}

.empty-state__title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--text-primary);
}

.empty-state__list {
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--text-secondary);
  font-size: var(--font-size-md);
}

.empty-state__hint {
  margin: 0;
  max-width: 42ch;
  color: var(--text-secondary);
}

.empty-state__action {
  border: 1px solid var(--border-strong);
  background: var(--surface-panel);
  color: var(--text-primary);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-4);
  cursor: pointer;
  font: inherit;
}

.empty-state__action:hover {
  border-color: var(--focus-ring);
  color: var(--focus-ring);
}
</style>
