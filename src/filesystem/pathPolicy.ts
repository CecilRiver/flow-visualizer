/**
 * Pure path rules for folder scanning (DESIGN.md 6.3).
 *
 * Everything here is side-effect free so the policy can be unit tested without
 * a browser, and so the same rules apply to both folder adapters.
 */

export const FOLDER_LIMITS = {
  /** Deepest allowed relative path, counted in path segments. */
  maxDepth: 8,
  maxFiles: 500,
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
} as const

/** Directories that never contain flow configuration. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
])

const YAML_EXTENSION = /\.(yaml|yml)$/i
const FLOW_SUFFIX = /\.flow\.(yaml|yml)$/i

/**
 * Normalises a path to `/`-separated form relative to the selected folder.
 * Returns `null` for empty input or any path escaping the folder with `..`.
 */
export function normalizeRelativePath(input: string): string | null {
  const segments: string[] = []
  for (const segment of input.replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') return null
    segments.push(segment)
  }
  return segments.length === 0 ? null : segments.join('/')
}

/** True for hidden directories and the known noise directories. */
export function shouldSkipDirectory(name: string): boolean {
  return name.startsWith('.') || SKIPPED_DIRECTORIES.has(name)
}

export function isHiddenName(name: string): boolean {
  return name.startsWith('.')
}

export function isYamlFile(relativePath: string): boolean {
  return YAML_EXTENSION.test(relativePath)
}

export function pathDepth(relativePath: string): number {
  return relativePath.split('/').length
}

export function exceedsDepthLimit(relativePath: string): boolean {
  return pathDepth(relativePath) > FOLDER_LIMITS.maxDepth
}

/**
 * Strong candidates are read and validated without a signature pre-check:
 * YAML directly inside the chosen folder, anything under `scenarios/`, and
 * `*.flow.yaml` names.
 *
 * Expects an already YAML-filtered path: "directly inside the chosen folder" is
 * decided from the segment count alone, so called on an unfiltered list this
 * would call a top-level `README.md` a flow candidate. Both folder adapters
 * apply `isYamlFile` before building the file list, which is what makes the
 * single-segment case safe; a new adapter has to do the same.
 */
export function isStrongFlowCandidate(relativePath: string): boolean {
  const segments = relativePath.split('/')
  if (segments.length === 1) return true
  if (segments[0] === 'scenarios') return true
  return FLOW_SUFFIX.test(relativePath)
}

/** Deterministic, locale-independent ordering used for every candidate list. */
export function compareRelativePaths(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}
