import { FolderPermissionDenied, FolderSelectionCancelled } from './chooseDirectory'
import {
  buildSnapshotFromHandle,
  pickDirectoryHandle,
  refreshHandleSnapshot,
  type ScanProgressReporter,
} from './directoryHandleReader'
import { filesToSnapshot, pickFilesViaInput } from './directoryInputFallback'
import type { DirectoryCapabilities, FolderSession, ScanOutcome } from './types'

export type { ScanProgressReporter }

/** A folder the user just authorised, plus the session state for refreshing. */
export interface ChosenFolder {
  session: FolderSession
  outcome: ScanOutcome
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isPermissionError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' || error.name === 'SecurityError')
  )
}

async function chooseViaDirectoryPicker(onProgress?: ScanProgressReporter): Promise<ChosenFolder> {
  let handle: FileSystemDirectoryHandle
  try {
    handle = await pickDirectoryHandle()
  } catch (error) {
    if (isAbortError(error)) throw new FolderSelectionCancelled()
    if (isPermissionError(error)) throw new FolderPermissionDenied()
    throw error
  }

  const outcome = await buildSnapshotFromHandle(handle, onProgress)
  return {
    session: { mode: 'directory-handle', displayName: handle.name, directoryHandle: handle },
    outcome,
  }
}

async function chooseViaInput(): Promise<ChosenFolder> {
  const fileList = await pickFilesViaInput()
  if (fileList === null || fileList.length === 0) throw new FolderSelectionCancelled()

  const outcome = filesToSnapshot(Array.from(fileList))
  return {
    // A FileList cannot be re-read after the source files change, so refresh is
    // offered as "choose folder again" instead.
    session: {
      mode: 'directory-input',
      displayName: outcome.snapshot?.displayName ?? '',
      directoryHandle: null,
    },
    outcome,
  }
}

/**
 * Runs the folder picker. Must be invoked directly from a user gesture: the
 * browser requires user activation for the directory picker.
 */
export async function chooseFolder(
  capabilities: DirectoryCapabilities,
  onProgress?: ScanProgressReporter,
): Promise<ChosenFolder> {
  return capabilities.supportsDirectoryPicker
    ? chooseViaDirectoryPicker(onProgress)
    : chooseViaInput()
}

/**
 * Re-scans a folder kept from earlier in this page session. Throws
 * `FolderPermissionDenied` when the browser no longer grants read access.
 */
export async function refreshFolder(
  session: FolderSession,
  onProgress?: ScanProgressReporter,
): Promise<ScanOutcome> {
  if (session.directoryHandle === null) {
    throw new FolderPermissionDenied('当前目录模式不支持刷新，请重新选择文件夹。')
  }
  return refreshHandleSnapshot(session.directoryHandle, onProgress)
}

/** Re-exported so callers can build a snapshot from a raw handle in tests. */
export { buildSnapshotFromHandle }
