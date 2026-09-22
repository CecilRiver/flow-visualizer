import type {
  Component,
  ComponentKind,
  DataContract,
  Flow,
  FlowKind,
  FlowModelV01,
  Scenario,
  Source,
  Verification,
} from '@/domain/model'

/**
 * Builders for synthetic models used by unit tests.
 *
 * They exist so a test can state only the fields it is actually about — the
 * projection matrix in DESIGN.md 9.7 is unreadable if every case has to spell
 * out seven required `model` fields first. Real-folder fixtures still live as
 * YAML under `tests/fixtures/folders/` and go through the full load pipeline.
 */

/**
 * The Schema marks these collections `minItems: 1` and the generated types
 * carry that as a non-empty tuple. Building the tuple here keeps a fixture that
 * forgets its sources failing loudly instead of silently producing a document
 * the validator would reject.
 */
function nonEmpty<T>(items: readonly T[], collection: string): [T, ...T[]] {
  const [first, ...rest] = items
  if (first === undefined) throw new Error(`fixture has no ${collection}`)
  return [first, ...rest]
}

export function makeSource(id: string, overrides: Partial<Source> = {}): Source {
  return {
    id,
    kind: 'source_code',
    title: id,
    path: 'ArduCopter/Test.cpp',
    revision: 'test-revision',
    ...overrides,
  }
}

export function makeContract(id: string, overrides: Partial<DataContract> = {}): DataContract {
  return {
    id,
    name: id,
    description: `${id} description`,
    fields: [{ name: 'value', type: 'number', description: 'test field' }],
    ...overrides,
  }
}

export interface ComponentInit {
  id: string
  name?: string
  level?: number
  scope?: 'internal' | 'external'
  kind?: ComponentKind
  parent_id?: string
  verification?: Verification
}

export function makeComponent(init: ComponentInit): Component {
  const component: Component = {
    id: init.id,
    name: init.name ?? init.id,
    level: init.level ?? 2,
    scope: init.scope ?? 'internal',
    kind: init.kind ?? 'controller',
    responsibility: `${init.id} responsibility`,
    verification: init.verification ?? 'docs_and_code_confirmed',
  }
  if (init.parent_id !== undefined) component.parent_id = init.parent_id
  return component
}

export interface FlowInit {
  id: string
  name?: string
  from: string
  to: string
  kind?: FlowKind
  feedback?: boolean
  verification?: Verification
  data_contract_id?: string
  scenario_ids?: string[]
}

export function makeFlow(init: FlowInit): Flow {
  const contract = init.data_contract_id ?? 'data.test'
  const flow: Flow = {
    id: init.id,
    name: init.name ?? init.id,
    kind: init.kind ?? 'command',
    from: { component_id: init.from, port_id: 'out' },
    to: { component_id: init.to, port_id: 'in' },
    data_contract_id: contract,
    transport: 'direct_call',
    cadence: { kind: 'periodic' },
    transform: 'identity',
    verification: init.verification ?? 'docs_and_code_confirmed',
    evidence: [{ source_id: 'source.test', support: 'direct', claim: 'test claim' }],
    scenario_ids: nonEmpty(init.scenario_ids ?? ['scenario.test'], 'scenario_ids'),
  }
  if (init.feedback !== undefined) flow.feedback = init.feedback
  return flow
}

export interface ScenarioInit {
  id: string
  component_ids: string[]
  flow_ids: string[]
  default_level?: number
}

export function makeScenario(init: ScenarioInit): Scenario {
  return {
    id: init.id,
    name: init.id,
    description: `${init.id} description`,
    default_level: init.default_level ?? 2,
    entry_conditions: ['entry'],
    exit_conditions: ['exit'],
    component_ids: nonEmpty(init.component_ids, 'component_ids'),
    flow_ids: nonEmpty(init.flow_ids, 'flow_ids'),
    verification: 'docs_and_code_confirmed',
    evidence: [{ source_id: 'source.test', support: 'direct', claim: 'scenario claim' }],
  }
}

export interface ModelInit {
  id?: string
  revision?: string
  sources?: Source[]
  contracts?: DataContract[]
  components: Component[]
  flows: Flow[]
  scenarios: Scenario[]
}

export function makeModel(init: ModelInit): FlowModelV01 {
  return {
    schema_version: '0.1',
    model: {
      id: init.id ?? 'test.model.v0_1',
      title: 'Test model',
      description: 'Synthetic model for unit tests',
      vehicle: 'ArduCopter',
      source_revision: init.revision ?? 'test-revision',
      generated_on: '2026-01-01',
      language: 'zh-CN',
      review_status: 'evidence_checked',
      scope: {
        levels: [0, 1, 2],
        frame_profile: 'multirotor_matrix',
        includes: ['include'],
        excludes: ['exclude'],
        assumptions: ['assumption'],
      },
    },
    sources: nonEmpty(init.sources ?? [makeSource('source.test')], 'sources'),
    data_contracts: nonEmpty(init.contracts ?? [makeContract('data.test')], 'data_contracts'),
    components: nonEmpty(init.components, 'components'),
    flows: nonEmpty(init.flows, 'flows'),
    scenarios: nonEmpty(init.scenarios, 'scenarios'),
  }
}

/** Adds the ports a flow endpoint references, so Schema validation passes. */
export function withPorts(component: Component, contractIds: readonly string[]): Component {
  const ports: Component['ports'] = [
    { id: 'in', name: 'in', direction: 'input', data_contract_id: contractIds[0] ?? 'data.test' },
    { id: 'out', name: 'out', direction: 'output', data_contract_id: contractIds[0] ?? 'data.test' },
  ]
  return { ...component, ports }
}
