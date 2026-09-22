import { defineStore } from 'pinia'

import { loadFolderCatalog, type CatalogProgress, type CatalogStatus } from '@/catalog/loadFolderCatalog'
import type { InvalidBundleSummary, LoadedBundle } from '@/domain/indexes'
import type { ValidationIssue } from '@/domain/validation'
import type { FolderSnapshot } from '@/filesystem/types'

/**
 * Catalog state (DESIGN.md 8.2).
 *
 * The catalog only ever accepts a finished scan and replaces the previous
 * folder in one commit, so the sidebar can never show two folders' contents at
 * once.
 */

export type CatalogStoreStatus = 'idle' | 'loading' | CatalogStatus

export interface ReplaceFromSnapshotOptions {
  snapshot: FolderSnapshot
  scanId: number
  isCurrent?: () => boolean
  onProgress?: (progress: CatalogProgress) => void
}

export const useCatalogStore = defineStore('catalog', {
  state: () => ({
    status: 'idle' as CatalogStoreStatus,
    validBundles: [] as LoadedBundle[],
    invalidBundles: [] as InvalidBundleSummary[],
    /** Folder-level problems: nothing found, limits exceeded, unreadable files. */
    issues: [] as ValidationIssue[],
    activeBundleId: null as string | null,
    activeScenarioId: null as string | null,
    progress: { discovered: 0, processed: 0, valid: 0, invalid: 0, ignored: 0 } as CatalogProgress,
    /** Set while a load is in flight so the UI can show a blocking state. */
    loading: false,
  }),

  getters: {
    activeBundle(state): LoadedBundle | null {
      if (state.activeBundleId === null) return null
      return state.validBundles.find((bundle) => bundle.id === state.activeBundleId) ?? null
    },

    /** Every bundle, valid or not, for the sidebar's file list. */
    totalFiles(state): number {
      return state.validBundles.length + state.invalidBundles.length
    },

    hasContent(state): boolean {
      return state.validBundles.length > 0 || state.invalidBundles.length > 0
    },

    /**
     * Every issue in the catalog, in the order the panel lists them: folder
     * problems, then each invalid file's issues, then the warnings of the files
     * that did load.
     *
     * One list rather than three, so the status bar's counts and the panel's
     * rows can never disagree about how much went wrong.
     */
    allIssues(state): ValidationIssue[] {
      const issues: ValidationIssue[] = [...state.issues]
      for (const invalid of state.invalidBundles) issues.push(...invalid.issues)
      for (const bundle of state.validBundles) issues.push(...bundle.warnings)
      return issues
    },

    /** Counters shown next to each filter option; always the raw flow counts. */
    scenarioFlowCounts(state): Map<string, number> {
      const bundle = state.validBundles.find((entry) => entry.id === state.activeBundleId)
      const scenario =
        bundle?.index.scenariosById.get(state.activeScenarioId ?? '') ?? null
      const counts = new Map<string, number>()
      if (scenario === null) return counts

      for (const flowId of scenario.flow_ids) {
        const flow = bundle?.index.flowsById.get(flowId)
        if (flow === undefined) continue
        counts.set(flow.kind, (counts.get(flow.kind) ?? 0) + 1)
      }
      return counts
    },

    scenarioVerificationCounts(state): Map<string, number> {
      const bundle = state.validBundles.find((entry) => entry.id === state.activeBundleId)
      const scenario =
        bundle?.index.scenariosById.get(state.activeScenarioId ?? '') ?? null
      const counts = new Map<string, number>()
      if (scenario === null) return counts

      for (const flowId of scenario.flow_ids) {
        const flow = bundle?.index.flowsById.get(flowId)
        if (flow === undefined) continue
        counts.set(flow.verification, (counts.get(flow.verification) ?? 0) + 1)
      }
      return counts
    },
  },

  actions: {
    /**
     * Loads a finished folder snapshot and replaces the catalog atomically.
     *
     * Nothing is written until the load completes, so a failed or superseded
     * scan leaves the previous catalog intact.
     */
    async replaceFromSnapshot(options: ReplaceFromSnapshotOptions): Promise<void> {
      this.loading = true
      this.status = 'loading'

      try {
        const result = await loadFolderCatalog({
          snapshot: options.snapshot,
          scanId: options.scanId,
          isCurrent: options.isCurrent,
          onProgress: (progress) => {
            this.progress = progress
            options.onProgress?.(progress)
          },
        })

        // A superseded scan must not overwrite the newer catalog.
        if (result === null) return

        this.validBundles = result.validBundles
        this.invalidBundles = result.invalidBundles
        this.issues = result.issues
        this.progress = result.progress
        this.status = result.status
        this.loading = false

        this.activateFirstAvailable(result.validBundles)
      } catch (error) {
        this.loading = false
        this.status = 'invalid'
        this.validBundles = []
        this.invalidBundles = []
        this.activeBundleId = null
        this.activeScenarioId = null
        this.issues = [
          {
            code: 'CATALOG_LOAD_FAILED',
            severity: 'error',
            stage: 'discovery',
            relativePath: options.snapshot.displayName,
            message: `加载目录时出错：${error instanceof Error ? error.message : String(error)}`,
          },
        ]
      }
    },

    /** Picks the first valid bundle and its first scenario, if any. */
    activateFirstAvailable(bundles?: readonly LoadedBundle[]): void {
      const first = (bundles ?? this.validBundles)[0]
      if (first === undefined) {
        this.activeBundleId = null
        this.activeScenarioId = null
        return
      }
      this.activateBundle(first.id)
    },

    /**
     * Selects a bundle and keeps the scenario consistent with it: the previous
     * scenario id is only kept when the new bundle also declares it.
     */
    activateBundle(bundleId: string): void {
      const bundle = this.validBundles.find((entry) => entry.id === bundleId)
      if (bundle === undefined) {
        this.activeBundleId = null
        this.activeScenarioId = null
        return
      }

      this.activeBundleId = bundle.id
      const scenarios = bundle.bundle.scenarios
      const current = scenarios.find((scenario) => scenario.id === this.activeScenarioId)
      const next = current ?? scenarios[0]
      this.activeScenarioId = next?.id ?? null
    },

    activateScenario(scenarioId: string): void {
      const bundle = this.activeBundle
      if (bundle === null) return
      // Only ids that belong to the active bundle are accepted; the getter for
      // `activeBundle` guarantees the pair stays consistent.
      if (!bundle.index.scenariosById.has(scenarioId)) return
      this.activeScenarioId = scenarioId
    },

    clear(): void {
      this.status = 'idle'
      this.validBundles = []
      this.invalidBundles = []
      this.issues = []
      this.activeBundleId = null
      this.activeScenarioId = null
      this.progress = { discovered: 0, processed: 0, valid: 0, invalid: 0, ignored: 0 }
      this.loading = false
    },
  },
})
