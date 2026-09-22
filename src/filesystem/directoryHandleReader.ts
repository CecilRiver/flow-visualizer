import { ISSUE_CODES, type ValidationIssue } from '@/domain/validation'

import { FolderPermissionDenied, DIRECTORY_PICKER_ID } from './chooseDirectory'
import {
  FOLDER_LIMITS,
  compareRelativePaths,
  isYamlFile,
  pathDepth,
  shouldSkipDirectory,
} from './pathPolicy'
import type { FolderFile, ScanOutcome } from './types'

/** Reports enumeration progress only; parse/validation counts come later. */
export interface ScanProgressReporter {
  (progress: { discovered: number }): void
}

/**
 * Opens the system directory picker. Must be called straight from a user
 * gesture, and asks for read access only — never `readwrite` (DESIGN.md 6.2).
 */
export async function pickDirectoryHandle(): Promise<FileSystemDirectoryHandle> {
  return window.showDirectoryPicker({ id: DIRECTORY_PICKER_ID, mode: 'read' })
}

/** True when the page currently holds read access to this handle. */
export async function hasReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  if (typeof handle.queryPermission !== 'function') return true
  return (await handle.queryPermission({ mode: 'read' })) === 'granted'
}

/** Re-requests read permission. Must be called from a user gesture. */
export async function requestReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  if (typeof handle.requestPermission !== 'function') return true
  return (await handle.requestPermission({ mode: 'read' })) === 'granted'
}

function createFileEntry(
  parent: FileSystemDirectoryHandle,
  name: string,
  relativePath: string,
  size: number,
  lastModified: number,
): FolderFile {
  return {
    relativePath,
    size,
    lastModified,
    // Read lazily so a large folder never holds every file in memory at once.
    readText: async () => {
      const fileHandle = await parent.getFileHandle(name)
      return (await fileHandle.getFile()).text()
    },
  }
}

/**
 * Enumerates a directory handle into a read-only snapshot.
 *
 * Returns `snapshot: null` when a hard limit is hit, so callers refuse to build
 * a partial catalog from a truncated scan (DESIGN.md 6.3, 17.1).
 */
export async function buildSnapshotFromHandle(
  handle: FileSystemDirectoryHandle,
  onProgress?: ScanProgressReporter,
): Promise<ScanOutcome> {
  const files: FolderFile[] = []
  const issues: ValidationIssue[] = []
  let discovered = 0
  let totalYamlBytes = 0
  let limitExceeded = false

  const walk = async (directory: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    const entries: Array<FileSystemDirectoryHandle | FileSystemFileHandle> = []
    try {
      for await (const entry of directory.values()) {
        entries.push(entry)
      }
    } catch (error) {
      issues.push({
        code: ISSUE_CODES.fileUnreadable,
        severity: 'warning',
        stage: 'filesystem',
        relativePath: prefix === '' ? directory.name : prefix,
        message: `无法枚举目录内容：${error instanceof Error ? error.message : String(error)}`,
      })
      return
    }

    // Stable order keeps scanning and the resulting catalog deterministic.
    entries.sort((a, b) => compareRelativePaths(a.name, b.name))

    for (const entry of entries) {
      if (limitExceeded) return
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`

      if (entry.kind === 'directory') {
        if (shouldSkipDirectory(entry.name)) continue
        // Children of this directory would exceed the depth budget.
        if (pathDepth(relativePath) >= FOLDER_LIMITS.maxDepth) {
          issues.push({
            code: ISSUE_CODES.pathTooDeep,
            severity: 'warning',
            stage: 'filesystem',
            relativePath,
            message: `目录深度超过 ${FOLDER_LIMITS.maxDepth} 层，已跳过。`,
          })
          continue
        }
        await walk(entry as FileSystemDirectoryHandle, relativePath)
        continue
      }

      discovered += 1
      onProgress?.({ discovered })

      if (discovered > FOLDER_LIMITS.maxFiles) {
        limitExceeded = true
        return
      }

      if (!isYamlFile(relativePath)) continue

      let file: File
      try {
        file = await entry.getFile()
      } catch (error) {
        issues.push({
          code: ISSUE_CODES.fileUnreadable,
          severity: 'warning',
          stage: 'filesystem',
          relativePath,
          message: `无法读取文件：${error instanceof Error ? error.message : String(error)}`,
        })
        continue
      }

      if (file.size > FOLDER_LIMITS.maxFileBytes) {
        issues.push({
          code: ISSUE_CODES.fileTooLarge,
          severity: 'warning',
          stage: 'filesystem',
          relativePath,
          message: `文件超过 ${Math.round(FOLDER_LIMITS.maxFileBytes / 1024 / 1024)} MiB 上限，已跳过。`,
        })
        continue
      }

      totalYamlBytes += file.size
      if (totalYamlBytes > FOLDER_LIMITS.maxTotalBytes) {
        limitExceeded = true
        return
      }

      files.push(createFileEntry(directory, entry.name, relativePath, file.size, file.lastModified))
    }
  }

  await walk(handle, '')

  if (limitExceeded) {
    return {
      snapshot: null,
      issues: [
        ...issues,
        {
          code: ISSUE_CODES.folderLimitExceeded,
          severity: 'error',
          stage: 'filesystem',
          relativePath: handle.name,
          message:
            `所选目录超过扫描上限（最多 ${FOLDER_LIMITS.maxFiles} 个文件、` +
            `${Math.round(FOLDER_LIMITS.maxTotalBytes / 1024 / 1024)} MiB YAML）。` +
            '请改为选择 flow 提取结果目录，而不是源码仓库根目录。',
        },
      ],
    }
  }

  return {
    snapshot: {
      displayName: handle.name,
      mode: 'directory-handle',
      canRefresh: true,
      files,
    },
    issues,
  }
}

/** Re-reads a handle kept for the current page session. */
export async function refreshHandleSnapshot(
  handle: FileSystemDirectoryHandle,
  onProgress?: ScanProgressReporter,
): Promise<ScanOutcome> {
  if (!(await hasReadPermission(handle)) && !(await requestReadPermission(handle))) {
    throw new FolderPermissionDenied()
  }
  return buildSnapshotFromHandle(handle, onProgress)
}
