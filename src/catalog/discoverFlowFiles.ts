import { parseDocument, isMap } from 'yaml'

import { compareRelativePaths, isStrongFlowCandidate } from '@/filesystem/pathPolicy'
import type { FolderFile } from '@/filesystem/types'

import { FILE_READ_CONCURRENCY, mapWithConcurrency } from './concurrency'

/** How a file was recognised as a flow candidate (DESIGN.md 6.3). */
export type CandidateKind = 'strong' | 'signature'

export interface FlowCandidate {
  file: FolderFile
  kind: CandidateKind
  /** Text already read during signature detection, so it is only read once. */
  text?: string
}

export interface DiscoveryResult {
  candidates: FlowCandidate[]
  /** YAML files that are not flow models; counted, never reported as errors. */
  ignoredCount: number
}

const REQUIRED_SIGNATURE_KEYS = ['schema_version', 'model', 'components', 'flows', 'scenarios'] as const

/**
 * Light signature test that walks the YAML AST without building a JS object
 * graph, so probing an unrelated large YAML stays cheap.
 */
export function hasFlowModelSignature(text: string): boolean {
  const document = parseDocument(text, { merge: true })
  if (document.errors.length > 0) return false
  // Bound to a local so the `isMap` type guard narrows a stable reference.
  const { contents } = document
  if (!isMap(contents)) return false
  return REQUIRED_SIGNATURE_KEYS.every((key) => contents.has(key))
}

/**
 * Classifies the YAML files in a folder snapshot.
 *
 * Strong candidates (direct children, anything under `scenarios/`, and
 * `*.flow.yaml`) are accepted without a signature probe: if one turns out to be
 * malformed, that is reported rather than silently ignored. Every other YAML
 * file has to prove itself with the signature. Results keep a stable
 * lexicographic order.
 */
export async function discoverFlowFiles(files: readonly FolderFile[]): Promise<DiscoveryResult> {
  const ordered = [...files].sort((a, b) => compareRelativePaths(a.relativePath, b.relativePath))

  const classified = await mapWithConcurrency(
    ordered,
    FILE_READ_CONCURRENCY,
    async (file): Promise<FlowCandidate | 'ignored'> => {
      if (isStrongFlowCandidate(file.relativePath)) {
        return { file, kind: 'strong' }
      }
      let text: string
      try {
        text = await file.readText()
      } catch {
        // Unreadable non-candidate files are already reported by the
        // filesystem layer; here they simply do not qualify.
        return 'ignored'
      }
      return hasFlowModelSignature(text) ? { file, kind: 'signature', text } : 'ignored'
    },
  )

  const candidates: FlowCandidate[] = []
  let ignoredCount = 0
  for (const entry of classified) {
    if (entry === 'ignored') ignoredCount += 1
    else candidates.push(entry)
  }

  return { candidates, ignoredCount }
}
