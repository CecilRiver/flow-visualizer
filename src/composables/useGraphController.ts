import { computed, effectScope, shallowRef, watch, type ComputedRef, type EffectScope } from 'vue'

import { toVueFlowElements, type VueFlowElements } from '@/adapters/vueFlow/toVueFlowElements'
import type { ModelIndex } from '@/domain/indexes'
import type { GraphLevel } from '@/domain/model'
import {
  createEmptyProjectedGraph,
  type GraphSelection,
  type ProjectedEdge,
  type ProjectedGraph,
  type ProjectedNode,
  type ScenarioSlice,
} from '@/domain/view-model'
import { computeFallbackLayout } from '@/layout/fallbackLayout'
import { layoutCacheKey, LayoutCache, layoutGraph, type LayoutResult } from '@/layout/elkLayout'
import { buildOrderMaps, projectScenario } from '@/projection/projectScenario'
import { selectScenario } from '@/projection/selectScenario'
import { useCatalogStore } from '@/stores/catalog'
import { useExplorerStore } from '@/stores/explorer'

/**
 * Owns everything between "which scenario and filters are selected" and "which
 * Vue Flow elements get drawn" (DESIGN.md 8.4).
 *
 * It is a module-level singleton because the canvas, the toolbar and the status
 * bar must agree on one projection and one layout; two instances would mean two
 * ELK runs and a status bar describing a graph nobody is looking at.
 *
 * Stores coordinate, but the graph algorithms live in `projection/` and
 * `layout/` — nothing here re-implements them.
 */

export type GraphStatus =
  | 'no-scenario'
  | 'empty-by-filter'
  | 'layout-running'
  | 'ready'
  | 'layout-fallback'

export interface GraphController {
  slice: ComputedRef<ScenarioSlice | null>
  graph: ComputedRef<ProjectedGraph>
  layout: ComputedRef<LayoutResult | null>
  elements: ComputedRef<VueFlowElements>
  status: ComputedRef<GraphStatus>
  /** Diagnostics from the last successful projection. */
  diagnostics: ComputedRef<ProjectedGraph['diagnostics']>
  layoutUsedFallback: ComputedRef<boolean>
  selection: ComputedRef<GraphSelection | null>
  level: ComputedRef<GraphLevel>
  /** True when a scenario exists but the filters removed every flow. */
  filtersHideEverything: ComputedRef<boolean>
  select: (selection: GraphSelection | null) => void
  clearSelection: () => void
  /**
   * Selects the projected element that contains a configuration id — the way
   * the Inspector turns a raw flow inside an aggregated edge back into a
   * highlightable element on the canvas (DESIGN.md 12.4).
   */
  selectBySourceId: (kind: 'component' | 'flow', id: string) => boolean
}

const layoutCache = new LayoutCache()

const sliceRef = shallowRef<ScenarioSlice | null>(null)
const graphRef = shallowRef<ProjectedGraph>(createEmptyProjectedGraph())
const layoutRef = shallowRef<LayoutResult | null>(null)
const layoutUsedFallbackRef = shallowRef(false)

/**
 * Monotonic token: a layout result is only applied when it belongs to the most
 * recent request, so a slow ELK run can never overwrite a newer graph
 * (DESIGN.md 11.2).
 */
let layoutToken = 0

async function runLayout(): Promise<void> {
  const token = ++layoutToken
  const graph = graphRef.value

  if (graph.nodes.length === 0 && graph.groups.length === 0) {
    layoutRef.value = { nodes: [], edges: [], width: 0, height: 0 }
    layoutUsedFallbackRef.value = false
    return
  }

  const catalog = useCatalogStore()
  const explorer = useExplorerStore()
  const bundle = catalog.activeBundle

  const key = layoutCacheKey({
    bundleId: bundle?.id ?? '',
    revision: bundle?.schemaVersion ?? '',
    scenarioId: catalog.activeScenarioId ?? '',
    level: explorer.level,
    flowKinds: explorer.enabledFlowKinds,
    verificationStates: explorer.enabledVerificationStates,
  })

  // A cache hit is applied synchronously so returning to a previous filter
  // combination never flashes the "layout running" state.
  const cached = layoutCache.get(key)
  if (cached !== undefined) {
    if (token !== layoutToken) return
    layoutRef.value = cached
    layoutUsedFallbackRef.value = false
    return
  }

  // Clearing the previous layout is deliberate: positions belong to the graph
  // they were computed for, and drawing the old ones under the new graph would
  // show nodes in places ELK never chose.
  layoutRef.value = null

  try {
    const result = await layoutGraph(key, graph, layoutCache)
    if (token !== layoutToken) return
    layoutRef.value = result
    layoutUsedFallbackRef.value = false
  } catch {
    // ELK failing is a layout problem, not a data problem: the graph is still
    // meaningful, so it is drawn with the deterministic column fallback and the
    // UI says so plainly (DESIGN.md 10.4).
    if (token !== layoutToken) return
    layoutRef.value = computeFallbackLayout(graph)
    layoutUsedFallbackRef.value = true
  }
}

function selectionExists(selection: GraphSelection, graph: ProjectedGraph): boolean {
  if (selection.kind === 'node') {
    return (
      graph.nodes.some((node) => node.id === selection.projectedId) ||
      graph.groups.some((group) => group.id === selection.projectedId)
    )
  }
  return graph.edges.some((edge) => edge.id === selection.projectedId)
}

/** Nodes and edges reachable from the selection in one hop, for highlighting. */
function neighbourhood(
  selection: GraphSelection | null,
  graph: ProjectedGraph,
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()
  if (selection === null) return { nodeIds, edgeIds }

  if (selection.kind === 'node') {
    nodeIds.add(selection.projectedId)
    // A group highlights its children: they are one thing conceptually.
    for (const node of graph.nodes) {
      if (node.parentGroupId === selection.projectedId) nodeIds.add(node.id)
    }
    for (const edge of graph.edges) {
      if (edge.source === selection.projectedId || edge.target === selection.projectedId) {
        edgeIds.add(edge.id)
        nodeIds.add(edge.source)
        nodeIds.add(edge.target)
      }
    }
    return { nodeIds, edgeIds }
  }

  edgeIds.add(selection.projectedId)
  const edge = graph.edges.find((entry) => entry.id === selection.projectedId)
  if (edge !== undefined) {
    nodeIds.add(edge.source)
    nodeIds.add(edge.target)
  }
  return { nodeIds, edgeIds }
}

export function selectionForNode(node: ProjectedNode): GraphSelection {
  return { kind: 'node', projectedId: node.id, sourceComponentIds: [...node.sourceComponentIds] }
}

export function selectionForEdge(edge: ProjectedEdge): GraphSelection {
  return { kind: 'edge', projectedId: edge.id, sourceFlowIds: [...edge.sourceFlowIds] }
}

const slice = computed(() => sliceRef.value)
const graph = computed(() => graphRef.value)
const layout = computed(() => layoutRef.value)
const layoutUsedFallback = computed(() => layoutUsedFallbackRef.value)
const diagnostics = computed(() => graphRef.value.diagnostics)

/**
 * Watchers live in a detached scope created on first use, because at module
 * load time Pinia is not installed yet and `useStore()` would throw.
 */
let controllerScope: EffectScope | null = null

function ensureControllerScope(): void {
  if (controllerScope !== null) return

  controllerScope = effectScope(true)
  controllerScope.run(() => {
    const catalog = useCatalogStore()
    const explorer = useExplorerStore()

    const sliceState = computed(() => {
      const bundle = catalog.activeBundle
      const scenarioId = catalog.activeScenarioId
      if (bundle === null || scenarioId === null) {
        return { slice: null, index: null as ModelIndex | null }
      }
      return {
        slice: selectScenario({ scenarioId, index: bundle.index }),
        index: bundle.index,
      }
    })

    watch(
      sliceState,
      (state) => {
        sliceRef.value = state.slice
      },
      { immediate: true },
    )

    const orderMaps = computed(() => {
      const bundle = catalog.activeBundle
      return bundle === null ? null : buildOrderMaps(bundle.bundle)
    })

    // The projection is pure and synchronous; filters are applied here, before
    // any aggregation, so every count in the UI matches what is drawn.
    watch(
      [sliceState, orderMaps, () => explorer.level, () => explorer.enabledFlowKinds, () => explorer.enabledVerificationStates],
      () => {
        const { slice: currentSlice, index } = sliceState.value
        const order = orderMaps.value
        if (currentSlice === null || index === null || order === null) {
          graphRef.value = createEmptyProjectedGraph()
          return
        }

        graphRef.value = projectScenario({
          slice: currentSlice,
          index,
          level: explorer.level,
          filters: {
            enabledFlowKinds: explorer.enabledFlowKinds,
            enabledVerificationStates: explorer.enabledVerificationStates,
          },
          order,
        })

        // A selection only survives while its projected id still exists; a level
        // switch or a filter change can retire it (DESIGN.md 8.3).
        const selection = explorer.selection
        if (selection !== null && !selectionExists(selection, graphRef.value)) {
          explorer.clearSelection()
        }
      },
      { immediate: true },
    )

    // Identity, not contents: every projection produces a fresh graph object, so
    // this fires exactly once per new picture and starts exactly one ELK run.
    watch(
      graphRef,
      () => {
        void runLayout()
      },
      { immediate: true },
    )
  })
}

const selection = computed(() => useExplorerStore().selection)

const highlights = computed(() => neighbourhood(selection.value, graphRef.value))

const elements = computed<VueFlowElements>(() => {
  const currentLayout = layoutRef.value
  if (currentLayout === null) return { nodes: [], edges: [] }
  const bundle = useCatalogStore().activeBundle
  return toVueFlowElements({
    graph: graphRef.value,
    layout: currentLayout,
    level: useExplorerStore().level,
    componentsById: bundle?.index.componentsById ?? new Map(),
    highlightedNodeIds: highlights.value.nodeIds,
    highlightedEdgeIds: highlights.value.edgeIds,
    hasSelection: selection.value !== null,
  })
})

const filtersHideEverything = computed(() => {
  const explorer = useExplorerStore()
  const catalog = useCatalogStore()
  return explorer.filtersHideEverything && catalog.activeScenarioId !== null
})

const status = computed<GraphStatus>(() => {
  const catalog = useCatalogStore()
  if (catalog.activeScenarioId === null) return 'no-scenario'
  if (filtersHideEverything.value) return 'empty-by-filter'
  if (layoutRef.value === null) return 'layout-running'
  if (layoutUsedFallbackRef.value) return 'layout-fallback'
  return 'ready'
})

/**
 * The projected element a raw configuration id landed on, if the current view
 * still shows one.
 *
 * A flow folded into a self-loop has no edge of its own, and a component below
 * the current level has no node of its own; both cases return false rather than
 * selecting something arbitrary.
 */
function findBySourceId(kind: 'component' | 'flow', id: string): GraphSelection | null {
  const current = graphRef.value
  if (kind === 'component') {
    const node =
      current.nodes.find((entry) => entry.sourceComponentIds.includes(id)) ??
      current.groups.find((entry) => entry.sourceComponentIds.includes(id))
    return node === undefined ? null : selectionForNode(node)
  }
  const edge = current.edges.find((entry) => entry.sourceFlowIds.includes(id))
  return edge === undefined ? null : selectionForEdge(edge)
}

export function useGraphController(): GraphController {
  ensureControllerScope()
  const explorer = useExplorerStore()

  return {
    slice,
    graph,
    layout,
    elements,
    status,
    diagnostics,
    layoutUsedFallback,
    selection,
    level: computed(() => explorer.level),
    filtersHideEverything,
    select: (next) => explorer.select(next),
    clearSelection: () => explorer.clearSelection(),
    selectBySourceId: (kind, id) => {
      const selection = findBySourceId(kind, id)
      if (selection === null) return false
      explorer.select(selection)
      return true
    },
  }
}

/** Test seam: drops memoised layouts so a suite starts from a known state. */
export function resetGraphControllerCache(): void {
  layoutCache.clear()
}
