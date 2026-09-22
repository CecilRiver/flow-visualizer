import { buildModelIndex, type LoadedBundle } from '@/domain/indexes'
import type { DataContract, FlowModelV01 } from '@/domain/model'

import {
  makeComponent,
  makeContract,
  makeFlow,
  makeModel,
  makeScenario,
  makeSource,
  withPorts,
} from './buildModel'

/**
 * A complete `LoadedBundle` built from a synthetic model.
 *
 * Component tests need a bundle the stores can hold without going through YAML
 * parsing and Schema validation: those two steps are already covered by the
 * catalog and real-model suites, and repeating them here would make a canvas
 * test fail for reasons that have nothing to do with the canvas.
 *
 * The shape is the same one the catalog produces — the graph the components see
 * is identical, which is what makes this a fair stand-in.
 */

/** Two capability domains with two L2 components each, plus two boundaries. */
const COMPONENTS = [
  makeComponent({ id: 'system.ac', level: 0, kind: 'system' }),
  makeComponent({ id: 'ext.rc', level: 0, kind: 'actor', scope: 'external' }),
  makeComponent({ id: 'ext.motors', level: 0, kind: 'physical_device', scope: 'external' }),
  makeComponent({
    id: 'domain.control',
    level: 1,
    kind: 'capability_domain',
    parent_id: 'system.ac',
  }),
  makeComponent({
    id: 'domain.estimate',
    level: 1,
    kind: 'capability_domain',
    parent_id: 'system.ac',
  }),
  makeComponent({
    id: 'l2.attitude',
    level: 2,
    kind: 'controller',
    parent_id: 'domain.control',
    verification: 'docs_and_code_confirmed',
  }),
  makeComponent({
    id: 'l2.rate',
    level: 2,
    kind: 'controller',
    parent_id: 'domain.control',
    verification: 'code_confirmed',
  }),
  makeComponent({
    id: 'l2.ahrs',
    level: 2,
    kind: 'estimator',
    parent_id: 'domain.estimate',
    verification: 'human_verified',
  }),
  makeComponent({
    id: 'l2.imu',
    level: 2,
    kind: 'estimator',
    parent_id: 'domain.estimate',
    verification: 'inferred',
  }),
].map((component) => withPorts(component, ['data.test']))

/**
 * Two contracts, so an aggregated edge can be shown carrying more than one.
 *
 * `data.alt` is deliberately different from `data.test`: two flows that
 * disagree about what they carry must not be summarised as if they agreed.
 */
const CONTRACTS: DataContract[] = [
  makeContract('data.test'),
  makeContract('data.alt', {
    fields: [
      { name: 'value', type: 'number', description: 'test field' },
      { name: 'mode', type: 'enum', description: 'mode', values: ['auto', 'manual'] },
    ],
  }),
]

/**
 * One flow of each interesting shape: forward, feedback, into a boundary, and a
 * pair that aggregates at L1 — both of the pair cross control -> estimate, so
 * they become one edge with two underlying flows and two contracts.
 */
const FLOW_INITS = [
  // `flow.command` and `flow.control.alt` both run from a component inside
  // `domain.control` to one inside `domain.estimate`, so at L1 they project to
  // the same endpoints and aggregate into a single edge.
  { id: 'flow.command', from: 'l2.attitude', to: 'l2.ahrs', kind: 'command' },
  // Weaker verification on purpose: the aggregate of this pair must report
  // `inferred`, not whatever the other flow happens to claim.
  {
    id: 'flow.control.alt',
    from: 'l2.rate',
    to: 'l2.ahrs',
    kind: 'command',
    contract: 'data.alt',
    verification: 'inferred',
  },
  { id: 'flow.measurement', from: 'l2.imu', to: 'l2.ahrs', kind: 'measurement' },
  { id: 'flow.state', from: 'l2.ahrs', to: 'l2.attitude', kind: 'state', feedback: true },
  { id: 'flow.actuation', from: 'l2.rate', to: 'ext.motors', kind: 'actuation' },
] as const

export function fixtureModel(): FlowModelV01 {
  const flows = FLOW_INITS.map((init) =>
    makeFlow({
      id: init.id,
      from: init.from,
      to: init.to,
      kind: init.kind,
      data_contract_id: 'contract' in init ? init.contract : 'data.test',
      ...('feedback' in init ? { feedback: init.feedback } : {}),
      ...('verification' in init ? { verification: init.verification } : {}),
    }),
  )
  return makeModel({
    sources: [makeSource('source.test')],
    contracts: CONTRACTS,
    components: COMPONENTS,
    flows,
    scenarios: [
      makeScenario({
        id: 'scenario.test',
        component_ids: COMPONENTS.map((component) => component.id),
        flow_ids: flows.map((flow) => flow.id),
      }),
    ],
  })
}

export function buildFixtureBundle(): LoadedBundle {
  const bundle = fixtureModel()
  return {
    id: bundle.model.id,
    relativePath: 'fixtures/synthetic.yaml',
    schemaVersion: bundle.schema_version,
    bundle,
    index: buildModelIndex(bundle),
    warnings: [],
  }
}
