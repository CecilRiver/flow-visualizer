import type {
  Component,
  DataContract,
  Flow,
  FlowKind,
  GraphLevel,
  Scenario,
  Source,
  Verification,
} from './model'
import type { IssueSeverity } from './validation'

/**
 * Graph view models. These are strictly separate from Schema objects:
 * Vue Flow's node/edge types and coordinates must never leak back into them
 * (DESIGN.md 7.3).
 */
export interface ProjectedNode {
  id: string
  level: GraphLevel
  scope: 'internal' | 'external'
  kind: string
  label: string
  /** Set on L2 children of a domain group node; absent for top-level nodes. */
  parentGroupId?: string
  /** Every underlying component this node stands for, in configuration order. */
  sourceComponentIds: readonly string[]
  /** Flows folded into this node because both endpoints projected onto it. */
  hiddenInternalFlowIds: readonly string[]
}

export interface ProjectedEdge {
  /** Derived from level/source/target/kind/feedback, never from an array index. */
  id: string
  source: string
  target: string
  kind: FlowKind
  label: string
  feedback: boolean
  /** Most conservative verification among the aggregated flows. */
  verification: Verification
  /** Every underlying flow, in configuration order. */
  sourceFlowIds: readonly string[]
  /** Port id on the source component when the edge stands for a single flow. */
  sourceHandle?: string
  targetHandle?: string
}

export interface GraphDiagnostic {
  code: string
  severity: IssueSeverity
  message: string
  relatedIds?: readonly string[]
}

export interface ProjectedGraph {
  nodes: readonly ProjectedNode[]
  edges: readonly ProjectedEdge[]
  groups: readonly ProjectedNode[]
  diagnostics: readonly GraphDiagnostic[]
}

/** Everything one scenario contributes to a view, in configuration order. */
export interface ScenarioSlice {
  scenario: Scenario
  components: readonly Component[]
  flows: readonly Flow[]
  /** Contracts actually used by the slice's flows. */
  contracts: readonly DataContract[]
  /** Sources referenced by evidence on the slice's components, flows or scenario. */
  sources: readonly Source[]
}

export type GraphSelection =
  | { kind: 'node'; projectedId: string; sourceComponentIds: string[] }
  | { kind: 'edge'; projectedId: string; sourceFlowIds: string[] }

/** The filters applied before projection, so counters always match the view. */
export interface FlowFilters {
  enabledFlowKinds: readonly FlowKind[]
  enabledVerificationStates: readonly Verification[]
}

export function createEmptyProjectedGraph(): ProjectedGraph {
  return { nodes: [], edges: [], groups: [], diagnostics: [] }
}
