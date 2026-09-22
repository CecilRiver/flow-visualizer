<script setup lang="ts">
import { computed } from 'vue'

import FolderActions from '@/components/toolbar/FolderActions.vue'
import GraphActions from '@/components/toolbar/GraphActions.vue'
import LevelSwitcher from '@/components/toolbar/LevelSwitcher.vue'
import ScenarioSelector from '@/components/toolbar/ScenarioSelector.vue'
import FlowKindFilter from '@/components/toolbar/FlowKindFilter.vue'
import VerificationFilter from '@/components/toolbar/VerificationFilter.vue'
import { useCatalogStore } from '@/stores/catalog'

/**
 * Application header (DESIGN.md 15.3).
 *
 * The toolbar only appears once there is a catalog to act on; on the welcome
 * page it would offer controls that do nothing.
 */
const catalog = useCatalogStore()

const showToolbar = computed(() => catalog.hasContent)
</script>

<template>
  <header class="app-header">
    <div class="app-header__brand">
      <h1 class="app-header__title">
        业务流程查看器
      </h1>
      <span class="app-header__version">Schema 0.1</span>
    </div>

    <div
      v-if="showToolbar"
      class="app-header__tools"
    >
      <ScenarioSelector />
      <LevelSwitcher />
      <FlowKindFilter />
      <VerificationFilter />
    </div>

    <div class="app-header__right">
      <GraphActions v-if="showToolbar" />
      <FolderActions />
    </div>
  </header>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: var(--header-height);
  padding: 0 var(--space-4);
  background: var(--surface-panel);
  border-bottom: 1px solid var(--border-subtle);
  flex: none;
}

.app-header__brand {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  flex: none;
}

.app-header__title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 600;
}

.app-header__version {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
}

.app-header__tools {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}

.app-header__right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-left: auto;
  flex: none;
}

/*
 * Below 960 px the controls no longer fit on one row beside the title, so the
 * toolbar wraps under it instead of being squeezed into a horizontal scroller
 * (DESIGN.md 12.2). The header grows and the grid row follows it.
 */
@media (max-width: 959px) {
  .app-header {
    flex-wrap: wrap;
    height: auto;
    min-height: var(--header-height);
    padding: var(--space-2) var(--space-4);
    row-gap: var(--space-2);
  }

  .app-header__tools {
    order: 3;
    flex-basis: 100%;
    flex-wrap: wrap;
    overflow-x: visible;
  }
}
</style>
