import { LineCounter, parseDocument, type Document, type Node as YamlNode } from 'yaml'

import { ISSUE_CODES, type ValidationIssue } from '@/domain/validation'

/** A parsed flow document together with the position information we keep. */
export interface ParsedBundleDocument {
  document: unknown
  yaml: Document
  lineCounter: LineCounter
}

export type ParseBundleResult =
  | { ok: true; value: ParsedBundleDocument; warnings: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] }

/** Splits a JSON Pointer into a YAML `getIn` path, undoing `~0`/`~1` escapes. */
export function pointerToPath(instancePath: string): Array<string | number> {
  return instancePath
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((segment) => (/^(0|[1-9][0-9]*)$/.test(segment) ? Number(segment) : segment))
}

/**
 * Resolves a JSON Pointer back to the source line and column, so Schema
 * errors can be located in the file (DESIGN.md 6.6).
 */
export function linePosForPointer(
  parsed: ParsedBundleDocument,
  instancePath: string,
): { line: number; column: number } | null {
  if (instancePath === '') return null

  let node: unknown
  try {
    node = parsed.yaml.getIn(pointerToPath(instancePath), true)
  } catch {
    return null
  }

  const range = (node as YamlNode | undefined)?.range
  if (!Array.isArray(range) || typeof range[0] !== 'number') return null

  const pos = parsed.lineCounter.linePos(range[0])
  return { line: pos.line, column: pos.col }
}

/**
 * Parses YAML text, reporting syntax errors with their position
 * (DESIGN.md 6.6, stage 1).
 */
export function parseBundleText(text: string, relativePath: string): ParseBundleResult {
  const lineCounter = new LineCounter()
  const yaml = parseDocument(text, { lineCounter, merge: true, prettyErrors: true })

  if (yaml.errors.length > 0) {
    return {
      ok: false,
      issues: yaml.errors.map((error) => {
        const start = error.linePos?.[0]
        const issue: ValidationIssue = {
          code: ISSUE_CODES.yamlSyntaxError,
          severity: 'error',
          stage: 'yaml',
          relativePath,
          message: error.message,
        }
        if (start !== undefined) {
          issue.line = start.line
          issue.column = start.col
        }
        return issue
      }),
    }
  }

  const document = yaml.toJS() as unknown
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return {
      ok: false,
      issues: [
        {
          code: ISSUE_CODES.yamlRootNotObject,
          severity: 'error',
          stage: 'yaml',
          relativePath,
          message: 'YAML 根节点必须是对象，实际为数组或标量。',
        },
      ],
    }
  }

  const warnings: ValidationIssue[] = yaml.warnings.map((warning) => {
    const start = warning.linePos?.[0]
    const issue: ValidationIssue = {
      code: ISSUE_CODES.yamlSyntaxError,
      severity: 'warning',
      stage: 'yaml',
      relativePath,
      message: warning.message,
    }
    if (start !== undefined) {
      issue.line = start.line
      issue.column = start.col
    }
    return issue
  })

  return { ok: true, value: { document, yaml, lineCounter }, warnings }
}
