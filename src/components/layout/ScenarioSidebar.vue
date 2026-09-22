<script setup lang="ts">
import { computed } from 'vue'

import { REVIEW_STATUS_LABEL, VERIFICATION_SHORT_LABEL, labelFor } from '@/domain/labels'
import { useCatalogStore } from '@/stores/catalog'
import { useExplorerStore } from '@/stores/explorer'

/**
 * The left panel: which model and scenario is on screen, and what was wrong
 * with the files that did not load (DESIGN.md 12.3).
 *
 * Invalid files are listed rather than hidden. A folder that half-loaded is a
 * fact the reader needs, and silently showing only the valid bundle would
 * suggest the extraction was complete.
 */
const catalog = useCatalogStore()
const explorer = useExplorerStore()

const bundle = computed(() => catalog.activeBundle)

const metadata = computed(() => {
  const model = bundle.value?.bundle.model
  if (model === undefined) return null
  return {
    title: model.title,
    vehicle: model.vehicle,
    description: model.description,
    reviewStatus: labelFor(REVIEW_STATUS_LABEL, model.review_status),
    generatedOn: model.generated_on,
    levels: model.scope.levels.join(' / '),
  }
})

const scenarios = computed(() =>
  (bundle.value?.bundle.scenarios ?? []).map((scenario) => ({
    id: scenario.id,
    name: scenario.name,
    flowCount: scenario.flow_ids.length,
    verificationLabel: labelFor(VERIFICATION_SHORT_LABEL, scenario.verification),
  })),
)

const warnings = computed(() => bundle.value?.warnings ?? [])

function selectScenario(id: string): void {
  catalog.activateScenario(id)
  explorer.setLeftPanelCollapsed(false)
}
</script>

<template>
  <aside
    class="scenario-sidebar"
    aria-label="场景与模型信息"
  >
    <section
      v-if="metadata"
      class="scenario-sidebar__section"
    >
      <h2 class="scenario-sidebar__title">
        {{ metadata.title }}
      </h2>
      <dl class="scenario-sidebar__meta">
        <dt>载体</dt>
        <dd>{{ metadata.vehicle }}</dd>
        <dt>图层</dt>
        <dd>{{ metadata.levels }}</dd>
        <dt>评审</dt>
        <dd>{{ metadata.reviewStatus }}</dd>
        <dt>生成于</dt>
        <dd>{{ metadata.generatedOn }}</dd>
      </dl>
      <p class="scenario-sidebar__description">
        {{ metadata.description }}
      </p>
    </section>

    <section class="scenario-sidebar__section">
      <h2 class="scenario-sidebar__heading">
        场景（{{ scenarios.length }}）
      </h2>
      <ul class="scenario-sidebar__list">
        <li
          v-for="scenario in scenarios"
          :key="scenario.id"
        >
          <button
            type="button"
            class="scenario-sidebar__scenario"
            :class="{ 'is-active': catalog.activeScenarioId === scenario.id }"
            :aria-current="catalog.activeScenarioId === scenario.id ? 'true' : undefined"
            @click="selectScenario(scenario.id)"
          >
            <span class="scenario-sidebar__scenario-name u-clamp-2">{{ scenario.name }}</span>
            <span class="scenario-sidebar__scenario-count">
              {{ scenario.flowCount }} 条流 · {{ scenario.verificationLabel }}
            </span>
          </button>
        </li>
      </ul>
    </section>

    <section
      v-if="catalog.invalidBundles.length > 0"
      class="scenario-sidebar__section"
    >
      <h2 class="scenario-sidebar__heading scenario-sidebar__heading--error">
        未能加载（{{ catalog.invalidBundles.length }}）
      </h2>
      <ul class="scenario-sidebar__list">
        <li
          v-for="invalid in catalog.invalidBundles"
          :key="invalid.id"
          class="scenario-sidebar__invalid"
        >
          <span class="u-truncate">{{ invalid.modelTitle ?? invalid.relativePath }}</span>
          <ul class="scenario-sidebar__issues">
            <li
              v-for="(issue, index) in invalid.issues.slice(0, 4)"
              :key="index"
            >
              <span class="scenario-sidebar__path">{{ issue.relativePath }}</span>
              {{ issue.message }}
            </li>
          </ul>
        </li>
      </ul>
    </section>

    <section
      v-if="warnings.length > 0 || catalog.issues.length > 0"
      class="scenario-sidebar__section"
    >
      <h2 class="scenario-sidebar__heading">
        提示
      </h2>
      <ul class="scenario-sidebar__issues">
        <li
          v-for="(issue, index) in [...catalog.issues, ...warnings].slice(0, 8)"
          :key="index"
        >
          <span class="scenario-sidebar__path">{{ issue.relativePath }}</span>
          {{ issue.message }}
        </li>
      </ul>
    </section>
  </aside>
</template>

<style scoped>
.scenario-sidebar {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  background: var(--surface-panel);
  border-right: 1px solid var(--border-subtle);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.scenario-sidebar__section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.scenario-sidebar__title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 600;
}

.scenario-sidebar__heading {
  margin: 0;
  font-size: var(--font-size-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.scenario-sidebar__heading--error {
  color: var(--status-conflict);
}

.scenario-sidebar__meta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-1) var(--space-3);
  margin: 0;
  font-size: var(--font-size-xs);
}

.scenario-sidebar__meta dt {
  color: var(--text-muted);
}

.scenario-sidebar__meta dd {
  margin: 0;
  color: var(--text-secondary);
}

.scenario-sidebar__description {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.scenario-sidebar__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.scenario-sidebar__scenario {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
  padding: var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: none;
  font: inherit;
  text-align: left;
  color: var(--text-secondary);
  cursor: pointer;
}

.scenario-sidebar__scenario:hover {
  background: var(--surface-sunken);
}

.scenario-sidebar__scenario.is-active {
  background: var(--surface-sunken);
  border-color: var(--focus-ring);
  color: var(--text-primary);
}

.scenario-sidebar__scenario-name {
  font-size: var(--font-size-md);
}

.scenario-sidebar__scenario-count {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
}

.scenario-sidebar__invalid {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--font-size-xs);
  color: var(--status-conflict);
}

.scenario-sidebar__issues {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}

.scenario-sidebar__path {
  font-family: var(--font-mono);
  color: var(--text-muted);
  margin-right: var(--space-1);
}
</style>
