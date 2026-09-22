import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020'
import addFormats from 'ajv-formats'

import { ISSUE_CODES, type ValidationIssue } from '@/domain/validation'
import { SCHEMA_SNAPSHOTS, findSchemaSnapshot } from '@/schemas/registry'

/**
 * Draft 2020-12 validation of flow documents (DESIGN.md 3.1, 6.4).
 *
 * `strictRequired` is disabled because the embedded Schema declares
 * `required: ["path", "revision"]` inside an `if/then` subschema whose
 * `properties` live in the parent object. JSON Schema evaluates `then`
 * independently, so Ajv's "required property is not defined" check is a false
 * positive here; every other strict check stays enabled.
 */
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  allowUnionTypes: false,
})

addFormats(ajv)

/** Compiled once per supported version (DESIGN.md 18). */
const validatorsByVersion = new Map<string, ValidateFunction>()

/** Hard cap so a badly broken file cannot flood the validation panel. */
const MAX_REPORTED_ERRORS = 50

function getValidator(version: string): ValidateFunction | null {
  const cached = validatorsByVersion.get(version)
  if (cached !== undefined) return cached

  const snapshot = findSchemaSnapshot(version)
  if (snapshot === undefined) return null

  const compiled = ajv.compile(snapshot.schema)
  validatorsByVersion.set(version, compiled)
  return compiled
}

/** Warms every embedded validator during bootstrap. */
export function precompileSchemaValidators(): void {
  for (const snapshot of SCHEMA_SNAPSHOTS) {
    getValidator(snapshot.version)
  }
}

/** A one-line summary of what the rule expected and what the file provided. */
function describeError(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>
  const detail: string[] = []

  switch (error.keyword) {
    case 'required': {
      const missing = params['missingProperty']
      if (typeof missing === 'string') detail.push(`缺少必需字段 ${missing}`)
      break
    }
    case 'additionalProperties': {
      // Ajv v8 names the offending property in `additionalProperty`
      // (singular); the plural spelling is not one it ever emits.
      const extra = params['additionalProperty']
      if (typeof extra === 'string') detail.push(`出现未定义字段 ${extra}`)
      break
    }
    case 'enum': {
      const allowed = params['allowedValues']
      if (Array.isArray(allowed)) detail.push(`期望值之一：${allowed.join(' / ')}`)
      break
    }
    case 'const': {
      detail.push(`期望常量 ${JSON.stringify(params['allowedValue'])}`)
      break
    }
    case 'type': {
      detail.push(`期望类型 ${String(params['type'])}`)
      break
    }
    case 'pattern': {
      detail.push(`期望匹配 ${String(params['pattern'])}`)
      break
    }
    case 'format': {
      detail.push(`期望格式 ${String(params['format'])}`)
      break
    }
    default:
      break
  }

  const rule = `规则 ${error.keyword}`
  const message = error.message ?? '不符合 Schema'
  return detail.length > 0
    ? `${message}；${detail.join('；')}（${rule}）`
    : `${message}（${rule}）`
}

export interface SchemaValidationResult {
  ok: boolean
  issues: ValidationIssue[]
}

/**
 * Validates an already parsed document against the snapshot for `version`.
 * The caller is responsible for rejecting unsupported versions first.
 */
export function validateAgainstSchema(
  version: string,
  document: unknown,
  relativePath: string,
): SchemaValidationResult {
  const validator = getValidator(version)
  if (validator === null) {
    return {
      ok: false,
      issues: [
        {
          code: ISSUE_CODES.unsupportedSchemaVersion,
          severity: 'error',
          stage: 'schema',
          relativePath,
          message: `查看器不支持 schema_version ${version}。`,
        },
      ],
    }
  }

  if (validator(document)) {
    return { ok: true, issues: [] }
  }

  const errors = validator.errors ?? []
  const reported = errors.slice(0, MAX_REPORTED_ERRORS)
  const issues: ValidationIssue[] = reported.map((error) => {
    const issue: ValidationIssue = {
      code: ISSUE_CODES.schemaValidationFailed,
      severity: 'error',
      stage: 'schema',
      relativePath,
      message: describeError(error),
    }
    if (error.instancePath !== '') issue.instancePath = error.instancePath
    return issue
  })

  if (errors.length > reported.length) {
    issues.push({
      code: ISSUE_CODES.schemaValidationFailed,
      severity: 'error',
      stage: 'schema',
      relativePath,
      message: `另有 ${errors.length - reported.length} 项 Schema 错误未逐条列出。`,
    })
  }

  return { ok: false, issues }
}
