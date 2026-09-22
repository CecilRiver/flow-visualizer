import type { ValidationIssue } from '@/domain/validation'

/**
 * Read-only folder abstractions. The catalog layer depends on these, never on
 * browser APIs directly (DESIGN.md 6.2).
 */
export type FolderSourceMode = 'directory-handle' | 'directory-input'

export interface FolderFile {
  /** Path relative to the selected folder, always `/`-separated. */
  relativePath: string
  size: number
  lastModified: number
  readText(): Promise<string>
}

export interface FolderSnapshot {
  /** Name the browser exposes for the chosen folder. Never an absolute path. */
  displayName: string
  mode: FolderSourceMode
  /** False for the one-shot `<input webkitdirectory>` snapshot. */
  canRefresh: boolean
  files: readonly FolderFile[]
}

export interface DirectoryCapabilities {
  /** The picker and the handles it returns are only available here. */
  secureContext: boolean
  supportsDirectoryPicker: boolean
}

/**
 * Non-serialisable session state. Kept in a module-private ref by
 * `useFolderSession()` so handles never enter Pinia (DESIGN.md 8.1).
 */
export interface FolderSession {
  mode: FolderSourceMode
  displayName: string
  directoryHandle: FileSystemDirectoryHandle | null
}

/** Result of turning a picked folder into a read-only file list. */
export interface ScanOutcome {
  snapshot: FolderSnapshot | null
  issues: readonly ValidationIssue[]
}
