import { describe, expect, it } from 'vitest'

import { runSemanticChecks } from '@/catalog/semanticChecks'
import type { Component, DataContract, Flow, FlowModelV01, Scenario, Source } from '@/domain/model'
import { ISSUE_CODES, type ValidationIssue } from '@/domain/validation'

import {
  makeComponent,
  makeContract,
  makeFlow,
  makeModel,
  makeScenario,
  makeSource,
  withPorts,
} from '../fixtures/buildModel'

/**
 * Layer 3 of the three-layer validator (DESIGN.md 6.6): cross-reference
 * integrity that JSON Schema cannot express.
 *
 * DESIGN 19.4 requires a case per branch, so each check the module can report —
 * and each way it can decide *not* to report — has its own case below. Every
 * case starts from the same legal model and mutates exactly one thing, so a
 * failure points at one rule.
 *
 * Assertions are on `code`, `instancePath` and `relatedIds`; the wording of a
 * message is only checked where the message is the only way to tell two issues
 * with the same code apart.
 */

const PATH = 'scenarios/test.yaml'

const SOURCE_ID = 'source.test'
const CONTRACT_ID = 'data.test'

function baseComponents(): Component[] {
  return [
    makeComponent({ id: 'system.ac', level: 0, kind: 'system' }),
    makeComponent({ id: 'ext.rc', level: 0, kind: 'actor', scope: 'external' }),
    makeComponent({
      id: 'domain.control',
      level: 1,
      kind: 'capability_domain',
      parent_id: 'system.ac',
    }),
    withPorts(makeComponent({ id: 'l2.attitude', level: 2, parent_id: 'domain.control' }), [
      CONTRACT_ID,
    ]),
    withPorts(makeComponent({ id: 'l2.rate', level: 2, parent_id: 'domain.control' }), [
      CONTRACT_ID,
    ]),
  ]
}

function baseFlows(): Flow[] {
  return [makeFlow({ id: 'flow.attitude_rate', from: 'l2.attitude', to: 'l2.rate' })]
}

/** Lists every component and flow, so only the mutation under test can fail. */
function baseScenario(components: readonly Component[], flows: readonly Flow[]): Scenario {
  return makeScenario({
    id: 'scenario.test',
    component_ids: components.map((component) => component.id),
    flow_ids: flows.map((flow) => flow.id),
  })
}

interface ModelParts {
  components?: Component[]
  flows?: Flow[]
  scenarios?: Scenario[]
  sources?: Source[]
  contracts?: DataContract[]
}

function modelWith(parts: ModelParts = {}): FlowModelV01 {
  const components = parts.components ?? baseComponents()
  const flows = parts.flows ?? baseFlows()
  return makeModel({
    components,
    flows,
    scenarios: parts.scenarios ?? [baseScenario(components, flows)],
    sources: parts.sources,
    contracts: parts.contracts,
  })
}

function check(model: FlowModelV01): ValidationIssue[] {
  return runSemanticChecks(model, PATH)
}

/** Patches one base component by id, keeping every other field untouched. */
function patchComponent(id: string, patch: Partial<Component>): Component[] {
  return baseComponents().map((component) =>
    component.id === id ? { ...component, ...patch } : component,
  )
}

/** Replaces the single base flow with a patched copy of it. */
function patchFlow(patch: Partial<Flow>): Flow[] {
  const flow = baseFlows()[0]
  if (flow === undefined) throw new Error('fixture has no base flow')
  return [{ ...flow, ...patch }]
}

describe('runSemanticChecks / 合法模型', () => {
  it('合法模型不产生任何语义问题', () => {
    expect(check(modelWith())).toEqual([])
  })

  it('问题带上语义阶段的通用字段', () => {
    const issues = check(modelWith({ components: patchComponent('l2.rate', { level: 1 }) }))

    expect(issues.length).toBeGreaterThan(0)
    for (const issue of issues) {
      expect(issue.stage).toBe('semantic')
      expect(issue.severity).toBe('error')
      expect(issue.relativePath).toBe(PATH)
    }
  })
})

describe('runSemanticChecks / ID 唯一性', () => {
  it('components 中重复的 ID 报 DUPLICATE_ID', () => {
    const components = [...baseComponents(), makeComponent({ id: 'l2.rate', level: 2, parent_id: 'domain.control' })]
    const issues = check(modelWith({ components }))

    const duplicate = issues.find((issue) => issue.code === ISSUE_CODES.duplicateId)
    expect(duplicate?.instancePath).toBe('/components/5/id')
    expect(duplicate?.relatedIds).toEqual(['l2.rate'])
  })

  it('flows 中重复的 ID 报 DUPLICATE_ID', () => {
    const flows = [...baseFlows(), makeFlow({ id: 'flow.attitude_rate', from: 'l2.attitude', to: 'l2.rate' })]
    const issues = check(modelWith({ flows }))

    expect(issues.some((issue) => issue.code === ISSUE_CODES.duplicateId && issue.instancePath === '/flows/1/id')).toBe(true)
  })

  it('sources 中重复的 ID 报 DUPLICATE_ID', () => {
    const issues = check(modelWith({ sources: [makeSource(SOURCE_ID), makeSource(SOURCE_ID)] }))

    expect(issues.some((issue) => issue.code === ISSUE_CODES.duplicateId && issue.instancePath === '/sources/1/id')).toBe(true)
  })

  it('data_contracts 中重复的 ID 报 DUPLICATE_ID', () => {
    const issues = check(modelWith({ contracts: [makeContract(CONTRACT_ID), makeContract(CONTRACT_ID)] }))

    expect(issues.some((issue) => issue.code === ISSUE_CODES.duplicateId && issue.instancePath === '/data_contracts/1/id')).toBe(true)
  })

  it('scenarios 中重复的 ID 报 DUPLICATE_ID', () => {
    const components = baseComponents()
    const flows = baseFlows()
    const duplicate = makeScenario({
      id: 'scenario.test',
      component_ids: components.map((component) => component.id),
      flow_ids: flows.map((flow) => flow.id),
    })
    const issues = check(modelWith({ components, flows, scenarios: [baseScenario(components, flows), duplicate] }))

    expect(issues.some((issue) => issue.code === ISSUE_CODES.duplicateId && issue.instancePath === '/scenarios/1/id')).toBe(true)
  })

  it('三次以上重复同一个 ID 只报一次', () => {
    const components = [
      ...baseComponents(),
      makeComponent({ id: 'l2.rate', level: 2, parent_id: 'domain.control' }),
      makeComponent({ id: 'l2.rate', level: 2, parent_id: 'domain.control' }),
    ]
    const issues = check(modelWith({ components }))

    expect(issues.filter((issue) => issue.code === ISSUE_CODES.duplicateId)).toHaveLength(1)
  })
})

describe('runSemanticChecks / 父链', () => {
  it('外部组件声明 parent_id 报 INVALID_LEVEL_PARENT', () => {
    const issues = check(
      modelWith({ components: patchComponent('ext.rc', { parent_id: 'system.ac' }) }),
    )

    expect(
      issues.some(
        (issue) =>
          issue.code === ISSUE_CODES.invalidLevelParent &&
          issue.instancePath === '/components/1/parent_id',
      ),
    ).toBe(true)
  })

  it('内部 L0 组件声明 parent_id 报 INVALID_LEVEL_PARENT', () => {
    const issues = check(
      modelWith({ components: patchComponent('system.ac', { parent_id: 'domain.control' }) }),
    )

    expect(
      issues.some(
        (issue) =>
          issue.code === ISSUE_CODES.invalidLevelParent &&
          issue.instancePath === '/components/0/parent_id',
      ),
    ).toBe(true)
  })

  it('内部 L1/L2 组件缺少 parent_id 报 MISSING_PARENT', () => {
    const issues = check(modelWith({ components: patchComponent('l2.rate', { parent_id: undefined }) }))

    const missing = issues.find((issue) => issue.code === ISSUE_CODES.missingParent)
    expect(missing?.instancePath).toBe('/components/4/parent_id')
    expect(missing?.relatedIds).toEqual(['l2.rate'])
  })

  it('父组件不存在报 MISSING_PARENT，并把父子 ID 都带出来', () => {
    const issues = check(
      modelWith({ components: patchComponent('l2.rate', { parent_id: 'domain.ghost' }) }),
    )

    const missing = issues.find((issue) => issue.code === ISSUE_CODES.missingParent)
    expect(missing?.relatedIds).toEqual(['l2.rate', 'domain.ghost'])
  })

  it('父组件是外部组件报 INVALID_LEVEL_PARENT', () => {
    const issues = check(modelWith({ components: patchComponent('l2.rate', { parent_id: 'ext.rc' }) }))

    expect(
      issues.some(
        (issue) =>
          issue.code === ISSUE_CODES.invalidLevelParent &&
          issue.relatedIds?.includes('ext.rc') === true,
      ),
    ).toBe(true)
  })

  it('父组件层级不是恰好上一级报 INVALID_LEVEL_PARENT', () => {
    // L2 hanging directly off the L0 system: one level is skipped.
    const issues = check(
      modelWith({ components: patchComponent('l2.rate', { parent_id: 'system.ac' }) }),
    )

    expect(
      issues.some(
        (issue) =>
          issue.code === ISSUE_CODES.invalidLevelParent &&
          issue.instancePath === '/components/4/parent_id',
      ),
    ).toBe(true)
  })

  it('父链存在循环报 INVALID_LEVEL_PARENT', () => {
    // `level` is a plain `number` in the generated type, and the "parent sits
    // exactly one level up" rule would reject any cycle built from integers —
    // a fractional ladder is the only shape that reaches the cycle walk. The
    // walk itself is what this case is about.
    const components = [
      makeComponent({ id: 'loop.a', level: 1.5, parent_id: 'loop.b' }),
      makeComponent({ id: 'loop.b', level: 0.5, parent_id: 'loop.a' }),
    ]
    const issues = check(modelWith({ components }))

    const atLoop = issues.filter(
      (issue) =>
        issue.code === ISSUE_CODES.invalidLevelParent &&
        issue.instancePath === '/components/0/parent_id',
    )
    expect(atLoop).toHaveLength(1)
    // `loop.b` is also rejected, by the level rule; the message is what tells
    // the two apart.
    expect(atLoop[0]?.message).toContain('循环')
    expect(atLoop[0]?.relatedIds).toEqual(['loop.a', 'loop.a'])
  })
})

describe('runSemanticChecks / 端口与 data contract', () => {
  it('flow 引用不存在的 data contract 报 MISSING_CONTRACT', () => {
    const issues = check(modelWith({ flows: patchFlow({ data_contract_id: 'data.ghost' }) }))

    const missing = issues.find((issue) => issue.code === ISSUE_CODES.missingContract)
    expect(missing?.instancePath).toBe('/flows/0/data_contract_id')
    expect(missing?.relatedIds).toEqual(['flow.attitude_rate', 'data.ghost'])
  })

  it('flow 的 from 组件不存在报 MISSING_PORT，并指向 component_id', () => {
    const issues = check(
      modelWith({
        flows: patchFlow({ from: { component_id: 'l2.ghost', port_id: 'out' } }),
      }),
    )

    const missing = issues.find((issue) => issue.code === ISSUE_CODES.missingPort)
    expect(missing?.instancePath).toBe('/flows/0/from/component_id')
    expect(missing?.relatedIds).toEqual(['flow.attitude_rate', 'l2.ghost'])
  })

  it('flow 的 to 组件不存在报 MISSING_PORT，并指向 component_id', () => {
    const issues = check(
      modelWith({ flows: patchFlow({ to: { component_id: 'l2.ghost', port_id: 'in' } }) }),
    )

    expect(
      issues.some(
        (issue) =>
          issue.code === ISSUE_CODES.missingPort &&
          issue.instancePath === '/flows/0/to/component_id',
      ),
    ).toBe(true)
  })

  it('flow 端点端口不存在报 MISSING_PORT，并指向 port_id', () => {
    const issues = check(
      modelWith({ flows: patchFlow({ from: { component_id: 'l2.attitude', port_id: 'ghost' } }) }),
    )

    const missing = issues.find((issue) => issue.code === ISSUE_CODES.missingPort)
    expect(missing?.instancePath).toBe('/flows/0/from/port_id')
    expect(missing?.relatedIds).toEqual(['flow.attitude_rate', 'l2.attitude', 'ghost'])
  })

  it('from 端口方向不是 output 报 PORT_DIRECTION_MISMATCH', () => {
    const issues = check(
      modelWith({ flows: patchFlow({ from: { component_id: 'l2.attitude', port_id: 'in' } }) }),
    )

    const mismatch = issues.find((issue) => issue.code === ISSUE_CODES.portDirectionMismatch)
    expect(mismatch?.instancePath).toBe('/flows/0/from/port_id')
    expect(mismatch?.relatedIds).toEqual(['flow.attitude_rate', 'in'])
  })

  it('to 端口方向不是 input 报 PORT_DIRECTION_MISMATCH', () => {
    const issues = check(
      modelWith({ flows: patchFlow({ to: { component_id: 'l2.rate', port_id: 'out' } }) }),
    )

    expect(
      issues.some(
        (issue) =>
          issue.code === ISSUE_CODES.portDirectionMismatch &&
          issue.instancePath === '/flows/0/to/port_id',
      ),
    ).toBe(true)
  })

  it('方向已经不对时不再连带报告契约不一致', () => {
    // Both endpoints point at a port of the wrong direction *and* whose port
    // contract differs from the flow's; only the direction may be reported,
    // otherwise one mistake floods the panel with a second, misleading issue.
    const components = baseComponents().map((component) => withPorts(component, ['data.alt']))
    const issues = check(
      modelWith({
        components,
        flows: patchFlow({
          from: { component_id: 'l2.attitude', port_id: 'in' },
          to: { component_id: 'l2.rate', port_id: 'out' },
        }),
        contracts: [makeContract(CONTRACT_ID), makeContract('data.alt')],
      }),
    )

    expect(issues.map((issue) => issue.code)).not.toContain(ISSUE_CODES.dataContractMismatch)
    expect(issues.filter((issue) => issue.code === ISSUE_CODES.portDirectionMismatch)).toHaveLength(2)
  })

  it('端点端口契约与 flow 声明的契约不一致报 DATA_CONTRACT_MISMATCH', () => {
    const components = baseComponents().map((component) => withPorts(component, ['data.alt']))
    const issues = check(
      modelWith({
        components,
        contracts: [makeContract(CONTRACT_ID), makeContract('data.alt')],
      }),
    )

    const mismatches = issues.filter((issue) => issue.code === ISSUE_CODES.dataContractMismatch)
    expect(mismatches.map((issue) => issue.instancePath)).toEqual([
      '/flows/0/from/port_id',
      '/flows/0/to/port_id',
    ])
    expect(mismatches[0]?.relatedIds).toEqual(['flow.attitude_rate', 'out', CONTRACT_ID])
  })

  it('组件端口引用不存在的 data contract 报 MISSING_CONTRACT', () => {
    const components = patchComponent('l2.rate', {
      ports: [{ id: 'in', name: 'in', direction: 'input', data_contract_id: 'data.ghost' }],
    })
    const issues = check(modelWith({ components }))

    expect(
      issues.some(
        (issue) =>
          issue.code === ISSUE_CODES.missingContract &&
          issue.instancePath === '/components/4/ports/0/data_contract_id',
      ),
    ).toBe(true)
  })

  it('组件没有 ports 数组时端点检查报 MISSING_PORT，而不是抛错', () => {
    // The `ports` key is absent, so the optional chain has to short-circuit.
    const components = patchComponent('l2.rate', { ports: undefined })
    const issues = check(modelWith({ components }))

    expect(
      issues.some(
        (issue) =>
          issue.code === ISSUE_CODES.missingPort && issue.instancePath === '/flows/0/to/port_id',
      ),
    ).toBe(true)
  })
})

describe('runSemanticChecks / evidence 与 source 引用', () => {
  it('flow evidence 引用不存在的 source 报 MISSING_SOURCE', () => {
    const issues = check(
      modelWith({
        flows: patchFlow({
          evidence: [{ source_id: 'source.ghost', support: 'direct', claim: 'claim' }],
        }),
      }),
    )

    const missing = issues.find((issue) => issue.code === ISSUE_CODES.missingSource)
    expect(missing?.instancePath).toBe('/flows/0/evidence/0/source_id')
    expect(missing?.relatedIds).toEqual(['source.ghost'])
  })

  it('组件 evidence 引用不存在的 source 报 MISSING_SOURCE', () => {
    const issues = check(
      modelWith({
        components: patchComponent('l2.rate', {
          evidence: [{ source_id: 'source.ghost', support: 'direct', claim: 'claim' }],
        }),
      }),
    )

    expect(
      issues.some(
        (issue) =>
          issue.code === ISSUE_CODES.missingSource &&
          issue.instancePath === '/components/4/evidence/0/source_id',
      ),
    ).toBe(true)
  })

  it('组件实现绑定引用不存在的 source 报 MISSING_SOURCE', () => {
    const issues = check(
      modelWith({
        components: patchComponent('l2.rate', {
          implementation: [{ source_id: 'source.ghost', role: 'primary' }],
        }),
      }),
    )

    expect(
      issues.some(
        (issue) =>
          issue.code === ISSUE_CODES.missingSource &&
          issue.instancePath === '/components/4/implementation/0/source_id',
      ),
    ).toBe(true)
  })

  it('data contract 的 evidence 引用不存在的 source 报 MISSING_SOURCE', () => {
    const issues = check(
      modelWith({
        contracts: [
          makeContract(CONTRACT_ID, {
            evidence: [{ source_id: 'source.ghost', support: 'contextual', claim: 'claim' }],
          }),
        ],
      }),
    )

    expect(
      issues.some(
        (issue) =>
          issue.code === ISSUE_CODES.missingSource &&
          issue.instancePath === '/data_contracts/0/evidence/0/source_id',
      ),
    ).toBe(true)
  })

  it('scenario 的 evidence 引用不存在的 source 报 MISSING_SOURCE', () => {
    const components = baseComponents()
    const flows = baseFlows()
    const scenario: Scenario = {
      ...baseScenario(components, flows),
      evidence: [{ source_id: 'source.ghost', support: 'direct', claim: 'claim' }],
    }
    const issues = check(modelWith({ components, flows, scenarios: [scenario] }))

    expect(
      issues.some(
        (issue) =>
          issue.code === ISSUE_CODES.missingSource &&
          issue.instancePath === '/scenarios/0/evidence/0/source_id',
      ),
    ).toBe(true)
  })

  it('多个 evidence 条目逐条定位到各自的下标', () => {
    const issues = check(
      modelWith({
        flows: patchFlow({
          evidence: [
            { source_id: SOURCE_ID, support: 'direct', claim: 'good' },
            { source_id: 'source.ghost', support: 'direct', claim: 'bad' },
          ],
        }),
      }),
    )

    expect(issues.map((issue) => issue.instancePath)).toContain('/flows/0/evidence/1/source_id')
  })
})

describe('runSemanticChecks / scenario 引用', () => {
  it('scenario 引用不存在的组件报 MISSING_SCENARIO_REFERENCE', () => {
    const components = baseComponents()
    const flows = baseFlows()
    const scenario = makeScenario({
      id: 'scenario.test',
      component_ids: [...components.map((component) => component.id), 'l2.ghost'],
      flow_ids: flows.map((flow) => flow.id),
    })
    const issues = check(modelWith({ components, flows, scenarios: [scenario] }))

    const missing = issues.find((issue) => issue.code === ISSUE_CODES.missingScenarioReference)
    expect(missing?.instancePath).toBe('/scenarios/0/component_ids/5')
    expect(missing?.relatedIds).toEqual(['scenario.test', 'l2.ghost'])
  })

  it('scenario 引用不存在的 flow 报 MISSING_SCENARIO_REFERENCE', () => {
    const components = baseComponents()
    const flows = baseFlows()
    const scenario = makeScenario({
      id: 'scenario.test',
      component_ids: components.map((component) => component.id),
      flow_ids: [...flows.map((flow) => flow.id), 'flow.ghost'],
    })
    const issues = check(modelWith({ components, flows, scenarios: [scenario] }))

    expect(
      issues.some(
        (issue) =>
          issue.code === ISSUE_CODES.missingScenarioReference &&
          issue.instancePath === '/scenarios/0/flow_ids/1',
      ),
    ).toBe(true)
  })

  it('flow 端点组件不在 scenario 的 component_ids 中报 SCENARIO_ENDPOINT_OUTSIDE_SCENARIO', () => {
    const components = baseComponents()
    const flows = baseFlows()
    // `l2.rate` is deliberately missing from the scenario: the flow that ends
    // there drags a foreign component into the view.
    const scenario = makeScenario({
      id: 'scenario.test',
      component_ids: components
        .filter((component) => component.id !== 'l2.rate')
        .map((component) => component.id),
      flow_ids: flows.map((flow) => flow.id),
    })
    const issues = check(modelWith({ components, flows, scenarios: [scenario] }))

    const outside = issues.filter(
      (issue) => issue.code === ISSUE_CODES.scenarioEndpointOutsideScenario,
    )
    expect(outside).toHaveLength(1)
    expect(outside[0]?.message).toContain('to')
    expect(outside[0]?.relatedIds).toEqual(['scenario.test', 'flow.attitude_rate', 'l2.rate'])
  })

  it('两端都不在 scenario 中时，两个端点各报一次', () => {
    const components = baseComponents()
    const flows = baseFlows()
    const scenario = makeScenario({
      id: 'scenario.test',
      component_ids: ['system.ac', 'ext.rc', 'domain.control'],
      flow_ids: flows.map((flow) => flow.id),
    })
    const issues = check(modelWith({ components, flows, scenarios: [scenario] }))

    const outside = issues.filter(
      (issue) => issue.code === ISSUE_CODES.scenarioEndpointOutsideScenario,
    )
    expect(outside).toHaveLength(2)
    // Both are reported against the scenario, one per endpoint role.
    expect(outside.map((issue) => issue.instancePath)).toEqual(['/scenarios/0', '/scenarios/0'])
    expect(outside.map((issue) => issue.message.includes('from'))).toEqual([true, false])
  })
})

describe('runSemanticChecks / scenario 与 flow 对称性', () => {
  it('scenario 列出了 flow，但 flow 的 scenario_ids 未包含该场景：报一次', () => {
    const flows = patchFlow({ scenario_ids: ['scenario.other'] })
    const issues = check(modelWith({ flows }))

    const asymmetry = issues.filter((issue) => issue.code === ISSUE_CODES.scenarioFlowAsymmetry)
    expect(asymmetry).toHaveLength(1)
    expect(asymmetry[0]?.instancePath).toBe('/scenarios/0')
    expect(asymmetry[0]?.relatedIds).toEqual(['scenario.test', 'flow.attitude_rate'])
    // This direction blames the flow's own declaration.
    expect(asymmetry[0]?.message).toContain('scenario_ids')
  })

  it('flow 声明属于某场景，但该场景的 flow_ids 未列出它：报一次', () => {
    const flows = [
      makeFlow({ id: 'flow.a', from: 'l2.attitude', to: 'l2.rate' }),
      makeFlow({ id: 'flow.hidden', from: 'l2.attitude', to: 'l2.rate' }),
    ]
    const components = baseComponents()
    // `flow.hidden` still claims `scenario.test`, but the scenario only lists
    // `flow.a` — the declaration is one-sided.
    const scenario = makeScenario({
      id: 'scenario.test',
      component_ids: components.map((component) => component.id),
      flow_ids: ['flow.a'],
    })
    const issues = check(modelWith({ components, flows, scenarios: [scenario] }))

    const asymmetry = issues.filter((issue) => issue.code === ISSUE_CODES.scenarioFlowAsymmetry)
    expect(asymmetry).toHaveLength(1)
    expect(asymmetry[0]?.relatedIds).toEqual(['scenario.test', 'flow.hidden'])
    // This direction blames the scenario's own list.
    expect(asymmetry[0]?.message).toContain('flow_ids')
  })

  it('同一 flow 属于两个场景且两边都声明时不报任何问题', () => {
    const components = baseComponents()
    const flows = [
      makeFlow({
        id: 'flow.a',
        from: 'l2.attitude',
        to: 'l2.rate',
        scenario_ids: ['scenario.a', 'scenario.b'],
      }),
    ]
    const scenarios = [
      makeScenario({
        id: 'scenario.a',
        component_ids: components.map((component) => component.id),
        flow_ids: ['flow.a'],
      }),
      makeScenario({
        id: 'scenario.b',
        component_ids: components.map((component) => component.id),
        flow_ids: ['flow.a'],
      }),
    ]
    const issues = check(modelWith({ components, flows, scenarios }))

    expect(issues).toEqual([])
  })

  it('flow 声明了不存在的场景：报 MISSING_SCENARIO_REFERENCE，不是对称性问题', () => {
    const components = baseComponents()
    const flows = [
      makeFlow({
        id: 'flow.a',
        from: 'l2.attitude',
        to: 'l2.rate',
        scenario_ids: ['scenario.ghost'],
      }),
      makeFlow({ id: 'flow.listed', from: 'l2.attitude', to: 'l2.rate' }),
    ]
    const scenario = makeScenario({
      id: 'scenario.test',
      component_ids: components.map((component) => component.id),
      flow_ids: ['flow.listed'],
    })
    const issues = check(modelWith({ components, flows, scenarios: [scenario] }))

    // `flow.a` claims a scenario nothing declares. That is a dangling reference,
    // not an asymmetry: there is no second side to disagree with.
    expect(issues.map((issue) => issue.code)).not.toContain(ISSUE_CODES.scenarioFlowAsymmetry)

    const missing = issues.find(
      (issue) => issue.code === ISSUE_CODES.missingScenarioReference,
    )
    expect(missing?.instancePath).toBe('/flows/0/scenario_ids/0')
    expect(missing?.relatedIds).toEqual(['flow.a', 'scenario.ghost'])
  })

  it('flow 的每个悬空 scenario_ids 条目各自报一次', () => {
    const flows = patchFlow({ scenario_ids: ['scenario.ghost', 'scenario.test', 'scenario.void'] })
    const issues = check(modelWith({ flows }))

    const missing = issues.filter(
      (issue) => issue.code === ISSUE_CODES.missingScenarioReference,
    )
    expect(missing.map((issue) => issue.instancePath)).toEqual([
      '/flows/0/scenario_ids/0',
      '/flows/0/scenario_ids/2',
    ])
  })

  it('flow 指向真实存在的场景时不报问题', () => {
    const flows = patchFlow({ scenario_ids: ['scenario.test'] })
    const issues = check(modelWith({ flows }))

    // `baseScenario` already lists this flow, so both directions agree.
    expect(issues).toHaveLength(0)
  })
})
