import { describe, expect, it } from 'vitest'

import {
  linePosForPointer,
  parseBundleText,
  pointerToPath,
  type ParseBundleResult,
  type ParsedBundleDocument,
} from '@/catalog/parseBundle'
import { ISSUE_CODES, type ValidationIssue } from '@/domain/validation'

/**
 * Layer 1 of the three-layer validator (DESIGN.md 6.6): YAML syntax.
 *
 * These cases deliberately use raw YAML text rather than the fixture builders —
 * the point of this suite is what the parser does with malformed input, and a
 * typed fixture cannot represent most of it.
 */

const PATH = 'scenarios/broken.yaml'

function expectOk(result: ParseBundleResult): ParsedBundleDocument {
  if (!result.ok) {
    throw new Error(`expected a successful parse, got ${result.issues.map((i) => i.code).join(', ')}`)
  }
  return result.value
}

function expectIssues(result: ParseBundleResult): ValidationIssue[] {
  if (result.ok) throw new Error('expected the parse to fail, but it succeeded')
  return result.issues
}

describe('parseBundleText / 合法 YAML', () => {
  it('合法文档解析成功，且不产生任何 issue', () => {
    const parsed = expectOk(
      parseBundleText('model:\n  id: test.model.v0_1\ncomponents:\n  - id: c1\n', PATH),
    )

    expect(parsed.document).toEqual({
      model: { id: 'test.model.v0_1' },
      components: [{ id: 'c1' }],
    })
    // The parsed document is handed straight to Ajv, so it must be a plain
    // JS object graph rather than YAML nodes.
    expect(typeof parsed.document).toBe('object')
  })

  it('解析成功但存在 YAML warning 时仍返回 ok，并把 warning 放进 warnings', () => {
    // `%YAML 1.3` is a directive the library does not know: it downgrades the
    // document to a warning instead of an error, and the document is still
    // usable. The caller must not lose it.
    const result = parseBundleText('%YAML 1.3\n---\nmodel:\n  id: test\n', PATH)
    if (!result.ok) throw new Error('expected a successful parse')

    expect(result.value.document).toEqual({ model: { id: 'test' } })
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]?.severity).toBe('warning')
    expect(result.warnings[0]?.code).toBe(ISSUE_CODES.yamlSyntaxError)
    expect(result.warnings[0]?.stage).toBe('yaml')
    expect(result.warnings[0]?.relativePath).toBe(PATH)
    // A warning still has a location, so the panel can point at the line.
    expect(result.warnings[0]?.line).toBe(1)
    expect(result.warnings[0]?.column).toBeGreaterThan(0)
  })

  it('无 warning 时 warnings 为空数组，而不是 undefined', () => {
    const result = parseBundleText('a: 1\n', PATH)
    if (!result.ok) throw new Error('expected a successful parse')
    expect(result.warnings).toEqual([])
  })
})

describe('parseBundleText / 语法错误', () => {
  it('重复键报语法错误，并给出出错行列', () => {
    const issues = expectIssues(parseBundleText('model:\n  id: a\n  id: b\n', PATH))

    expect(issues).toHaveLength(1)
    const issue = issues[0]
    expect(issue?.code).toBe(ISSUE_CODES.yamlSyntaxError)
    expect(issue?.severity).toBe('error')
    expect(issue?.stage).toBe('yaml')
    expect(issue?.relativePath).toBe(PATH)
    // The second `id:` is on line 3, one space in.
    expect(issue?.line).toBe(3)
    expect(issue?.column).toBe(3)
  })

  it('未闭合的 flow 序列报语法错误并定位到出错行', () => {
    const issues = expectIssues(parseBundleText('a: [1, 2\nb: 3\n', PATH))

    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0]?.code).toBe(ISSUE_CODES.yamlSyntaxError)
    expect(issues[0]?.line).toBeGreaterThan(0)
    expect(issues[0]?.column).toBeGreaterThan(0)
  })

  it('多个语法错误逐条上报，全部带相对路径', () => {
    const issues = expectIssues(parseBundleText('a: 1\na: 2\nb: 1\nb: 2\n', PATH))

    expect(issues.length).toBeGreaterThanOrEqual(2)
    for (const issue of issues) {
      expect(issue.code).toBe(ISSUE_CODES.yamlSyntaxError)
      expect(issue.relativePath).toBe(PATH)
    }
  })
})

describe('parseBundleText / 非对象根节点', () => {
  it('数组根节点被拒绝，且没有行列（根节点错位没有单点位置）', () => {
    const issues = expectIssues(parseBundleText('- a\n- b\n', PATH))

    expect(issues).toHaveLength(1)
    expect(issues[0]?.code).toBe(ISSUE_CODES.yamlRootNotObject)
    expect(issues[0]?.severity).toBe('error')
    expect(issues[0]?.stage).toBe('yaml')
    expect(issues[0]?.relativePath).toBe(PATH)
    expect(issues[0]?.line).toBeUndefined()
  })

  it('标量根节点同样被拒绝', () => {
    const issues = expectIssues(parseBundleText('just a scalar\n', PATH))
    expect(issues).toHaveLength(1)
    expect(issues[0]?.code).toBe(ISSUE_CODES.yamlRootNotObject)
  })

  it('空文档（null 根节点）被拒绝', () => {
    const issues = expectIssues(parseBundleText('', PATH))
    expect(issues).toHaveLength(1)
    expect(issues[0]?.code).toBe(ISSUE_CODES.yamlRootNotObject)
  })

  it('根节点是对象、只是某些值为数组时仍然合法', () => {
    const parsed = expectOk(parseBundleText('levels: [0, 1, 2]\n', PATH))
    expect(parsed.document).toEqual({ levels: [0, 1, 2] })
  })
})

describe('pointerToPath', () => {
  it('把 JSON Pointer 拆成 getIn 路径，数字段还原为索引', () => {
    expect(pointerToPath('/components/0/ports/1/id')).toEqual(['components', 0, 'ports', 1, 'id'])
  })

  it('反转 ~1 与 ~0 转义', () => {
    expect(pointerToPath('/a~1b/c~0d')).toEqual(['a/b', 'c~d'])
  })

  it('只有规范形式的前导零字符串才保持字符串', () => {
    // `007` is a legitimate property name, `0` is an array index — the
    // difference decides whether getIn walks a map or a sequence.
    expect(pointerToPath('/0')).toEqual([0])
    expect(pointerToPath('/007')).toEqual(['007'])
    expect(pointerToPath('/')).toEqual([''])
  })
})

describe('linePosForPointer', () => {
  const text = 'model:\n  id: test\ncomponents:\n  - id: c1\n  - id: c2\n'
  const parsed = expectOk(parseBundleText(text, PATH))

  it('能定位到对象字段所在行列', () => {
    expect(linePosForPointer(parsed, '/model/id')).toEqual({ line: 2, column: 7 })
  })

  it('能定位到数组元素', () => {
    expect(linePosForPointer(parsed, '/components/1')).toEqual({ line: 5, column: 5 })
  })

  it('空指针返回 null（根节点没有单独的位置）', () => {
    expect(linePosForPointer(parsed, '')).toBeNull()
  })

  it('指向不存在的路径返回 null，而不是抛错', () => {
    expect(linePosForPointer(parsed, '/model/missing')).toBeNull()
    expect(linePosForPointer(parsed, '/nope/deeper')).toBeNull()
  })

  it('指向标量内部时返回 null', () => {
    // `id` is a scalar; asking for something below it must not throw.
    expect(linePosForPointer(parsed, '/model/id/deeper')).toBeNull()
  })
})
