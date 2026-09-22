<script setup lang="ts">
import { computed } from 'vue'

import { VERIFICATION_VALUES } from '@/app/urlState'
import type { Verification } from '@/domain/model'
import { verificationLegend } from '@/styles/semanticTokens'
import { useCatalogStore } from '@/stores/catalog'
import { useExplorerStore } from '@/stores/explorer'

/**
 * Verification-state filter (DESIGN.md 15.1).
 *
 * Every state is enabled by default. The point of the viewer is to make weak
 * evidence visible, so hiding `inferred` or `conflict` is always an explicit
 * choice the user makes, never a default they inherit.
 */
const explorer = useExplorerStore()
const catalog = useCatalogStore()

const options = computed(() =>
  verificationLegend().map((entry) => ({
    ...entry,
    count: catalog.scenarioVerificationCounts.get(entry.verification) ?? 0,
  })),
)

const selected = computed({
  get: () => explorer.enabledVerificationStates,
  set: (value: Verification[]) => explorer.setVerificationStates(value),
})

const summary = computed(() => {
  if (explorer.allVerificationsSelected) return '全部状态'
  if (explorer.enabledVerificationStates.length === 0) return '未选择状态'
  return `${String(explorer.enabledVerificationStates.length)}/${String(VERIFICATION_VALUES.length)} 状态`
})
</script>

<template>
  <ElPopover
    placement="bottom-start"
    trigger="click"
    :width="300"
  >
    <template #reference>
      <button
        type="button"
        class="filter-trigger"
        :class="{ 'is-filtered': !explorer.allVerificationsSelected }"
      >
        验证状态：{{ summary }}
      </button>
    </template>

    <div class="filter-panel">
      <ElCheckboxGroup v-model="selected">
        <ElCheckbox
          v-for="option in options"
          :key="option.verification"
          :value="option.verification"
          :disabled="option.count === 0"
        >
          <span
            class="filter-panel__row"
            :title="option.description"
          >
            <span
              class="filter-panel__glyph"
              :style="{
                color: option.color,
                borderColor: option.color,
                background: option.surface,
              }"
              aria-hidden="true"
            >{{ option.glyph }}</span>
            <span>{{ option.label }}</span>
            <span class="filter-panel__count">{{ option.count }}</span>
          </span>
        </ElCheckbox>
      </ElCheckboxGroup>

      <div class="filter-panel__actions">
        <button
          type="button"
          @click="explorer.selectAllVerifications()"
        >
          全选
        </button>
        <button
          type="button"
          @click="explorer.clearVerifications()"
        >
          全不选
        </button>
      </div>
    </div>
  </ElPopover>
</template>

<style scoped>
.filter-trigger {
  border: 1px solid var(--border-subtle);
  background: var(--surface-panel);
  border-radius: var(--radius-md);
  padding: var(--space-1) var(--space-3);
  font: inherit;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
}

.filter-trigger.is-filtered {
  border-color: var(--focus-ring);
  color: var(--focus-ring);
}

.filter-panel__row {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.filter-panel__glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  border: 1px solid;
  border-radius: var(--radius-sm);
  font-size: 10px;
  line-height: 1;
  flex: none;
}

.filter-panel__count {
  color: var(--text-muted);
  font-size: var(--font-size-xs);
}

.filter-panel__actions {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-subtle);
}

.filter-panel__actions button {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--focus-ring);
  cursor: pointer;
}
</style>
