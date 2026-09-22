<script setup lang="ts">
import { computed } from 'vue'

import { FLOW_KIND_VALUES } from '@/app/urlState'
import { labelFor, FLOW_KIND_LABEL } from '@/domain/labels'
import type { FlowKind } from '@/domain/model'
import { flowKindLegend } from '@/styles/semanticTokens'
import { useCatalogStore } from '@/stores/catalog'
import { useExplorerStore } from '@/stores/explorer'

/**
 * Flow-kind filter (DESIGN.md 15.1).
 *
 * Filters are applied before projection, so the counts shown here are of the
 * scenario's raw flows and always match what the canvas will draw.
 */
const explorer = useExplorerStore()
const catalog = useCatalogStore()

const legendByKind = computed(() => {
  const map = new Map<FlowKind, ReturnType<typeof flowKindLegend>[number]>()
  for (const entry of flowKindLegend()) map.set(entry.kind, entry)
  return map
})

const options = computed(() =>
  FLOW_KIND_VALUES.map((kind) => ({
    kind,
    label: labelFor(FLOW_KIND_LABEL, kind),
    count: catalog.scenarioFlowCounts.get(kind) ?? 0,
    swatch: legendByKind.value.get(kind),
  })),
)

const selected = computed({
  get: () => explorer.enabledFlowKinds,
  set: (value: FlowKind[]) => explorer.setFlowKinds(value),
})

const summary = computed(() => {
  if (explorer.enabledFlowKinds.length === FLOW_KIND_VALUES.length) return '全部类型'
  if (explorer.enabledFlowKinds.length === 0) return '未选择类型'
  return `${String(explorer.enabledFlowKinds.length)}/${String(FLOW_KIND_VALUES.length)} 类型`
})
</script>

<template>
  <ElPopover
    placement="bottom-start"
    trigger="click"
    :width="280"
  >
    <template #reference>
      <button
        type="button"
        class="filter-trigger"
        :class="{ 'is-filtered': !explorer.allFlowKindsSelected }"
      >
        数据流类型：{{ summary }}
      </button>
    </template>

    <div class="filter-panel">
      <ElCheckboxGroup v-model="selected">
        <ElCheckbox
          v-for="option in options"
          :key="option.kind"
          :value="option.kind"
          :disabled="option.count === 0"
        >
          <span class="filter-panel__row">
            <svg
              v-if="option.swatch"
              width="24"
              height="10"
              aria-hidden="true"
            >
              <line
                x1="1"
                y1="5"
                x2="23"
                y2="5"
                :stroke="option.swatch.color"
                :stroke-width="option.swatch.strokeWidth"
                :stroke-dasharray="
                  option.swatch.dashArray === '' ? undefined : option.swatch.dashArray
                "
                stroke-linecap="round"
              />
            </svg>
            <span>{{ option.label }}</span>
            <span class="filter-panel__count">{{ option.count }}</span>
          </span>
        </ElCheckbox>
      </ElCheckboxGroup>

      <div class="filter-panel__actions">
        <button
          type="button"
          @click="explorer.selectAllFlowKinds()"
        >
          全选
        </button>
        <button
          type="button"
          @click="explorer.clearFlowKinds()"
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
