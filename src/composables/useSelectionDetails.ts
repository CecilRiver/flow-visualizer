import { computed, type ComputedRef } from 'vue'

import type { ModelIndex } from '@/domain/indexes'
import {
  CADENCE_KIND_LABEL,
  COMPONENT_KIND_LABEL,
  EVIDENCE_SUPPORT_LABEL,
  FIELD_TYPE_LABEL,
  FLOW_KIND_LABEL,
  IMPLEMENTATION_ROLE_LABEL,
  REVIEW_STATUS_LABEL,
  SCOPE_LABEL,
  TRANSPORT_LABEL,
  VERIFICATION_LABEL,
  VERIFICATION_SHORT_LABEL,
  labelFor,
} from '@/domain/labels'
import type {
  Component,
  DataContract,
  DataField,
  Evidence,
  Flow,
  ReviewStatus,
  Verification,
} from '@/domain/model'
import { toSourceLink, type SourceLink } from '@/domain/sourceLinks'
import type { GraphSelection, ProjectedEdge, ProjectedNode } from '@/domain/view-model'
import { GROUP_ID_PREFIX } from '@/projection/projectScenario'
import { useCatalogStore } from '@/stores/catalog'

import { useGraphController } from './useGraphController'

/**
 * Resolves the current selection into everything the Inspector shows
 * (DESIGN.md 12.2).
 *
 * It only ever reads: the bundle index for the real configuration objects and
 * the projection for the label the user actually clicked on. Nothing here
 * copies or paraphrases configuration text beyond the enum translations.
 */

export interface EvidenceDetail {
  claim: string
  supportLabel: string
  /** Null when the configuration references a source that is not declared. */
  link: SourceLink | null
  /** The raw id, so a dangling reference is visible rather than hidden. */
  sourceId: string
}

export interface ImplementationDetail {
  roleLabel: string
  notes: string
  link: SourceLink | null
  sourceId: string
}

export interface PortDetail {
  id: string
  name: string
  direction: 'input' | 'output'
  directionLabel: string
  required: boolean
  description: string
  contractId: string
  contractName: string
}

export interface ContractFieldDetail {
  name: string
  typeLabel: string
  description: string
  unit: string
  frame: string
  /** `[0, 1]` style bounds, already formatted; empty when none are declared. */
  rangeText: string
  values: string[]
  nullable: boolean
}

export interface ContractDetail {
  id: string
  name: string
  description: string
  fields: ContractFieldDetail[]
  /** False when the id is referenced but no such contract is declared. */
  resolved: boolean
}

/**
 * A contract together with the flows that carry it.
 *
 * Aggregated edges keep one entry per distinct contract rather than picking a
 * representative: two flows with different contracts are not the same edge, and
 * showing one of them as "the" contract would invent a fact the configuration
 * does not state (DESIGN.md 14.2).
 */
export interface ContractUsage {
  contract: ContractDetail
  flowCount: number
  flowIds: string[]
}

/** `Range` is a union of two shapes, so the bounds are read defensively. */
function rangeText(range: DataField['range']): string {
  if (range === undefined) return ''
  const minimum = range.minimum
  const maximum = range.maximum
  if (minimum === undefined && maximum === undefined) return ''

  const lowInclusive = range.minimum_inclusive ?? true
  const highInclusive = range.maximum_inclusive ?? true

  if (minimum !== undefined && maximum !== undefined) {
    return `${lowInclusive ? '[' : '('}${String(minimum)}, ${String(maximum)}${highInclusive ? ']' : ')'}`
  }
  if (minimum !== undefined) return `${lowInclusive ? '≥' : '>'} ${String(minimum)}`
  return `${highInclusive ? '≤' : '<'} ${String(maximum)}`
}

function contractDetail(contract: DataContract): ContractDetail {
  return {
    id: contract.id,
    name: contract.name,
    description: contract.description,
    fields: contract.fields.map((field) => ({
      name: field.name,
      typeLabel: labelFor(FIELD_TYPE_LABEL, field.type),
      description: field.description,
      unit: field.unit ?? '',
      frame: field.frame ?? '',
      rangeText: rangeText(field.range),
      values: [...(field.values ?? [])],
      nullable: field.nullable ?? false,
    })),
    resolved: true,
  }
}

/** An unresolvable reference is shown as such rather than dropped. */
function unresolvedContract(id: string): ContractDetail {
  return { id, name: id, description: '', fields: [], resolved: false }
}

function contractUsage(
  entries: readonly { contractId: string; flowId: string }[],
  index: ModelIndex,
): ContractUsage[] {
  const byId = new Map<string, ContractUsage>()
  for (const entry of entries) {
    const existing = byId.get(entry.contractId)
    if (existing !== undefined) {
      existing.flowCount += 1
      existing.flowIds.push(entry.flowId)
      continue
    }
    const contract = index.contractsById.get(entry.contractId)
    byId.set(entry.contractId, {
      contract:
        contract === undefined ? unresolvedContract(entry.contractId) : contractDetail(contract),
      flowCount: 1,
      flowIds: [entry.flowId],
    })
  }
  return [...byId.values()]
}

export interface ComponentDetail {
  id: string
  name: string
  kindLabel: string
  scopeLabel: string
  level: number
  /** Raw Schema value, so the badge can pick its token without re-parsing. */
  verification: Verification
  verificationLabel: string
  verificationShortLabel: string
  responsibility: string
  description: string
  conditions: string[]
  tags: string[]
  ports: PortDetail[]
  evidence: EvidenceDetail[]
  implementations: ImplementationDetail[]
  /** Every source this component points at, de-duplicated, in config order. */
  links: SourceLink[]
}

export interface FlowDetail {
  id: string
  name: string
  kindLabel: string
  transportLabel: string
  cadenceLabel: string
  verification: Verification
  verificationLabel: string
  verificationShortLabel: string
  feedback: boolean
  transform: string
  conditions: string[]
  notes: string
  fromLabel: string
  toLabel: string
  fromId: string
  toId: string
  contracts: ContractUsage[]
  contractId: string
  evidence: EvidenceDetail[]
  links: SourceLink[]
}

export interface NodeSelectionDetails {
  kind: 'node'
  projectedId: string
  label: string
  /** True for a display-only L2 container, which has no single component. */
  isGroup: boolean
  components: ComponentDetail[]
  /** Flows the projection folded onto this node because both ends landed here. */
  hiddenFlows: FlowDetail[]
  aggregatedFlowCount: number
  emptyReason: string
}

export interface EdgeSelectionDetails {
  kind: 'edge'
  projectedId: string
  label: string
  kindLabel: string
  /** Most conservative verification of the aggregated flows; null if unknown. */
  verification: Verification | null
  verificationLabel: string
  verificationShortLabel: string
  feedback: boolean
  /** Every raw flow this edge aggregates, in configuration order. */
  flows: FlowDetail[]
  /** One entry per distinct contract; more than one means they disagree. */
  contracts: ContractUsage[]
  /** True when the aggregated flows do not share a single data contract. */
  contractsDiffer: boolean
  aggregatedFlowCount: number
  emptyReason: string
}

export type SelectionDetails = NodeSelectionDetails | EdgeSelectionDetails | null

/** Whether the model as a whole has been reviewed, shown apart from evidence. */
export interface ReviewContext {
  status: ReviewStatus
  label: string
  sourceRevision: string
  generatedOn: string
}

function evidenceDetails(
  evidence: readonly Evidence[] | undefined,
  index: ModelIndex,
): EvidenceDetail[] {
  return (evidence ?? []).map((entry) => {
    const source = index.sourcesById.get(entry.source_id)
    return {
      claim: entry.claim,
      supportLabel: labelFor(EVIDENCE_SUPPORT_LABEL, entry.support),
      link: source === undefined ? null : toSourceLink(source),
      sourceId: entry.source_id,
    }
  })
}

function componentDetail(component: Component, index: ModelIndex): ComponentDetail {
  const links = new Map<string, SourceLink>()
  for (const entry of component.evidence ?? []) {
    const source = index.sourcesById.get(entry.source_id)
    if (source !== undefined) links.set(source.id, toSourceLink(source))
  }
  for (const binding of component.implementation ?? []) {
    const source = index.sourcesById.get(binding.source_id)
    if (source !== undefined) links.set(source.id, toSourceLink(source))
  }

  return {
    id: component.id,
    name: component.name,
    kindLabel: labelFor(COMPONENT_KIND_LABEL, component.kind),
    scopeLabel: labelFor(SCOPE_LABEL, component.scope),
    level: component.level,
    verification: component.verification,
    verificationLabel: labelFor(VERIFICATION_LABEL, component.verification),
    verificationShortLabel: labelFor(VERIFICATION_SHORT_LABEL, component.verification),
    responsibility: component.responsibility,
    description: component.description ?? '',
    conditions: [...(component.conditions ?? [])],
    tags: [...(component.tags ?? [])],
    ports: (component.ports ?? []).map((port) => {
      const contract = index.contractsById.get(port.data_contract_id)
      return {
        id: port.id,
        name: port.name,
        direction: port.direction,
        directionLabel: port.direction === 'input' ? '输入' : '输出',
        required: port.required ?? false,
        description: port.description ?? '',
        contractId: port.data_contract_id,
        contractName: contract?.name ?? port.data_contract_id,
      }
    }),
    evidence: evidenceDetails(component.evidence, index),
    implementations: (component.implementation ?? []).map((binding) => {
      const source = index.sourcesById.get(binding.source_id)
      return {
        roleLabel: labelFor(IMPLEMENTATION_ROLE_LABEL, binding.role),
        notes: binding.notes ?? '',
        link: source === undefined ? null : toSourceLink(source),
        sourceId: binding.source_id,
      }
    }),
    links: [...links.values()],
  }
}

function endpointLabel(
  endpoint: { component_id: string; port_id: string },
  index: ModelIndex,
): string {
  const component = index.componentsById.get(endpoint.component_id)
  const port = component?.ports?.find((entry) => entry.id === endpoint.port_id)
  const componentName = component?.name ?? endpoint.component_id
  const portName = port?.name ?? endpoint.port_id
  return `${componentName}.${portName}`
}

function flowDetail(flow: Flow, index: ModelIndex): FlowDetail {
  const links = new Map<string, SourceLink>()
  for (const entry of flow.evidence) {
    const source = index.sourcesById.get(entry.source_id)
    if (source !== undefined) links.set(source.id, toSourceLink(source))
  }

  const cadence = flow.cadence
  const rate = cadence.rate_hz === undefined ? '' : ` · ${String(cadence.rate_hz)} Hz`

  return {
    id: flow.id,
    name: flow.name,
    kindLabel: labelFor(FLOW_KIND_LABEL, flow.kind),
    transportLabel: labelFor(TRANSPORT_LABEL, flow.transport),
    cadenceLabel: `${labelFor(CADENCE_KIND_LABEL, cadence.kind)}${rate}`,
    verification: flow.verification,
    verificationLabel: labelFor(VERIFICATION_LABEL, flow.verification),
    verificationShortLabel: labelFor(VERIFICATION_SHORT_LABEL, flow.verification),
    feedback: flow.feedback ?? false,
    transform: flow.transform,
    conditions: [...(flow.conditions ?? [])],
    notes: flow.notes ?? '',
    fromLabel: endpointLabel(flow.from, index),
    toLabel: endpointLabel(flow.to, index),
    fromId: flow.from.component_id,
    toId: flow.to.component_id,
    contracts: contractUsage(
      [{ contractId: flow.data_contract_id, flowId: flow.id }],
      index,
    ),
    contractId: flow.data_contract_id,
    evidence: evidenceDetails(flow.evidence, index),
    links: [...links.values()],
  }
}

function resolveNode(
  selection: Extract<GraphSelection, { kind: 'node' }>,
  index: ModelIndex,
  node: ProjectedNode | undefined,
): NodeSelectionDetails {
  const components: ComponentDetail[] = []
  for (const componentId of selection.sourceComponentIds) {
    const component = index.componentsById.get(componentId)
    if (component !== undefined) components.push(componentDetail(component, index))
  }

  const hiddenFlows: FlowDetail[] = []
  for (const flowId of node?.hiddenInternalFlowIds ?? []) {
    const flow = index.flowsById.get(flowId)
    if (flow !== undefined) hiddenFlows.push(flowDetail(flow, index))
  }

  return {
    kind: 'node',
    projectedId: selection.projectedId,
    label: node?.label ?? selection.projectedId,
    isGroup: node?.id.startsWith(GROUP_ID_PREFIX) ?? false,
    components,
    hiddenFlows,
    aggregatedFlowCount: components.length,
    emptyReason:
      components.length === 0
        ? '当前层级下该节点没有对应的组件（可能是仅用于展示的分组容器）。'
        : '',
  }
}

function resolveEdge(
  selection: Extract<GraphSelection, { kind: 'edge' }>,
  index: ModelIndex,
  edge: ProjectedEdge | undefined,
): EdgeSelectionDetails {
  const flows: FlowDetail[] = []
  for (const flowId of selection.sourceFlowIds) {
    const flow = index.flowsById.get(flowId)
    if (flow !== undefined) flows.push(flowDetail(flow, index))
  }

  const contracts = contractUsage(
    selection.sourceFlowIds
      .map((flowId) => ({ contractId: index.flowsById.get(flowId)?.data_contract_id ?? '', flowId }))
      .filter((entry) => entry.contractId !== ''),
    index,
  )

  // The verification of an aggregate is the most conservative of its flows, and
  // that decision belongs to the projection. Reading it off `flows[0]` here
  // would quietly promote a mixed edge to whatever the first flow claims.
  const verification = edge?.verification

  return {
    kind: 'edge',
    projectedId: selection.projectedId,
    label: edge?.label ?? selection.projectedId,
    kindLabel: labelFor(FLOW_KIND_LABEL, edge?.kind ?? 'command'),
    verification: verification ?? null,
    verificationLabel: verification === undefined ? '' : labelFor(VERIFICATION_LABEL, verification),
    verificationShortLabel:
      verification === undefined ? '' : labelFor(VERIFICATION_SHORT_LABEL, verification),
    feedback: edge?.feedback ?? flows[0]?.feedback ?? false,
    flows,
    contracts,
    contractsDiffer: contracts.length > 1,
    aggregatedFlowCount: flows.length,
    emptyReason: flows.length === 0 ? '该边聚合的流程无法在当前模型中解析。' : '',
  }
}

export interface SelectionDetailsResult {
  details: ComputedRef<SelectionDetails>
  review: ComputedRef<ReviewContext | null>
  /** True while at least one component or flow sits behind the selection. */
  hasResolvedSources: ComputedRef<boolean>
}

export function useSelectionDetails(): SelectionDetailsResult {
  const controller = useGraphController()
  const catalog = useCatalogStore()

  const review = computed<ReviewContext | null>(() => {
    const bundle = catalog.activeBundle
    if (bundle === null) return null
    return {
      status: bundle.bundle.model.review_status,
      label: labelFor(REVIEW_STATUS_LABEL, bundle.bundle.model.review_status),
      sourceRevision: bundle.bundle.model.source_revision,
      generatedOn: bundle.bundle.model.generated_on,
    }
  })

  const details = computed<SelectionDetails>(() => {
    const selection = controller.selection.value
    if (selection === null) return null

    const index = catalog.activeBundle?.index
    if (index === undefined) return null

    const graph = controller.graph.value

    if (selection.kind === 'node') {
      const node =
        graph.groups.find((entry) => entry.id === selection.projectedId) ??
        graph.nodes.find((entry) => entry.id === selection.projectedId)
      return resolveNode(selection, index, node)
    }

    return resolveEdge(
      selection,
      index,
      graph.edges.find((entry) => entry.id === selection.projectedId),
    )
  })

  const hasResolvedSources = computed(() => {
    const current = details.value
    if (current === null) return false
    return current.kind === 'node'
      ? current.components.length > 0
      : current.flows.length > 0
  })

  return { details, review, hasResolvedSources }
}
