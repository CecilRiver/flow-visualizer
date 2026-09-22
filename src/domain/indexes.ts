import type { Component, DataContract, Flow, FlowModelV01, Scenario, Source } from './model'
import type { ValidationIssue } from './validation'

/**
 * Read-only lookup tables for one validated bundle, so that clicking a node
 * never rescans an array (DESIGN.md 7.2).
 *
 * Building the index never rewrites business ids, verification states or
 * evidence.
 */
export interface ModelIndex {
  componentsById: ReadonlyMap<string, Component>
  flowsById: ReadonlyMap<string, Flow>
  contractsById: ReadonlyMap<string, DataContract>
  sourcesById: ReadonlyMap<string, Source>
  scenariosById: ReadonlyMap<string, Scenario>
  childrenByParentId: ReadonlyMap<string, readonly string[]>
}

export interface LoadedBundle {
  /** Stable identity of the bundle within the catalog: its `model.id`. */
  id: string
  /** Path relative to the selected folder, using `/` separators. */
  relativePath: string
  schemaVersion: string
  /** Plain immutable copy; never a reactive proxy. */
  bundle: Readonly<FlowModelV01>
  index: ModelIndex
  /** Non-fatal findings produced while loading this bundle. */
  warnings: readonly ValidationIssue[]
}

/** A candidate file that could not become a `LoadedBundle`. */
export interface InvalidBundleSummary {
  /** `model.id` when it could be read, otherwise the relative path. */
  id: string
  relativePath: string
  modelTitle: string | null
  issues: readonly ValidationIssue[]
}

export function buildModelIndex(bundle: FlowModelV01): ModelIndex {
  const componentsById = new Map<string, Component>()
  const childrenByParentId = new Map<string, string[]>()

  for (const component of bundle.components) {
    componentsById.set(component.id, component)
    const parentId = component.parent_id
    if (parentId !== undefined) {
      const siblings = childrenByParentId.get(parentId)
      if (siblings === undefined) {
        childrenByParentId.set(parentId, [component.id])
      } else {
        siblings.push(component.id)
      }
    }
  }

  return {
    componentsById,
    flowsById: new Map(bundle.flows.map((flow) => [flow.id, flow])),
    contractsById: new Map(bundle.data_contracts.map((contract) => [contract.id, contract])),
    sourcesById: new Map(bundle.sources.map((source) => [source.id, source])),
    scenariosById: new Map(bundle.scenarios.map((scenario) => [scenario.id, scenario])),
    childrenByParentId,
  }
}
