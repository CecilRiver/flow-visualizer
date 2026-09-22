import { ISSUE_CODES, type ValidationIssue } from '@/domain/validation'

import {
  FOLDER_LIMITS,
  compareRelativePaths,
  isYamlFile,
  pathDepth,
  shouldSkipDirectory,
} from './pathPolicy'
import type { FolderFile, FolderSnapshot, ScanOutcome } from './types'

/**
 * Compatibility adapter for browsers without `showDirectoryPicker`
 * (DESIGN.md 6.2).
 *
 * `<input webkitdirectory>` only yields a one-shot `FileList`: the source files
 * cannot be re-read later, so the snapshot reports `canRefresh: false` and the
 * UI offers "choose another folder" instead of a refresh.
 */

/** Drops the leading segment (the picked folder itself) from `webkitRelativePath`. */
export function relativePathFrom(webkitRelativePath: string): string | null {
  const segments = webkitRelativePath.replace(/\\/g, '/').split('/').filter((s) => s !== '')
  if (segments.length < 2) return null
  const withoutRoot = segments.slice(1)
  if (withoutRoot.some((segment) => segment === '..')) return null
  if (withoutRoot.some((segment, index) => index < withoutRoot.length - 1 && shouldSkipDirectory(segment))) {
    return null
  }
  return withoutRoot.join('/')
}

export function deriveRootName(files: readonly File[]): string {
  const first = files[0]
  if (first === undefined) return ''
  const segments = first.webkitRelativePath.replace(/\\/g, '/').split('/')
  return segments[0] ?? ''
}

export function filesToSnapshot(input: readonly File[]): ScanOutcome {
  const issues: ValidationIssue[] = []
  const files: FolderFile[] = []
  const ordered = [...input].sort((a, b) =>
    compareRelativePaths(a.webkitRelativePath, b.webkitRelativePath),
  )

  const displayName = deriveRootName(ordered)
  let discovered = 0
  let totalYamlBytes = 0
  let limitExceeded = false

  for (const file of ordered) {
    const relativePath = relativePathFrom(file.webkitRelativePath)
    if (relativePath === null) continue

    discovered += 1
    if (discovered > FOLDER_LIMITS.maxFiles) {
      limitExceeded = true
      break
    }

    if (!isYamlFile(relativePath)) continue
    if (pathDepth(relativePath) > FOLDER_LIMITS.maxDepth) {
      issues.push({
        code: ISSUE_CODES.pathTooDeep,
        severity: 'warning',
        stage: 'filesystem',
        relativePath,
        message: `路径深度超过 ${FOLDER_LIMITS.maxDepth} 层，已跳过。`,
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
      break
    }

    files.push({
      relativePath,
      size: file.size,
      lastModified: file.lastModified,
      readText: () => file.text(),
    })
  }

  if (limitExceeded) {
    return {
      snapshot: null,
      issues: [
        ...issues,
        {
          code: ISSUE_CODES.folderLimitExceeded,
          severity: 'error',
          stage: 'filesystem',
          relativePath: displayName,
          message:
            `所选目录超过扫描上限（最多 ${FOLDER_LIMITS.maxFiles} 个文件、` +
            `${Math.round(FOLDER_LIMITS.maxTotalBytes / 1024 / 1024)} MiB YAML）。` +
            '请改为选择 flow 提取结果目录，而不是源码仓库根目录。',
        },
      ],
    }
  }

  const snapshot: FolderSnapshot = {
    displayName,
    mode: 'directory-input',
    canRefresh: false,
    files,
  }
  return { snapshot, issues }
}

/**
 * Opens the directory input and resolves with the picked `FileList`, or
 * `null` when the user dismissed the dialog without choosing.
 */
export function pickFilesViaInput(): Promise<FileList | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = '.yaml,.yml'
    // Non-standard but universally implemented attribute, set via the
    // attribute API because it has no property in the DOM typings.
    input.setAttribute('webkitdirectory', '')
    input.style.display = 'none'

    let settled = false
    const cleanup = () => {
      input.removeEventListener('change', onChange)
      window.removeEventListener('focus', onFocus)
      input.remove()
    }
    const finish = (value: FileList | null) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const onChange = () => finish(input.files)
    // There is no cancel event; the dialog closing returns focus to the page.
    // The delay lets a `change` that fires first win the race.
    const onFocus = () => window.setTimeout(() => finish(null), 300)

    input.addEventListener('change', onChange)
    window.addEventListener('focus', onFocus, { once: true })
    document.body.appendChild(input)
    input.click()
  })
}
