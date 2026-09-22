import { defineStore } from 'pinia'

import { useFolderSession } from '@/composables/useFolderSession'
import type { ValidationIssue } from '@/domain/validation'
import { FolderPermissionDenied, FolderSelectionCancelled } from '@/filesystem/chooseDirectory'
import { chooseFolder as pickFolder, refreshFolder } from '@/filesystem/scanDirectory'
import type { FolderSnapshot, FolderSourceMode, ScanOutcome } from '@/filesystem/types'

import { useCatalogStore } from './catalog'

/**
 * Folder authorisation state (DESIGN.md 8.1).
 *
 * Only serialisable facts live here. The directory handle itself stays in
 * `useFolderSession()`, so this store never carries a live browser capability
 * into reactive state or devtools snapshots.
 *
 * This store also drives the hand-off to the catalog: a scan is complete only
 * once `replaceFromSnapshot` has accepted it, so the two stores cannot end up
 * describing different folders.
 */

export type FolderSourceStatus = 'idle' | 'choosing' | 'scanning' | 'ready' | 'denied' | 'failed'

export interface ScanProgress {
  discovered: number
  processed: number
  valid: number
  invalid: number
  ignored: number
}

function emptyProgress(): ScanProgress {
  return { discovered: 0, processed: 0, valid: 0, invalid: 0, ignored: 0 }
}

/**
 * Why a scan that returned no snapshot was refused.
 *
 * Not simply the first issue: a folder that hit a hard limit usually carries
 * warnings from before it, and every one of those is a "this file was skipped
 * and the scan continued" fact. Leading with one of them would tell the reader
 * that an unreadable file, or one over the size cap, is why the whole folder
 * came back empty — when the scan actually refused it for a reason that is
 * listed last (DESIGN.md 6.3, 16.3). The welcome page has no validation panel
 * to show the rest, so the one message it does show has to be the real one.
 */
function refusalReason(issues: readonly ValidationIssue[]): string {
  const refusal = issues.find((issue) => issue.severity === 'error')
  return refusal?.message ?? issues[0]?.message ?? '目录中没有可读取的 YAML 文件。'
}

interface ScanResult {
  mode: FolderSourceMode
  displayName: string
  snapshot: FolderSnapshot | null
  issues: readonly ValidationIssue[]
}

export const useFolderSourceStore = defineStore('folderSource', {
  state: () => ({
    status: 'idle' as FolderSourceStatus,
    displayName: null as string | null,
    mode: null as FolderSourceMode | null,
    canRefresh: false,
    scanProgress: emptyProgress(),
    issues: [] as ValidationIssue[],
    /** Latest accepted snapshot, owned by this store and read by the catalog. */
    snapshot: null as FolderSnapshot | null,
    /**
     * Monotonic scan counter. Every scan takes an id, and any asynchronous
     * result whose id is no longer current is discarded (DESIGN.md 6.5).
     */
    scanId: 0,
    errorMessage: null as string | null,
  }),

  getters: {
    isBusy: (state): boolean => state.status === 'choosing' || state.status === 'scanning',
    hasFolder: (state): boolean => state.status === 'ready' && state.snapshot !== null,
    displayLabel: (state): string => state.displayName ?? '尚未选择目录',
  },

  actions: {
    /** Claims the next scan id; older in-flight results become stale. */
    beginScan(): number {
      this.scanId += 1
      return this.scanId
    },

    isCurrentScan(id: number): boolean {
      return id === this.scanId
    },

    /** Opens the folder picker from a user gesture (the browser requires one). */
    async chooseFolder(): Promise<void> {
      const scanId = this.beginScan()
      this.status = 'choosing'
      this.issues = []
      this.errorMessage = null
      this.scanProgress = emptyProgress()

      try {
        const chosen = await pickFolder(useFolderSession().capabilities.value, (progress) => {
          if (!this.isCurrentScan(scanId)) return
          this.status = 'scanning'
          this.scanProgress = { ...this.scanProgress, discovered: progress.discovered }
        })

        if (!this.isCurrentScan(scanId)) return
        useFolderSession().setSession(chosen.session)
        await this.commit(scanId, {
          mode: chosen.session.mode,
          displayName: chosen.session.displayName,
          snapshot: chosen.outcome.snapshot,
          issues: chosen.outcome.issues,
        })
      } catch (error) {
        if (!this.isCurrentScan(scanId)) return
        this.applyFailure(error)
      }
    },

    /**
     * Re-reads the folder this page already holds permission for.
     *
     * Only the directory-handle mode supports it: a `FileList` from the
     * `<input>` fallback cannot be read again after the source changes.
     */
    async refresh(): Promise<void> {
      const current = useFolderSession().session.value
      if (current === null) {
        this.status = 'idle'
        return
      }

      const scanId = this.beginScan()
      this.status = 'scanning'
      this.issues = []
      this.errorMessage = null
      this.scanProgress = emptyProgress()

      try {
        const outcome: ScanOutcome = await refreshFolder(current, (progress) => {
          if (!this.isCurrentScan(scanId)) return
          this.scanProgress = { ...this.scanProgress, discovered: progress.discovered }
        })
        if (!this.isCurrentScan(scanId)) return
        await this.commit(scanId, {
          mode: current.mode,
          displayName: current.displayName,
          snapshot: outcome.snapshot,
          issues: outcome.issues,
        })
      } catch (error) {
        if (!this.isCurrentScan(scanId)) return
        this.applyFailure(error)
      }
    },

    /** Resets to the welcome page and drops the authorised session. */
    clear(): void {
      this.beginScan()
      useFolderSession().clearSession()
      useCatalogStore().clear()
      this.status = 'idle'
      this.displayName = null
      this.mode = null
      this.canRefresh = false
      this.snapshot = null
      this.scanProgress = emptyProgress()
      this.issues = []
      this.errorMessage = null
    },

    chooseAnotherFolder(): void {
      this.clear()
    },

    /** Commits one finished scan and hands the snapshot to the catalog. */
    async commit(scanId: number, result: ScanResult): Promise<void> {
      if (!this.isCurrentScan(scanId)) return

      this.issues = [...result.issues]

      if (result.snapshot === null || result.snapshot.files.length === 0) {
        this.snapshot = null
        this.status = 'failed'
        this.errorMessage = refusalReason(result.issues)
        useCatalogStore().clear()
        return
      }

      this.snapshot = result.snapshot
      this.displayName = result.displayName || result.snapshot.displayName
      this.mode = result.mode
      this.canRefresh = result.snapshot.canRefresh
      this.status = 'ready'
      this.errorMessage = null

      await useCatalogStore().replaceFromSnapshot({
        snapshot: result.snapshot,
        scanId,
        isCurrent: () => this.isCurrentScan(scanId),
        onProgress: (progress) => {
          if (!this.isCurrentScan(scanId)) return
          this.scanProgress = { ...progress }
        },
      })
    },

    applyFailure(error: unknown): void {
      if (error instanceof FolderSelectionCancelled) {
        // Cancelling is a normal outcome, not an error: return to whichever
        // state the page was in before the picker opened.
        this.status = this.snapshot === null ? 'idle' : 'ready'
        this.errorMessage = null
        return
      }

      if (error instanceof FolderPermissionDenied) {
        // The user declined, or the browser withdrew access. This is not a
        // configuration problem and must not mark any file invalid.
        this.status = 'denied'
        this.errorMessage = error.message
        return
      }

      this.status = 'failed'
      this.errorMessage = error instanceof Error ? error.message : String(error)
    },
  },
})
