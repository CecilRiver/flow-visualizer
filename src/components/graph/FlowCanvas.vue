<script setup lang="ts">
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import {
  VueFlow,
  useVueFlow,
  type EdgeComponent,
  type EdgeMouseEvent,
  type EdgeTypesObject,
  type NodeComponent,
  type NodeMouseEvent,
  type NodeTypesObject,
} from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import { computed, markRaw, onBeforeUnmount, onMounted } from 'vue'

import { EDGE_TYPE } from '@/adapters/vueFlow/edgeTypes'
import { NODE_TYPE } from '@/adapters/vueFlow/nodeTypes'
import { levelLabel } from '@/adapters/vueFlow/toVueFlowElements'
import {
  selectionForEdge,
  selectionForNode,
  useGraphController,
} from '@/composables/useGraphController'
import { NODE_SURFACE, verificationTokenNameOf } from '@/styles/semanticTokens'

import BusinessComponentNode from './BusinessComponentNode.vue'
import DomainGroupNode from './DomainGroupNode.vue'
import ExternalBoundaryNode from './ExternalBoundaryNode.vue'
import GraphEmptyState from './GraphEmptyState.vue'
import GraphLegend from './GraphLegend.vue'
import SemanticFlowEdge from './SemanticFlowEdge.vue'
import { provideZoomBucket } from './graphRenderContext'

/**
 * The graph surface (DESIGN.md 10.5).
 *
 * Vue Flow is given elements and reports interactions back; it never becomes a
 * second source of truth. Node positions come from the layout, and a click only
 * ever sets the selection in the store.
 */

const controller = useGraphController()

/**
 * The Vue Flow instance this canvas owns, addressed by name.
 *
 * `useVueFlow()` with no id does not find the store the child `<VueFlow>` will
 * create — it makes a *new* one. This component is that child's parent, so
 * there is no providing ancestor to inject from and the bare call would silently
 * produce a second, empty store. Naming the instance on both sides is what makes
 * them the same one, and the zoom band, the viewport fit and the rendered
 * elements all have to be describing the same graph.
 */
const FLOW_ID = 'flow-canvas'

const { viewport } = useVueFlow(FLOW_ID)

/*
 * The band, not the zoom factor. Edges read this to decide whether their labels
 * are drawn at all; handing them the raw factor would re-render every label on
 * every wheel tick for a change that only matters at two thresholds
 * (GRAPH_READABILITY_DESIGN.md 5.3).
 */
provideZoomBucket(computed(() => viewport.value.zoom))

/**
 * `markRaw` keeps Vue from deep-reactifying the component definitions on every
 * render — they are constants, not state.
 */
const nodeTypes: NodeTypesObject = {
  [NODE_TYPE.business]: markRaw(BusinessComponentNode) as NodeComponent,
  [NODE_TYPE.external]: markRaw(ExternalBoundaryNode) as NodeComponent,
  [NODE_TYPE.group]: markRaw(DomainGroupNode) as NodeComponent,
}

const edgeTypes: EdgeTypesObject = {
  [EDGE_TYPE.semantic]: markRaw(SemanticFlowEdge) as EdgeComponent,
}

const elements = computed(() => controller.elements.value)
const status = computed(() => controller.status.value)

/**
 * The canvas is blank whenever no layout has been applied yet, and that is a
 * layout in flight rather than an empty result.
 *
 * Derived from the layout itself instead of from `status`, because the status
 * reports the more specific data condition: a filter combination is
 * `empty-by-filter` from the moment the filter changes, while its re-layout is
 * still running behind it. Reading the status would leave the user staring at a
 * blank canvas with no indication that anything is happening.
 */
const busy = computed(() => status.value !== 'no-scenario' && controller.layout.value === null)

/**
 * The canvas is only covered when there is genuinely nothing to draw.
 *
 * When the filters removed every flow, the nodes stay on screen (DESIGN.md
 * 15.1) and the notice is a banner instead — replacing them would hide the
 * scenario's structure exactly when the reader is trying to find it again.
 */
const showEmpty = computed(
  () =>
    (status.value === 'ready' || status.value === 'empty-by-filter') &&
    elements.value.nodes.length === 0,
)

const showFilterNotice = computed(
  () => status.value === 'empty-by-filter' && elements.value.nodes.length > 0,
)

/**
 * Minimap swatches read the same verification tokens the nodes do, so the
 * overview never disagrees with the canvas (DESIGN.md 15.2).
 */
function minimapNodeColor(node: { type?: string; data?: unknown }): string {
  if (node.type === NODE_TYPE.group) return NODE_SURFACE.groupSurface
  const data = node.data as { verification?: string } | undefined
  const verification = data?.verification
  if (verification !== undefined) {
    return `var(${verificationTokenNameOf(verification)})`
  }
  return NODE_SURFACE.groupSurface
}

/** Selecting by projected id, so click and keyboard share one path. */
function selectNodeById(id: string): void {
  const projected = [
    ...controller.graph.value.nodes,
    ...controller.graph.value.groups,
  ].find((entry) => entry.id === id)
  if (projected === undefined) return
  controller.select(selectionForNode(projected))
}

function selectEdgeById(id: string): void {
  const projected = controller.graph.value.edges.find((entry) => entry.id === id)
  if (projected === undefined) return
  controller.select(selectionForEdge(projected))
}

function onNodeClick({ node }: NodeMouseEvent): void {
  selectNodeById(node.id)
}

function onEdgeClick({ edge }: EdgeMouseEvent): void {
  selectEdgeById(edge.id)
}

/** Interactive chrome inside a node or edge keeps its own key handling. */
function isFormControl(target: Element | null): boolean {
  return target?.closest('button, a, input, select, textarea, [contenteditable]') !== null
}

/**
 * Keyboard selection of nodes and edges (DESIGN.md 16.2).
 *
 * Vue Flow does bind `Enter`/`Space` on a focused node or edge, but its handler
 * only sets the *internal* selection: it never emits `nodeClick`, so the store
 * would not learn about it and no Inspector would open. The internal flag also
 * does not survive the next projection, which would leave a `.selected` outline
 * on an element the application does not consider selected — Vue Flow acting as
 * a second source of truth, which the canvas exists to prevent.
 *
 * So the key is handled here, in the capture phase, before Vue Flow's own
 * wrapper handler: the selection goes to the store, and the diverging internal
 * state is never written.
 *
 * Bound to the canvas root rather than to the window: the focused element is
 * always inside this subtree, so there is no reason to watch the whole document
 * for it. `Escape` is the exception and stays on the window — see `onKeydown`.
 */
function onKeydownCapture(event: KeyboardEvent): void {
  if (event.key !== 'Enter' && event.key !== ' ') return
  if (event.repeat) return

  const target = event.target instanceof Element ? event.target : null
  if (target === null || isFormControl(target)) return

  const nodeElement = target.closest('.vue-flow__node')
  const edgeElement = nodeElement === null ? target.closest('.vue-flow__edge') : null
  const owner = nodeElement ?? edgeElement
  if (owner === null) return

  const id = owner.getAttribute('data-id')
  if (id === null || id === '') return

  // Claimed: stop Vue Flow's wrapper handler from also acting on the key.
  event.preventDefault()
  event.stopPropagation()

  if (nodeElement !== null) selectNodeById(id)
  else selectEdgeById(id)
}

/** Clicking the background clears the selection, like `Esc` (DESIGN.md 13.5). */
function onPaneClick(): void {
  controller.clearSelection()
}

/**
 * `Esc` is bound to the window rather than the canvas: the user's focus is
 * usually on the element they just clicked, which may be outside this subtree.
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') controller.clearSelection()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    class="flow-canvas"
    @keydown.capture="onKeydownCapture"
  >
    <VueFlow
      :id="FLOW_ID"
      :nodes="elements.nodes"
      :edges="elements.edges"
      :node-types="nodeTypes"
      :edge-types="edgeTypes"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="true"
      :edges-updatable="false"
      :min-zoom="0.15"
      :max-zoom="2.5"
      :fit-view-on-init="true"
      :zoom-on-double-click="false"
      class="flow-canvas__surface"
      @node-click="onNodeClick"
      @edge-click="onEdgeClick"
      @pane-click="onPaneClick"
    >
      <Background
        :gap="20"
        :size="1"
        pattern-color="#dfe5ee"
      />
      <Controls :show-interactive="false" />
      <MiniMap
        pannable
        zoomable
        :node-color="minimapNodeColor"
      />
    </VueFlow>

    <GraphLegend class="flow-canvas__legend" />

    <div
      v-if="busy"
      class="flow-canvas__busy"
      role="status"
      aria-live="polite"
    >
      正在布局 {{ levelLabel(controller.level.value) }}…
    </div>

    <p
      v-if="showFilterNotice"
      class="flow-canvas__filter-notice"
      role="status"
    >
      当前筛选条件下没有可见的数据流，仅显示场景声明的节点。
    </p>

    <GraphEmptyState
      v-if="showEmpty"
      :by-filter="status === 'empty-by-filter'"
    />

    <p class="flow-canvas__disclaimer">
      语义数据依赖图，非单次循环严格时序
    </p>
  </div>
</template>

<style scoped>
.flow-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--graph-canvas-bg);
}

.flow-canvas__surface {
  width: 100%;
  height: 100%;
}

.flow-canvas__legend {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  z-index: 2;
}

.flow-canvas__busy {
  position: absolute;
  top: var(--space-3);
  left: 50%;
  transform: translateX(-50%);
  padding: var(--space-1) var(--space-3);
  background: var(--surface-panel);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-sm);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  z-index: 2;
}

.flow-canvas__filter-notice {
  position: absolute;
  top: var(--space-3);
  left: var(--space-3);
  margin: 0;
  padding: var(--space-1) var(--space-3);
  max-width: 46ch;
  background: var(--status-docs-bg);
  border: 1px solid var(--status-docs);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  z-index: 2;
}

/* Permanent notice: the drawing is not a timeline (DESIGN.md 13.1). */
.flow-canvas__disclaimer {
  position: absolute;
  left: var(--space-3);
  bottom: var(--space-3);
  margin: 0;
  padding: var(--space-1) var(--space-3);
  background: var(--surface-panel);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  z-index: 2;
  pointer-events: none;
}

/* Dim unrelated elements by class rather than by re-filtering the graph. */
.flow-canvas__surface :deep(.vue-flow__node.is-dimmed) {
  opacity: var(--graph-dimmed-opacity);
}

.flow-canvas__surface :deep(.vue-flow__node.is-highlighted) {
  outline: 2px solid var(--graph-selection);
  outline-offset: 2px;
  border-radius: var(--radius-lg);
}
</style>
