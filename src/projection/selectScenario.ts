import type { ModelIndex } from '@/domain/indexes'
import type { Component, DataContract, Flow, Source } from '@/domain/model'
import type { ScenarioSlice } from '@/domain/view-model'

export interface SelectScenarioOptions {
  scenarioId: string
  index: ModelIndex
}

/**
 * Slices one scenario out of a bundle (DESIGN.md 9.2).
 *
 * Only the components and flows the scenario declares are returned, in the
 * order the configuration lists them. Components belonging to other scenarios
 * are never pulled in implicitly.
 */
export function selectScenario(options: SelectScenarioOptions): ScenarioSlice | null {
  const { scenarioId, index } = options
  const scenario = index.scenariosById.get(scenarioId)
  if (scenario === undefined) return null

  const components: Component[] = []
  for (const componentId of scenario.component_ids) {
    const component = index.componentsById.get(componentId)
    if (component !== undefined) components.push(component)
  }

  const flows: Flow[] = []
  for (const flowId of scenario.flow_ids) {
    const flow = index.flowsById.get(flowId)
    if (flow !== undefined) flows.push(flow)
  }

  // Contracts actually used by the slice, de-duplicated and kept in the
  // configuration order of the bundle.
  const usedContractIds = new Set(flows.map((flow) => flow.data_contract_id))
  const contracts: DataContract[] = []
  for (const contract of index.contractsById.values()) {
    if (usedContractIds.has(contract.id)) contracts.push(contract)
  }

  // Sources referenced by evidence on the scenario itself, its components and
  // its flows.
  const usedSourceIds = new Set<string>()
  const collect = (evidence: readonly { source_id: string }[] | undefined): void => {
    evidence?.forEach((entry) => usedSourceIds.add(entry.source_id))
  }
  collect(scenario.evidence)
  for (const component of components) {
    collect(component.evidence)
    component.implementation?.forEach((binding) => usedSourceIds.add(binding.source_id))
  }
  for (const flow of flows) collect(flow.evidence)

  const sources: Source[] = []
  for (const source of index.sourcesById.values()) {
    if (usedSourceIds.has(source.id)) sources.push(source)
  }

  return { scenario, components, flows, contracts, sources }
}
