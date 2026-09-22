import { buildModelIndex, type LoadedBundle } from '@/domain/indexes'
import type { FlowModelV01 } from '@/domain/model'
import type { ValidationIssue } from '@/domain/validation'

/** Freezes an object graph in place, tolerating shared references from anchors. */
export function deepFreeze<T>(value: T, seen: Set<object> = new Set()): T {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return value
  seen.add(value)

  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key], seen)
  }
  return Object.freeze(value)
}

export interface NormalizeBundleOptions {
  document: unknown
  relativePath: string
  schemaVersion: string
  warnings: readonly ValidationIssue[]
}

/**
 * Turns a document that passed Schema validation and semantic checks into the
 * immutable bundle the Catalog stores (DESIGN.md 7.2).
 *
 * Nothing here rewrites business ids, verification states or evidence: the
 * only additions are lookup indexes and the freeze.
 */
export function normalizeBundle(options: NormalizeBundleOptions): LoadedBundle {
  const bundle = deepFreeze(options.document as FlowModelV01)
  return {
    id: bundle.model.id,
    relativePath: options.relativePath,
    schemaVersion: options.schemaVersion,
    bundle,
    index: buildModelIndex(bundle),
    warnings: options.warnings,
  }
}
