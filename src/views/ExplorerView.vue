<script setup lang="ts">
import { computed, ref } from 'vue'

import FlowCanvas from '@/components/graph/FlowCanvas.vue'
import InspectorDrawer from '@/components/inspector/InspectorDrawer.vue'
import ValidationPanel from '@/components/inspector/ValidationPanel.vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import ScenarioSidebar from '@/components/layout/ScenarioSidebar.vue'
import StatusBar from '@/components/layout/StatusBar.vue'
import { useFocusReturn } from '@/composables/useFocusReturn'
import { useGraphController } from '@/composables/useGraphController'
import { useResponsiveLayout } from '@/composables/useResponsiveLayout'
import { useSelectionDetails } from '@/composables/useSelectionDetails'
import { takeIgnoredUrlParams, useUrlState } from '@/composables/useUrlState'
import { useCatalogStore } from '@/stores/catalog'
import { useExplorerStore } from '@/stores/explorer'

/**
 * The three-column desktop layout (DESIGN.md 12.2).
 *
 * The grid is `sidebar / canvas / inspector`, with the inspector column only
 * present while something is selected, so the canvas gets the space back when
 * nothing is. The canvas has an explicit height from the grid row: a Vue Flow
 * container that relies on its content to size itself collapses.
 *
 * This view is the container: it is the only place that reads the stores and
 * the selection resolution, and hands typed props to the leaf components.
 */
const explorer = useExplorerStore()
const catalog = useCatalogStore()
const controller = useGraphController()
const { details, review } = useSelectionDetails()

const collapsed = computed(() => explorer.leftPanelCollapsed)

/** The inspector column exists only while it has something to show. */
const inspectorOpen = computed(() => details.value !== null)

const validationOpen = ref(false)

// Called once at the view level: the URL bootstrap needs Pinia, and the stores
// it reads are the ones every child also uses. `takeIgnoredUrlParams` is
// synchronous, so the notice renders with the first paint rather than flashing
// in after mount.
useUrlState()

// Below 1280 px the sidebar is collapsed on entry to that range, which is what
// makes the layout a default rather than something the reader has to undo.
useResponsiveLayout()

// Closing the Inspector hands focus back to the node, edge or source row that
// opened it, so a keyboard reader is not dropped at the top of the document
// (DESIGN.md 16.2).
useFocusReturn(inspectorOpen)

/** Parameters present in the link but not understood; shown once, then dropped. */
const ignoredParams = ref<string[]>(takeIgnoredUrlParams())

/**
 * Turning a source row back into a graph element.
 *
 * The id may be folded into a larger element (an aggregated edge, a group), in
 * which case the element that contains it is selected; when nothing in the
 * current view stands for it there is simply nothing to highlight, and the
 * drawer keeps showing the row.
 */
function onSelectSourceItem(payload: { kind: 'component' | 'flow'; id: string }): void {
  controller.selectBySourceId(payload.kind, payload.id)
}

/** Reveals the file list so the path named in the panel can be found there. */
function onSelectFile(): void {
  explorer.setLeftPanelCollapsed(false)
}
</script>

<template>
  <div class="explorer-view">
    <AppHeader />

    <div
      class="explorer-view__body"
      :class="{ 'is-collapsed': collapsed, 'has-inspector': inspectorOpen }"
    >
      <ScenarioSidebar
        v-if="!collapsed"
        class="explorer-view__sidebar"
      />

      <main class="explorer-view__canvas">
        <ElAlert
          v-if="ignoredParams.length > 0"
          class="explorer-view__notice"
          type="info"
          :closable="true"
          show-icon
          title="链接中有无法识别的参数，已忽略"
        >
          {{ ignoredParams.join('、') }}
        </ElAlert>

        <FlowCanvas />

        <ValidationPanel
          v-if="validationOpen"
          class="explorer-view__validation"
          :issues="catalog.allIssues"
          @close="validationOpen = false"
          @select-file="onSelectFile"
        />
      </main>

      <InspectorDrawer
        v-if="inspectorOpen"
        class="explorer-view__inspector"
        :details="details"
        :review="review"
        @close="controller.clearSelection()"
        @select-source-item="onSelectSourceItem"
      />
    </div>

    <StatusBar @open-validation="validationOpen = true" />
  </div>
</template>

<style scoped>
.explorer-view {
  display: grid;
  /*
   * The column is stated rather than left implicit. An implicit track is
   * `auto`-sized, which means it grows to its contents' max-content size, and
   * `overflow: hidden` on the canvas does not stop that: a scroll container
   * still reports its contents' max-content size upward. The laid-out graph is
   * wider than a narrow window, so the track stretched to the drawing and the
   * whole page scrolled sideways — at 1024 px the document was 1439 px wide.
   *
   * `minmax(0, 1fr)` caps the track at the container, which is what the canvas
   * is for: it clips and pans its own contents (DESIGN.md 12.2).
   */
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: var(--header-height) minmax(0, 1fr) var(--statusbar-height);
  height: 100%;
}

/*
 * The inspector column appears only when there is a selection, so the canvas
 * gets the space back when nothing is chosen (DESIGN.md 12.2).
 */
.explorer-view__body {
  position: relative;
  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  min-height: 0;
}

.explorer-view__body.has-inspector {
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr) var(--inspector-width);
}

.explorer-view__body.is-collapsed,
.explorer-view__body.is-collapsed.has-inspector {
  grid-template-columns: minmax(0, 1fr) var(--inspector-width);
}

.explorer-view__body.is-collapsed:not(.has-inspector) {
  grid-template-columns: minmax(0, 1fr);
}

.explorer-view__sidebar,
.explorer-view__inspector {
  min-height: 0;
  min-width: 0;
}

.explorer-view__canvas {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.explorer-view__notice {
  margin: var(--space-3) var(--space-3) 0;
}

/* Floats over the canvas so opening it never resizes the graph. */
.explorer-view__validation {
  position: absolute;
  left: var(--space-4);
  right: var(--space-4);
  bottom: var(--space-4);
  z-index: 3;
  max-width: 880px;
  margin: 0 auto;
}

/*
 * Below 1280 px the sidebar is dropped and the inspector becomes an overlay
 * drawer; the canvas keeps the full width either way (DESIGN.md 12.2).
 *
 * The overlays are anchored to the body box rather than to the viewport, so
 * they stay correct when the header wraps to two rows at the narrower widths.
 */
@media (max-width: 1279px) {
  .explorer-view__body,
  .explorer-view__body.has-inspector,
  .explorer-view__body.is-collapsed,
  .explorer-view__body.is-collapsed.has-inspector {
    grid-template-columns: minmax(0, 1fr);
  }

  .explorer-view__inspector {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(var(--inspector-width), 100%);
    z-index: 4;
    box-shadow: var(--shadow-lg);
  }
}

/*
 * Below 960 px both side panels are overlays and the toolbar wraps onto its own
 * row. The viewer stays usable, but a full editing experience on a phone is
 * explicitly not promised (DESIGN.md 12.2).
 */
@media (max-width: 959px) {
  .explorer-view {
    grid-template-rows: auto minmax(0, 1fr) var(--statusbar-height);
  }

  .explorer-view__sidebar {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(var(--sidebar-width), 100%);
    z-index: 4;
    box-shadow: var(--shadow-lg);
  }
}
</style>
