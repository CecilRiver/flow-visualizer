<script setup lang="ts">
import { computed } from 'vue'

import { useCatalogStore } from '@/stores/catalog'

/**
 * Bundle and scenario picker (DESIGN.md 8.2).
 *
 * A folder can hold several `*.flow.yaml` files, and each one several
 * scenarios. Both lists come straight from the catalog, so switching one never
 * leaves the other pointing at something that no longer exists.
 */
const catalog = useCatalogStore()

const bundles = computed(() =>
  catalog.validBundles.map((bundle) => ({
    id: bundle.id,
    label: bundle.bundle.model.title,
    relativePath: bundle.relativePath,
  })),
)

const scenarios = computed(() => {
  const bundle = catalog.activeBundle
  if (bundle === null) return []
  return bundle.bundle.scenarios.map((scenario) => ({
    id: scenario.id,
    label: scenario.name,
    flowCount: scenario.flow_ids.length,
  }))
})

const selectedBundle = computed({
  get: () => catalog.activeBundleId,
  set: (value: string | null) => {
    if (value !== null) catalog.activateBundle(value)
  },
})

const selectedScenario = computed({
  get: () => catalog.activeScenarioId,
  set: (value: string | null) => {
    if (value !== null) catalog.activateScenario(value)
  },
})
</script>

<template>
  <div class="scenario-selector">
    <ElSelect
      v-if="bundles.length > 1"
      v-model="selectedBundle"
      class="scenario-selector__bundle"
      placeholder="选择模型文件"
      aria-label="模型文件"
    >
      <ElOption
        v-for="bundle in bundles"
        :key="bundle.id"
        :label="bundle.label"
        :value="bundle.id"
      >
        <span class="scenario-selector__option">
          <span>{{ bundle.label }}</span>
          <span class="scenario-selector__path u-truncate">{{ bundle.relativePath }}</span>
        </span>
      </ElOption>
    </ElSelect>

    <ElSelect
      v-model="selectedScenario"
      class="scenario-selector__scenario"
      placeholder="选择场景"
      aria-label="场景"
      :disabled="scenarios.length === 0"
    >
      <ElOption
        v-for="scenario in scenarios"
        :key="scenario.id"
        :label="scenario.label"
        :value="scenario.id"
      >
        <span class="scenario-selector__option">
          <span>{{ scenario.label }}</span>
          <span class="scenario-selector__path">{{ scenario.flowCount }} 条流</span>
        </span>
      </ElOption>
    </ElSelect>
  </div>
</template>

<style scoped>
.scenario-selector {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.scenario-selector__bundle {
  width: 200px;
}

.scenario-selector__scenario {
  width: 220px;
}

.scenario-selector__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.scenario-selector__path {
  color: var(--text-muted);
  font-size: var(--font-size-xs);
  max-width: 46%;
}
</style>
