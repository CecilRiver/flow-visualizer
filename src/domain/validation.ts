/**
 * The single issue shape shared by every validation layer (DESIGN.md 6.6).
 * Tests assert `code`, never the human-readable message.
 */
export type IssueSeverity = 'error' | 'warning'

export type IssueStage = 'filesystem' | 'discovery' | 'yaml' | 'schema' | 'semantic' | 'layout'

export interface ValidationIssue {
  code: string
  severity: IssueSeverity
  stage: IssueStage
  /** Path relative to the selected folder. Never an absolute local path. */
  relativePath?: string
  message: string
  /** JSON Pointer into the validated document, e.g. `/components/3/ports`. */
  instancePath?: string
  line?: number
  column?: number
  relatedIds?: string[]
}

/**
 * Stable issue codes. Callers and tests must reference these constants so a
 * wording change never breaks an assertion.
 */
export const ISSUE_CODES = {
  // filesystem / discovery
  permissionDenied: 'PERMISSION_DENIED',
  folderLimitExceeded: 'FOLDER_LIMIT_EXCEEDED',
  fileTooLarge: 'FILE_TOO_LARGE',
  fileUnreadable: 'FILE_UNREADABLE',
  pathTooDeep: 'PATH_TOO_DEEP',
  noFlowFiles: 'NO_FLOW_FILES',
  folderEmpty: 'FOLDER_EMPTY',

  // yaml / schema
  yamlSyntaxError: 'YAML_SYNTAX_ERROR',
  yamlRootNotObject: 'YAML_ROOT_NOT_OBJECT',
  schemaValidationFailed: 'SCHEMA_VALIDATION_FAILED',
  unsupportedSchemaVersion: 'UNSUPPORTED_SCHEMA_VERSION',

  // catalog level
  duplicateModelId: 'DUPLICATE_MODEL_ID',

  // semantic
  duplicateId: 'DUPLICATE_ID',
  missingParent: 'MISSING_PARENT',
  invalidLevelParent: 'INVALID_LEVEL_PARENT',
  missingPort: 'MISSING_PORT',
  portDirectionMismatch: 'PORT_DIRECTION_MISMATCH',
  dataContractMismatch: 'DATA_CONTRACT_MISMATCH',
  missingContract: 'MISSING_CONTRACT',
  missingSource: 'MISSING_SOURCE',
  scenarioFlowAsymmetry: 'SCENARIO_FLOW_ASYMMETRY',
  scenarioEndpointOutsideScenario: 'SCENARIO_ENDPOINT_OUTSIDE_SCENARIO',
  missingScenarioReference: 'MISSING_SCENARIO_REFERENCE',

  // layout
  layoutFailed: 'LAYOUT_FAILED',
  coarserThanView: 'COARSER_THAN_VIEW',
} as const

export type IssueCode = (typeof ISSUE_CODES)[keyof typeof ISSUE_CODES]

export function createIssue(issue: ValidationIssue): ValidationIssue {
  return issue
}

export function isError(issue: ValidationIssue): boolean {
  return issue.severity === 'error'
}

/** One file-and-stage bucket of issues, as the validation panel lists them. */
export interface IssueGroup {
  /** Stable key: severity, file and stage — never an array index. */
  key: string
  relativePath: string
  stage: IssueStage
  severity: IssueSeverity
  issues: ValidationIssue[]
}

/**
 * Groups issues by file and stage, errors before warnings.
 *
 * A file that fails Schema validation usually produces several issues at once
 * (DESIGN.md 17.1), and reading them as one group is what makes the shared
 * cause visible. Order follows first appearance within each severity, so the
 * list is stable across scans.
 */
export function groupIssues(issues: readonly ValidationIssue[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>()

  for (const issue of issues) {
    const relativePath = issue.relativePath ?? ''
    const key = `${issue.severity}|${relativePath}|${issue.stage}`
    const existing = groups.get(key)
    if (existing !== undefined) {
      existing.issues.push(issue)
      continue
    }
    groups.set(key, {
      key,
      relativePath,
      stage: issue.stage,
      severity: issue.severity,
      issues: [issue],
    })
  }

  return [...groups.values()].sort((left, right) => {
    if (left.severity !== right.severity) return left.severity === 'error' ? -1 : 1
    return 0
  })
}

/** Counts errors and warnings, used by the status bar and the validation panel. */
export function summarizeIssues(issues: readonly ValidationIssue[]): {
  errors: number
  warnings: number
} {
  let errors = 0
  let warnings = 0
  for (const issue of issues) {
    if (issue.severity === 'error') errors += 1
    else warnings += 1
  }
  return { errors, warnings }
}
