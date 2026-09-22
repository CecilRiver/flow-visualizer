import { defineStore } from 'pinia'

import { FLOW_KIND_VALUES, VERIFICATION_VALUES } from '@/app/urlState'
import { GRAPH_LEVELS, type FlowKind, type GraphLevel, type Verification } from '@/domain/model'
import type { GraphSelection } from '@/domain/view-model'

/**
 * High-frequency view state (DESIGN.md 8.3): level, filters, panel visibility
 * and selection.
 *
 * Transient Vue Flow state — viewport, hover, drag — deliberately stays inside
 * the canvas component. Nodes are not user-draggable in v0.2, so a hand-placed
 * coordinate can never become a second source of truth competing with ELK.
 *
 * Whether a selection still exists in the current projection is decided by
 * `useGraphController`, which is the only place that holds the projected graph;
 * this store just records what the user picked.
 */

export interface ExplorerState {
  level: GraphLevel
  enabledFlowKinds: FlowKind[]
  enabledVerificationStates: Verification[]
  leftPanelCollapsed: boolean
  inspectorOpen: boolean
  selection: GraphSelection | null
}

/** Every filter is on by default: low-confidence evidence is never hidden. */
function defaultFlowKinds(): FlowKind[] {
  return [...FLOW_KIND_VALUES]
}

function defaultVerifications(): Verification[] {
  return [...VERIFICATION_VALUES]
}

export const useExplorerStore = defineStore('explorer', {
  state: (): ExplorerState => ({
    level: 2,
    enabledFlowKinds: defaultFlowKinds(),
    enabledVerificationStates: defaultVerifications(),
    leftPanelCollapsed: false,
    inspectorOpen: false,
    selection: null,
  }),

  getters: {
    allFlowKindsSelected: (state): boolean =>
      state.enabledFlowKinds.length === FLOW_KIND_VALUES.length,

    allVerificationsSelected: (state): boolean =>
      state.enabledVerificationStates.length === VERIFICATION_VALUES.length,

    /** True when the filters leave nothing to draw (DESIGN.md 15.1). */
    filtersHideEverything: (state): boolean =>
      state.enabledFlowKinds.length === 0 || state.enabledVerificationStates.length === 0,
  },

  actions: {
    setLevel(level: GraphLevel): void {
      if (!GRAPH_LEVELS.includes(level) || this.level === level) return
      this.level = level
      // Node ids from the previous projection do not exist any more.
      this.clearSelection()
    },

    setFlowKinds(kinds: readonly FlowKind[]): void {
      this.enabledFlowKinds = [...kinds]
    },

    setVerificationStates(states: readonly Verification[]): void {
      this.enabledVerificationStates = [...states]
    },

    selectAllFlowKinds(): void {
      this.enabledFlowKinds = defaultFlowKinds()
    },

    clearFlowKinds(): void {
      this.enabledFlowKinds = []
    },

    resetFlowKinds(): void {
      this.enabledFlowKinds = defaultFlowKinds()
    },

    selectAllVerifications(): void {
      this.enabledVerificationStates = defaultVerifications()
    },

    clearVerifications(): void {
      this.enabledVerificationStates = []
    },

    resetVerifications(): void {
      this.enabledVerificationStates = defaultVerifications()
    },

    select(selection: GraphSelection | null): void {
      this.selection = selection
      this.inspectorOpen = selection !== null
    },

    clearSelection(): void {
      this.selection = null
      this.inspectorOpen = false
    },

    toggleLeftPanel(): void {
      this.leftPanelCollapsed = !this.leftPanelCollapsed
    },

    setLeftPanelCollapsed(collapsed: boolean): void {
      this.leftPanelCollapsed = collapsed
    },

    closeInspector(): void {
      this.inspectorOpen = false
    },

    reset(): void {
      this.level = 2
      this.enabledFlowKinds = defaultFlowKinds()
      this.enabledVerificationStates = defaultVerifications()
      this.selection = null
      this.inspectorOpen = false
    },
  },
})
