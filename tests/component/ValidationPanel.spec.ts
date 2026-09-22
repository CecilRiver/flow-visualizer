import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ValidationPanel from '@/components/inspector/ValidationPanel.vue'
import { ISSUE_CODES, type ValidationIssue } from '@/domain/validation'

/**
 * Grouping rules of the validation panel (DESIGN.md 17.1, 19.2).
 *
 * The tests assert on the stable issue codes rather than on message wording, so
 * a reworded message does not break them.
 */
const ISSUES: ValidationIssue[] = [
  {
    code: ISSUE_CODES.schemaValidationFailed,
    severity: 'error',
    stage: 'schema',
    relativePath: 'flows/broken.yaml',
    message: 'must have required property 组件',
    instancePath: '/components/3',
    line: 12,
    column: 5,
  },
  {
    code: ISSUE_CODES.schemaValidationFailed,
    severity: 'error',
    stage: 'schema',
    relativePath: 'flows/broken.yaml',
    message: 'must be integer',
    instancePath: '/components/3/level',
    relatedIds: ['l2.rate'],
  },
  {
    code: ISSUE_CODES.yamlSyntaxError,
    severity: 'error',
    stage: 'yaml',
    relativePath: 'flows/broken.yaml',
    message: 'unexpected end of stream',
    line: 40,
  },
  {
    code: ISSUE_CODES.missingSource,
    severity: 'warning',
    stage: 'semantic',
    relativePath: 'flows/good.yaml',
    message: 'evidence 引用了未声明的 source',
    relatedIds: ['source.missing'],
  },
]

describe('ValidationPanel', () => {
  it('groups by file and stage, errors before warnings', () => {
    const wrapper = mount(ValidationPanel, { props: { issues: ISSUES } })

    const groups = wrapper.findAll('.validation-panel__group')
    // broken.yaml/schema, broken.yaml/yaml, good.yaml/semantic.
    expect(groups).toHaveLength(3)

    const files = wrapper.findAll('.validation-panel__file').map((node) => node.text())
    expect(files).toEqual(['flows/broken.yaml', 'flows/broken.yaml', 'flows/good.yaml'])

    expect(groups[0]?.text()).toContain('Schema')
    expect(groups[1]?.text()).toContain('YAML')
    // The warning group is last regardless of where it appeared in the input.
    expect(groups[2]?.text()).toContain('警告 1')
  })

  it('keeps the two issues of one Schema failure together', () => {
    const wrapper = mount(ValidationPanel, { props: { issues: ISSUES } })
    const first = wrapper.findAll('.validation-panel__group')[0]

    expect(first?.findAll('.validation-panel__issue')).toHaveLength(2)
    expect(first?.text()).toContain(ISSUE_CODES.schemaValidationFailed)
    expect(first?.text()).toContain('/components/3')
  })

  it('shows the location and related ids a report needs', () => {
    const wrapper = mount(ValidationPanel, { props: { issues: ISSUES } })
    const text = wrapper.text()

    expect(text).toContain('第 12 行 第 5 列')
    expect(text).toContain('相关：l2.rate')
    expect(text).toContain('第 40 行')
  })

  it('counts errors and warnings separately', () => {
    const wrapper = mount(ValidationPanel, { props: { issues: ISSUES } })
    const counts = wrapper.find('.validation-panel__counts').text()

    expect(counts).toContain('错误 3')
    expect(counts).toContain('警告 1')
  })

  it('emits the file path and close instead of navigating itself', async () => {
    const wrapper = mount(ValidationPanel, { props: { issues: ISSUES } })

    await wrapper.findAll('.validation-panel__file')[0]?.trigger('click')
    expect(wrapper.emitted('selectFile')?.[0]).toEqual(['flows/broken.yaml'])

    await wrapper.find('.validation-panel__close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('says so when there is nothing to report', () => {
    const wrapper = mount(ValidationPanel, { props: { issues: [] } })

    expect(wrapper.text()).toContain('没有发现问题')
    expect(wrapper.findAll('.validation-panel__group')).toHaveLength(0)
  })
})
