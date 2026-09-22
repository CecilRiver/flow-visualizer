import type { InvalidBundleSummary, LoadedBundle } from '@/domain/indexes'
import type { FlowModelV01 } from '@/domain/model'
import { ISSUE_CODES, isError, type ValidationIssue } from '@/domain/validation'
import type { FolderSnapshot } from '@/filesystem/types'
import { extractSchemaVersion, isSupportedSchemaVersion, SUPPORTED_SCHEMA_VERSIONS } from '@/schemas/registry'

import { FILE_READ_CONCURRENCY, mapWithConcurrency } from './concurrency'
import { discoverFlowFiles, type FlowCandidate } from './discoverFlowFiles'
import { normalizeBundle } from './normalizeBundle'
import { linePosForPointer, parseBundleText } from './parseBundle'
import { validateAgainstSchema } from './schemaValidator'
import { runSemanticChecks } from './semanticChecks'

export interface CatalogProgress {
  /** Files enumerated by the folder scan. */
  discovered: number
  /** Candidates that finished read → parse → validate → normalize. */
  processed: number
  valid: number
  invalid: number
  /** YAML files recognised as not being flow models. */
  ignored: number
}

export type CatalogStatus = 'ready' | 'partial' | 'invalid'

export interface LoadedCatalog {
  scanId: number
  status: CatalogStatus
  validBundles: LoadedBundle[]
  invalidBundles: InvalidBundleSummary[]
  /** Folder-level problems: no candidates, limits, permission failures. */
  issues: ValidationIssue[]
  progress: CatalogProgress
}

export interface LoadFolderCatalogOptions {
  snapshot: FolderSnapshot
  /** Monotonic id; a result whose scan was superseded is discarded. */
  scanId: number
  discovered?: number
  /** Returns false once a newer scan has started. */
  isCurrent?: () => boolean
  onProgress?: (progress: CatalogProgress) => void
}

type BundleOutcome =
  | { ok: true; bundle: LoadedBundle }
  | { ok: false; summary: InvalidBundleSummary }

/** Attaches source positions to Schema errors so the file can be located. */
function locateIssues(
  issues: readonly ValidationIssue[],
  pointerResolver: (instancePath: string) => { line: number; column: number } | null,
): ValidationIssue[] {
  return issues.map((issue) => {
    if (issue.instancePath === undefined) return issue
    const position = pointerResolver(issue.instancePath)
    if (position === null) return issue
    return { ...issue, line: position.line, column: position.column }
  })
}

/** Reads `model.id` / `model.title` when the document got far enough to have them. */
function readModelIdentity(document: unknown): { id: string | null; title: string | null } {
  if (typeof document !== 'object' || document === null) return { id: null, title: null }
  const model = (document as Record<string, unknown>)['model']
  if (typeof model !== 'object' || model === null) return { id: null, title: null }
  const record = model as Record<string, unknown>
  return {
    id: typeof record['id'] === 'string' ? record['id'] : null,
    title: typeof record['title'] === 'string' ? record['title'] : null,
  }
}

function invalidSummary(
  candidate: FlowCandidate,
  issues: ValidationIssue[],
  identity: { id: string | null; title: string | null } = { id: null, title: null },
): BundleOutcome {
  return {
    ok: false,
    summary: {
      id: identity.id ?? candidate.file.relativePath,
      relativePath: candidate.file.relativePath,
      modelTitle: identity.title,
      issues,
    },
  }
}

async function loadCandidate(candidate: FlowCandidate): Promise<BundleOutcome> {
  const relativePath = candidate.file.relativePath

  let text: string
  try {
    text = candidate.text ?? (await candidate.file.readText())
  } catch (error) {
    return invalidSummary(candidate, [
      {
        code: ISSUE_CODES.fileUnreadable,
        severity: 'error',
        stage: 'filesystem',
        relativePath,
        message: `无法读取文件：${error instanceof Error ? error.message : String(error)}`,
      },
    ])
  }

  const parsed = parseBundleText(text, relativePath)
  if (!parsed.ok) return invalidSummary(candidate, parsed.issues)

  const { value, warnings } = parsed
  const identity = readModelIdentity(value.document)

  const version = extractSchemaVersion(value.document)
  if (version === null || !isSupportedSchemaVersion(version)) {
    return invalidSummary(candidate, [
      {
        code: ISSUE_CODES.unsupportedSchemaVersion,
        severity: 'error',
        stage: 'schema',
        relativePath,
        message:
          version === null
            ? '缺少可识别的顶层 schema_version 字段。'
            : `查看器不支持 schema_version "${version}"，当前支持 ${SUPPORTED_SCHEMA_VERSIONS.join('、')}。`,
      },
    ], identity)
  }

  const schemaResult = validateAgainstSchema(version, value.document, relativePath)
  if (!schemaResult.ok) {
    const located = locateIssues(schemaResult.issues, (pointer) =>
      linePosForPointer(value, pointer),
    )
    return invalidSummary(candidate, located, identity)
  }

  const model = value.document as FlowModelV01
  const semanticIssues = runSemanticChecks(model, relativePath)
  if (semanticIssues.some(isError)) {
    return invalidSummary(candidate, semanticIssues, identity)
  }

  return {
    ok: true,
    bundle: normalizeBundle({
      document: model,
      relativePath,
      schemaVersion: version,
      warnings: [...warnings, ...semanticIssues],
    }),
  }
}

/**
 * Marks every file that claims an already-used `model.id` as invalid. The ids
 * stay globally unique inside the catalog, and unique bundles are unaffected
 * (DESIGN.md 6.6).
 */
function resolveDuplicateModelIds(
  loaded: readonly LoadedBundle[],
): { valid: LoadedBundle[]; duplicates: InvalidBundleSummary[] } {
  const byModelId = new Map<string, LoadedBundle[]>()
  for (const bundle of loaded) {
    const group = byModelId.get(bundle.id)
    if (group === undefined) byModelId.set(bundle.id, [bundle])
    else group.push(bundle)
  }

  const valid: LoadedBundle[] = []
  const duplicates: InvalidBundleSummary[] = []

  for (const [modelId, group] of byModelId) {
    if (group.length === 1) {
      valid.push(group[0] as LoadedBundle)
      continue
    }
    for (const bundle of group) {
      duplicates.push({
        id: modelId,
        relativePath: bundle.relativePath,
        modelTitle: bundle.bundle.model.title,
        issues: [
          {
            code: ISSUE_CODES.duplicateModelId,
            severity: 'error',
            stage: 'semantic',
            relativePath: bundle.relativePath,
            message:
              `model.id "${modelId}" 在同一目录中出现 ${group.length} 次，` +
              '冲突文件均不可用；请删除或重命名多余文件。',
            relatedIds: [modelId],
          },
        ],
      })
    }
  }

  return { valid, duplicates }
}

/**
 * Loads every flow model in a folder snapshot.
 *
 * Each candidate is processed independently, so one broken file never stops
 * the others (DESIGN.md 6.1). Returns `null` when a newer scan has already
 * superseded this one.
 */
export async function loadFolderCatalog(
  options: LoadFolderCatalogOptions,
): Promise<LoadedCatalog | null> {
  const { snapshot, scanId, isCurrent, onProgress } = options
  const progress: CatalogProgress = {
    discovered: options.discovered ?? snapshot.files.length,
    processed: 0,
    valid: 0,
    invalid: 0,
    ignored: 0,
  }

  const discovery = await discoverFlowFiles(snapshot.files)
  progress.ignored = discovery.ignoredCount
  if (isCurrent !== undefined && !isCurrent()) return null

  const folderIssues: ValidationIssue[] = []
  if (discovery.candidates.length === 0) {
    folderIssues.push(
      snapshot.files.length === 0
        ? {
            code: ISSUE_CODES.folderEmpty,
            severity: 'error',
            stage: 'discovery',
            relativePath: snapshot.displayName,
            message: '所选目录中没有找到任何 YAML 文件。',
          }
        : {
            code: ISSUE_CODES.noFlowFiles,
            severity: 'error',
            stage: 'discovery',
            relativePath: snapshot.displayName,
            message:
              `${snapshot.files.length} 个 YAML 文件中没有找到 flow 模型。` +
              '请确认目录包含 scenarios/*.yaml 等提取结果，而不是源码或文档。',
          },
    )
    return {
      scanId,
      status: 'invalid',
      validBundles: [],
      invalidBundles: [],
      issues: folderIssues,
      progress,
    }
  }

  const outcomes = await mapWithConcurrency(
    discovery.candidates,
    FILE_READ_CONCURRENCY,
    async (candidate) => {
      const outcome = await loadCandidate(candidate)
      progress.processed += 1
      if (outcome.ok) progress.valid += 1
      else progress.invalid += 1
      onProgress?.({ ...progress })
      return outcome
    },
  )

  if (isCurrent !== undefined && !isCurrent()) return null

  const loaded = outcomes.filter((o): o is { ok: true; bundle: LoadedBundle } => o.ok)
  const rejected = outcomes.filter((o): o is { ok: false; summary: InvalidBundleSummary } => !o.ok)

  const { valid, duplicates } = resolveDuplicateModelIds(
    loaded.map((o) => o.bundle),
  )
  const invalidBundles = [...rejected.map((o) => o.summary), ...duplicates]

  progress.valid = valid.length
  progress.invalid = invalidBundles.length
  onProgress?.({ ...progress })

  const status: CatalogStatus =
    valid.length === 0 ? 'invalid' : invalidBundles.length > 0 ? 'partial' : 'ready'

  return {
    scanId,
    status,
    validBundles: valid,
    invalidBundles,
    issues: folderIssues,
    progress,
  }
}
