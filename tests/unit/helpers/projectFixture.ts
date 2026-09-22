import { buildModelIndex } from '@/domain/indexes'
import type { FlowKind, GraphLevel, Verification } from '@/domain/model'
import type { FlowFilters, ProjectedGraph } from '@/domain/view-model'
import { buildOrderMaps, projectScenario } from '@/projection/projectScenario'
import { selectScenario } from '@/projection/selectScenario'

import {
  type FlowInit,
  makeComponent,
  makeFlow,
  makeModel,
  makeScenario,
  makeSource,
  withPorts,
} from '../../fixtures/buildModel'

/**
 * The canonical synthetic model used by projection and layout tests: one L0
 * system, two external boundaries, two capability domains with two L2
 * components each.
 *
 * Kept here rather than in the fixture module so the component graph used by
 * every test stays visible in one place.
 */
export function fixtureComponents() {
  return [
    makeComponent({ id: 'system.ac', level: 0, kind: 'system', scope: 'internal' }),
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
    makeComponent({ id: 'l2.attitude', level: 2, kind: 'controller', parent_id: 'domain.control' }),
    makeComponent({ id: 'l2.rate', level: 2, kind: 'controller', parent_id: 'domain.control' }),
    makeComponent({ id: 'l2.ahrs', level: 2, kind: 'estimator', parent_id: 'domain.estimate' }),
    makeComponent({ id: 'l2.imu', level: 2, kind: 'estimator', parent_id: 'domain.estimate' }),
  ].map((component) => withPorts(component, ['data.test']))
}

export interface ProjectFixtureOptions {
  level: GraphLevel
  flows: readonly FlowInit[]
  filters?: FlowFilters
  /** Component ids to leave out of the scenario declaration. */
  omit?: readonly string[]
}

export function projectFixture(options: ProjectFixtureOptions): ProjectedGraph {
  const allComponents = fixtureComponents()
  const components = allComponents.filter(
    (component) => !(options.omit ?? []).includes(component.id),
  )
  const flows = options.flows.map((flow) => makeFlow(flow))

  const scenario = makeScenario({
    id: 'scenario.test',
    component_ids: components.map((component) => component.id),
    flow_ids: flows.map((flow) => flow.id),
  })

  const model = makeModel({
    components,
    flows,
    scenarios: [scenario],
    sources: [makeSource('source.test')],
  })
  const index = buildModelIndex(model)
  const slice = selectScenario({ scenarioId: 'scenario.test', index })
  if (slice === null) throw new Error('fixture scenario missing')

  return projectScenario({
    slice,
    index,
    level: options.level,
    filters:
      options.filters ??
      ({
        enabledFlowKinds: ALL_FLOW_KINDS,
        enabledVerificationStates: ALL_VERIFICATIONS,
      } satisfies FlowFilters),
    order: buildOrderMaps(model),
  })
}

export const ALL_FLOW_KINDS: readonly FlowKind[] = [
  'command',
  'measurement',
  'state',
  'event',
  'control',
  'actuation',
  'feedback',
]

export const ALL_VERIFICATIONS: readonly Verification[] = [
  'conflict',
  'inferred',
  'docs_only',
  'code_confirmed',
  'docs_and_code_confirmed',
  'human_verified',
]
