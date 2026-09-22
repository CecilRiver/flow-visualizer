import { describe, expect, it } from 'vitest'

import { precompileSchemaValidators, validateAgainstSchema } from '@/catalog/schemaValidator'
import type { Component, FlowModelV01 } from '@/domain/model'
import { ISSUE_CODES } from '@/domain/validation'
import {
  LATEST_SCHEMA_VERSION,
  SCHEMA_SNAPSHOTS,
  SUPPORTED_SCHEMA_VERSIONS,
  extractSchemaVersion,
  findSchemaSnapshot,
  isSupportedSchemaVersion,
} from '@/schemas/registry'

import { makeComponent, makeFlow, makeModel, makeScenario, makeSource, withPorts } from '../fixtures/buildModel'

/**
 * Layer 2 of the three-layer validator (DESIGN.md 6.6): the embedded v0.1
 * Schema snapshot.
 *
 * The documents are built from the fixture helpers and then adjusted to the
 * Schema's stricter rules (a 40-hex `source_revision`, and the `implementation`
 * / `evidence` that an internal L2 component is required to carry), so that the
 * starting point really is a legal package. Every invalid case is derived from
 * that same legal package by a single mutation, which keeps the failure
 * attributable.
 *
 * The list of required top-level fields is read from the embedded snapshot
 * rather than written out here: these tests must fail if the registry ever
 * stops driving the validator.
 */

const PATH = 'scenarios/model.yaml'

const SOURCE_ID = 'source.test'
const CONTRACT_ID = 'data.test'
const REVISION = '0123456789abcdef0123456789abcdef01234567'

function l2Component(id: string, parentId: string): Component {
  return {
    ...withPorts(makeComponent({ id, level: 2, parent_id: parentId }), [CONTRACT_ID]),
    // Required by the component `allOf/if/then` for internal L2 components.
    implementation: [{ source_id: SOURCE_ID, role: 'primary' }],
    evidence: [{ source_id: SOURCE_ID, support: 'direct', claim: `${id} claim` }],
  }
}

/** A minimal document that satisfies the v0.1 Schema snapshot. */
function validModel(): FlowModelV01 {
  const components = [
    makeComponent({ id: 'system.ac', level: 0, kind: 'system' }),
    makeComponent({
      id: 'domain.control',
      level: 1,
      kind: 'capability_domain',
      parent_id: 'system.ac',
    }),
    l2Component('l2.attitude', 'domain.control'),
    l2Component('l2.rate', 'domain.control'),
  ]
  const flows = [
    makeFlow({ id: 'flow.attitude_rate', from: 'l2.attitude', to: 'l2.rate' }),
  ]
  const scenarios = [
    makeScenario({
      id: 'scenario.test',
      component_ids: components.map((component) => component.id),
      flow_ids: flows.map((flow) => flow.id),
    }),
  ]

  return makeModel({
    id: 'test.model.v0_1',
    revision: REVISION,
    sources: [makeSource(SOURCE_ID, { revision: REVISION })],
    components,
    flows,
    scenarios,
  })
}

/** A deep copy that the validator treats as a plain JSON document. */
function cloneRecord(document: unknown): Record<string, unknown> {
  const copy: unknown = JSON.parse(JSON.stringify(document))
  if (typeof copy !== 'object' || copy === null || Array.isArray(copy)) {
    throw new Error('fixture document is not an object')
  }
  return copy as Record<string, unknown>
}

function nestedRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const child = parent[key]
  if (typeof child !== 'object' || child === null || Array.isArray(child)) {
    throw new Error(`fixture document has no object at ${key}`)
  }
  return child as Record<string, unknown>
}

function nestedArray(parent: Record<string, unknown>, key: string): unknown[] {
  const child = parent[key]
  if (!Array.isArray(child)) throw new Error(`fixture document has no array at ${key}`)
  return child
}

/** The `components[i]` entry with the given id, so a case can name its target. */
function componentRecord(document: Record<string, unknown>, id: string): Record<string, unknown> {
  for (const entry of nestedArray(document, 'components')) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (record['id'] === id) return record
  }
  throw new Error(`fixture document has no component ${id}`)
}

/** Top-level `required` of the embedded snapshot, as the validator sees it. */
function requiredTopLevelKeys(): readonly string[] {
  const snapshot = findSchemaSnapshot('0.1')
  const raw = snapshot?.schema['required']
  if (!Array.isArray(raw)) throw new Error('v0.1 snapshot has no top-level required list')
  return raw.filter((key): key is string => typeof key === 'string')
}

describe('validateAgainstSchema / v0.1 合法包', () => {
  it('合法包通过校验，且不产生任何 issue', () => {
    const result = validateAgainstSchema('0.1', validModel(), PATH)
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('引导阶段预热全部内置 validator 不会抛错', () => {
    // Compiling the snapshot under Ajv's strict mode is itself a contract: a
    // Schema edit that introduces an unknown keyword fails here, not at the
    // moment a user picks a folder.
    expect(() => precompileSchemaValidators()).not.toThrow()
  })
})

describe('validateAgainstSchema / 缺少必需字段', () => {
  for (const key of requiredTopLevelKeys()) {
    it(`缺少顶层必需字段 ${key} 时报 SCHEMA_VALIDATION_FAILED`, () => {
      const document = cloneRecord(validModel())
      delete document[key]

      const result = validateAgainstSchema('0.1', document, PATH)

      expect(result.ok).toBe(false)
      expect(result.issues.map((issue) => issue.code)).toContain(
        ISSUE_CODES.schemaValidationFailed,
      )
      expect(result.issues.every((issue) => issue.stage === 'schema')).toBe(true)
      expect(result.issues.every((issue) => issue.severity === 'error')).toBe(true)
      expect(result.issues.every((issue) => issue.relativePath === PATH)).toBe(true)
      // A top-level failure has the empty JSON Pointer, which is left off
      // rather than rendered as a meaningless `/`.
      const issue = result.issues.find((candidate) => candidate.instancePath === undefined)
      expect(issue).toBeDefined()
    })
  }

  it('嵌套对象缺少必需字段时把 instancePath 指向该对象', () => {
    const document = cloneRecord(validModel())
    delete nestedRecord(document, 'model')['title']

    const result = validateAgainstSchema('0.1', document, PATH)

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.instancePath)).toContain('/model')
    // The summary names the missing property so the panel can show it.
    expect(result.issues.some((issue) => issue.message.includes('title'))).toBe(true)
  })

  it('内部 L2 组件缺少 if/then 要求的字段时失败', () => {
    const document = cloneRecord(validModel())
    // `l2.attitude` is the first internal L2 component; the `allOf/if/then`
    // rule that demands ports/implementation/evidence applies to it alone.
    delete componentRecord(document, 'l2.attitude')['implementation']

    const result = validateAgainstSchema('0.1', document, PATH)

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.instancePath)).toContain('/components/2')
  })

  it('集合违反 minItems 时失败', () => {
    const document = cloneRecord(validModel())
    document['flows'] = []

    const result = validateAgainstSchema('0.1', document, PATH)

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.instancePath)).toContain('/flows')
  })
})

describe('validateAgainstSchema / format', () => {
  it('generated_on 不是合法日期时报错', () => {
    const document = cloneRecord(validModel())
    nestedRecord(document, 'model')['generated_on'] = 'not-a-date'

    const result = validateAgainstSchema('0.1', document, PATH)

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.instancePath)).toContain('/model/generated_on')
    expect(result.issues.some((issue) => issue.message.includes('date'))).toBe(true)
  })

  it('wiki source 的 url 违反 uri format 时报错', () => {
    const document = cloneRecord(validModel())
    const source = nestedArray(document, 'sources')[0]
    if (typeof source !== 'object' || source === null) throw new Error('fixture source missing')
    const record = source as Record<string, unknown>
    record['kind'] = 'wiki'
    record['url'] = 'not a url'
    record['retrieved_on'] = '2026-01-01'

    const result = validateAgainstSchema('0.1', document, PATH)

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.instancePath)).toContain('/sources/0/url')
  })

  it('合法日期与合法 uri 不会被误判', () => {
    const document = cloneRecord(validModel())
    const source = nestedArray(document, 'sources')[0]
    if (typeof source !== 'object' || source === null) throw new Error('fixture source missing')
    const record = source as Record<string, unknown>
    record['kind'] = 'wiki'
    record['url'] = 'https://ardupilot.org/dev/docs/test.html'
    record['retrieved_on'] = '2026-01-01'

    expect(validateAgainstSchema('0.1', document, PATH).ok).toBe(true)
  })
})

describe('validateAgainstSchema / 未知字段', () => {
  it('顶层未知字段被拒绝', () => {
    const document = cloneRecord(validModel())
    document['unexpected'] = 'value'

    const result = validateAgainstSchema('0.1', document, PATH)

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.schemaValidationFailed)
    // The top-level document has the empty pointer, which is left off.
    expect(result.issues[0]?.instancePath).toBeUndefined()
  })

  it('嵌套对象里的未知字段被拒绝，并带出该对象的 instancePath', () => {
    const document = cloneRecord(validModel())
    nestedRecord(document, 'model')['author'] = 'someone'

    const result = validateAgainstSchema('0.1', document, PATH)

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.instancePath)).toContain('/model')
  })

  it('未知字段的摘要要点名具体字段（DESIGN 17.1 要求显示实际值）', () => {
    // Known defect: `describeError` looks up `params.additionalProperties`,
    // but Ajv v8 reports the offending property as `params.additionalProperty`
    // (singular). The branch is therefore dead and the panel shows the bare
    // RuleEngine message with no field name. The assertion below states the
    // documented behaviour on purpose, so it fails until the lookup is fixed.
    const document = cloneRecord(validModel())
    nestedRecord(document, 'model')['author'] = 'someone'

    const result = validateAgainstSchema('0.1', document, PATH)

    expect(result.issues.map((issue) => issue.message)).toContainEqual(
      expect.stringContaining('author'),
    )
  })
})

describe('validateAgainstSchema / enum 与 type', () => {
  it('枚举值不在允许集合内时失败，并给出 instancePath', () => {
    const document = cloneRecord(validModel())
    nestedRecord(document, 'model')['review_status'] = 'approved'

    const result = validateAgainstSchema('0.1', document, PATH)

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.instancePath)).toContain('/model/review_status')
  })

  it('类型不符时失败', () => {
    const document = cloneRecord(validModel())
    document['components'] = 'not-an-array'

    const result = validateAgainstSchema('0.1', document, PATH)

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.instancePath)).toContain('/components')
  })

  it('schema_version 不是常量 0.1 时失败', () => {
    const document = cloneRecord(validModel())
    document['schema_version'] = '0.2'

    const result = validateAgainstSchema('0.1', document, PATH)

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.instancePath)).toContain('/schema_version')
  })
})

describe('validateAgainstSchema / 错误版本', () => {
  it('未注册的版本返回 UNSUPPORTED_SCHEMA_VERSION，且不尝试宽松解析', () => {
    for (const version of ['0.2', '1.0', '0.1.0', 'v0.1', '']) {
      const result = validateAgainstSchema(version, validModel(), PATH)

      expect(result.ok, version).toBe(false)
      expect(result.issues).toHaveLength(1)
      expect(result.issues[0]?.code).toBe(ISSUE_CODES.unsupportedSchemaVersion)
      expect(result.issues[0]?.stage).toBe('schema')
      expect(result.issues[0]?.severity).toBe('error')
      expect(result.issues[0]?.relativePath).toBe(PATH)
    }
  })

  it('未注册版本时不会报告 Schema 字段错误（没有可用的校验器）', () => {
    const result = validateAgainstSchema('0.2', { anything: true }, PATH)
    expect(result.issues.map((issue) => issue.code)).not.toContain(
      ISSUE_CODES.schemaValidationFailed,
    )
  })
})

describe('schema registry', () => {
  it('内置 snapshot 只包含 v0.1，并记录来源与校验和', () => {
    expect(SUPPORTED_SCHEMA_VERSIONS).toEqual(['0.1'])
    expect(LATEST_SCHEMA_VERSION).toBe('0.1')

    const snapshot = SCHEMA_SNAPSHOTS[0]
    expect(snapshot?.version).toBe('0.1')
    expect(snapshot?.upstream.length).toBeGreaterThan(0)
    expect(snapshot?.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(snapshot?.schemaId).toContain('0.1')
  })

  it('findSchemaSnapshot 只认已注册版本', () => {
    expect(findSchemaSnapshot('0.1')?.version).toBe('0.1')
    expect(findSchemaSnapshot('0.2')).toBeUndefined()
    expect(findSchemaSnapshot('')).toBeUndefined()
  })

  it('isSupportedSchemaVersion 与 registry 一致', () => {
    expect(isSupportedSchemaVersion('0.1')).toBe(true)
    expect(isSupportedSchemaVersion('0.2')).toBe(false)
    expect(isSupportedSchemaVersion('0.1 ')).toBe(false)
  })

  it('extractSchemaVersion 读取字符串版本', () => {
    expect(extractSchemaVersion({ schema_version: '0.1' })).toBe('0.1')
  })

  it('extractSchemaVersion 把裸数字版本降级为字符串（不支持的写法）', () => {
    // YAML parses a bare `0.1` as a number; stringifying it keeps the value
    // visible in the error message instead of failing as "missing".
    expect(extractSchemaVersion({ schema_version: 0.1 })).toBe('0.1')
    expect(isSupportedSchemaVersion(extractSchemaVersion({ schema_version: 0.1 }) ?? '')).toBe(true)
  })

  it('extractSchemaVersion 对缺失、非字符串或非对象返回 null', () => {
    expect(extractSchemaVersion({ model: {} })).toBeNull()
    expect(extractSchemaVersion({ schema_version: ['0.1'] })).toBeNull()
    expect(extractSchemaVersion({ schema_version: null })).toBeNull()
    expect(extractSchemaVersion('0.1')).toBeNull()
    expect(extractSchemaVersion(['0.1'])).toBeNull()
    expect(extractSchemaVersion(null)).toBeNull()
    expect(extractSchemaVersion(undefined)).toBeNull()
  })
})
