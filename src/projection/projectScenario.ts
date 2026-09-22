import type { ModelIndex } from '@/domain/indexes'
import type { Component, FlowModelV01, GraphLevel } from '@/domain/model'
import { ISSUE_CODES } from '@/domain/validation'
import type {
  FlowFilters,
  GraphDiagnostic,
  ProjectedEdge,
  ProjectedGraph,
  ProjectedNode,
  ScenarioSlice,
} from '@/domain/view-model'

import { aggregateEdges, type ProjectedFlowEndpoints } from './aggregateEdges'

/** Prefix that marks a display-only domain group node (DESIGN.md 9.4). */
export const GROUP_ID_PREFIX = 'ui-group:'

export interface OrderMaps {
  componentOrder: ReadonlyMap<string, number>
  flowOrder: ReadonlyMap<string, number>
}

/** Position of every component and flow in the bundle arrays, for stable sorting. */
export function buildOrderMaps(bundle: FlowModelV01): OrderMaps {
  return {
    componentOrder: new Map(bundle.components.map((component, index) => [component.id, index])),
    flowOrder: new Map(bundle.flows.map((flow, index) => [flow.id, index])),
  }
}

/**
 * Folds a component id onto the node that represents it at `level`
 * (DESIGN.md 9.3).
 *
 * Projection only ever collapses upward: an L1 node is never expanded into
 * undeclared L2 children.
 */
export function projectComponentId(
  componentId: string,
  level: GraphLevel,
  index: ModelIndex,
): string {
  const component = index.componentsById.get(componentId)
  if (component === undefined) return componentId
  // External boundaries keep their own identity at every level.
  if (component.scope === 'external') return componentId
  if (level === 2) return componentId

  if (level === 0) {
    let cursor = component
    // Parent chains are guaranteed acyclic by semantic checks; the step bound
    // is a defensive guard for the pure function.
    for (let steps = 0; steps <= index.componentsById.size; steps += 1) {
      if (cursor.level === 0 || cursor.parent_id === undefined) break
      const parent = index.componentsById.get(cursor.parent_id)
      if (parent === undefined) break
      cursor = parent
    }
    return cursor.id
  }

  // level === 1: an L2 component folds onto its capability domain; L0/L1 stay.
  if (component.level === 2 && component.parent_id !== undefined) {
    const parent = index.componentsById.get(component.parent_id)
    if (parent !== undefined) return parent.id
  }
  return componentId
}

export interface ProjectScenarioOptions {
  slice: ScenarioSlice
  index: ModelIndex
  level: GraphLevel
  filters: FlowFilters
  order: OrderMaps
}

const DEFAULT_ORDER = Number.MAX_SAFE_INTEGER

function orderOf(ids: readonly string[], order: ReadonlyMap<string, number>): number {
  let best = DEFAULT_ORDER
  for (const id of ids) {
    const value = order.get(id)
    if (value !== undefined && value < best) best = value
  }
  return best
}

/** Components and flows first keep configuration order, id breaks ties. */
function compareByOrderThenId(
  a: { order: number; id: string },
  b: { order: number; id: string },
): number {
  if (a.order !== b.order) return a.order - b.order
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Builds the projected graph for one scenario at one level
 * (DESIGN.md 9.1).
 *
 * Filtering happens before projection and aggregation, so an aggregate edge's
 * count, verification and underlying flow list always match what the user can
 * currently see.
 */
export function projectScenario(options: ProjectScenarioOptions): ProjectedGraph {
  const { slice, index, level, filters, order } = options
  const diagnostics: GraphDiagnostic[] = []

  const enabledKinds = new Set<string>(filters.enabledFlowKinds)
  const enabledVerification = new Set<string>(filters.enabledVerificationStates)

  // 1. Filter raw flows first.
  const visibleFlows = slice.flows.filter(
    (flow) => enabledKinds.has(flow.kind) && enabledVerification.has(flow.verification),
  )

  // 2. Collect the node set from every component the scenario declares.
  interface NodeAccumulator {
    sourceComponentIds: string[]
    hiddenInternalFlowIds: string[]
  }
  const accumulators = new Map<string, NodeAccumulator>()
  const ensureNode = (nodeId: string): NodeAccumulator => {
    const existing = accumulators.get(nodeId)
    if (existing !== undefined) return existing
    const created: NodeAccumulator = { sourceComponentIds: [], hiddenInternalFlowIds: [] }
    accumulators.set(nodeId, created)
    return created
  }

  for (const component of slice.components) {
    const projectedId = projectComponentId(component.id, level, index)
    const accumulator = ensureNode(projectedId)
    if (!accumulator.sourceComponentIds.includes(component.id)) {
      accumulator.sourceComponentIds.push(component.id)
    }
  }

  // 3. Project endpoints, folding projected self-loops into their node.
  const aggregatable: ProjectedFlowEndpoints[] = []
  const coarserComponentIds = new Set<string>()

  for (const flow of visibleFlows) {
    const sourceId = projectComponentId(flow.from.component_id, level, index)
    const targetId = projectComponentId(flow.to.component_id, level, index)

    if (level === 2) {
      for (const componentId of [flow.from.component_id, flow.to.component_id]) {
        const component = index.componentsById.get(componentId)
        if (component !== undefined && component.scope === 'internal' && component.level < 2) {
          coarserComponentIds.add(componentId)
        }
      }
    }

    if (sourceId === targetId) {
      // A flow that collapses onto one node is an implementation detail of that
      // node, not an edge in a higher-level view.
      const accumulator = ensureNode(sourceId)
      accumulator.hiddenInternalFlowIds.push(flow.id)
      continue
    }

    const sourceFolded = sourceId !== flow.from.component_id
    const targetFolded = targetId !== flow.to.component_id
    const entry: ProjectedFlowEndpoints = { flow, sourceId, targetId }
    // Port handles only survive while both endpoints keep their identity.
    if (!sourceFolded) entry.sourceHandle = flow.from.port_id
    if (!targetFolded) entry.targetHandle = flow.to.port_id
    aggregatable.push(entry)
  }

  // 4. L2: a capability domain that owns visible L2 children becomes a display
  //    group instead of a plain node. External boundaries never group.
  const groupIdByDomainId = new Map<string, string>()
  if (level === 2) {
    for (const nodeId of accumulators.keys()) {
      const component = index.componentsById.get(nodeId)
      if (component === undefined) continue
      if (component.scope !== 'internal' || component.level !== 1) continue
      const children = index.childrenByParentId.get(nodeId) ?? []
      const hasVisibleChild = children.some((childId) => accumulators.has(childId))
      if (hasVisibleChild) groupIdByDomainId.set(nodeId, `${GROUP_ID_PREFIX}${nodeId}`)
    }
  }

  // 5. Aggregate the surviving edges, retargeting grouped domains onto their
  //    display group so no edge dangles.
  const retargeted = aggregatable.map((entry) => {
    const sourceGroup = groupIdByDomainId.get(entry.sourceId)
    const targetGroup = groupIdByDomainId.get(entry.targetId)
    if (sourceGroup === undefined && targetGroup === undefined) return entry
    const moved: ProjectedFlowEndpoints = {
      flow: entry.flow,
      sourceId: sourceGroup ?? entry.sourceId,
      targetId: targetGroup ?? entry.targetId,
    }
    // Folding onto a container invalidates the original port handles.
    if (sourceGroup === undefined && entry.sourceHandle !== undefined) {
      moved.sourceHandle = entry.sourceHandle
    }
    if (targetGroup === undefined && entry.targetHandle !== undefined) {
      moved.targetHandle = entry.targetHandle
    }
    return moved
  })

  const edges = aggregateEdges(level, retargeted)

  // 6. Split the accumulators into plain nodes and display groups.
  const nodes: Array<ProjectedNode & { order: number }> = []
  const groups: Array<ProjectedNode & { order: number }> = []
  const groupIds = new Set(groupIdByDomainId.values())

  for (const [nodeId, accumulator] of accumulators) {
    if (groupIds.has(`${GROUP_ID_PREFIX}${nodeId}`)) continue
    const component = index.componentsById.get(nodeId)
    const representative = component ?? index.componentsById.get(accumulator.sourceComponentIds[0] ?? '')
    const node: ProjectedNode & { order: number } = {
      id: nodeId,
      level,
      scope: representative?.scope ?? 'internal',
      kind: representative?.kind ?? 'system',
      label: representative?.name ?? nodeId,
      sourceComponentIds: accumulator.sourceComponentIds,
      hiddenInternalFlowIds: accumulator.hiddenInternalFlowIds,
      order: orderOf(accumulator.sourceComponentIds, order.componentOrder),
    }
    nodes.push(node)
  }

  for (const [domainId, groupId] of groupIdByDomainId) {
    const domain = index.componentsById.get(domainId)
    if (domain === undefined) continue
    groups.push({
      id: groupId,
      level: 1,
      scope: 'internal',
      kind: domain.kind,
      label: domain.name,
      // The group points at the real L1 component so its title opens the
      // capability-domain details. The group id is never written back to YAML.
      sourceComponentIds: [domainId],
      hiddenInternalFlowIds: [],
      order: orderOf([domainId], order.componentOrder),
    })
  }

  // L2 children are positioned inside their domain group.
  const childrenByGroup = new Map<string, string[]>()
  for (const [domainId, groupId] of groupIdByDomainId) {
    const children = index.childrenByParentId.get(domainId) ?? []
    const visible = children.filter((childId) => accumulators.has(childId))
    childrenByGroup.set(groupId, visible)
  }
  const groupIdByChildId = new Map<string, string>()
  for (const [groupId, children] of childrenByGroup) {
    for (const childId of children) groupIdByChildId.set(childId, groupId)
  }

  const orderedNodes = nodes
    .map((node) => {
      const groupId = groupIdByChildId.get(node.id)
      return groupId === undefined ? node : { ...node, parentGroupId: groupId }
    })
    .sort(compareByOrderThenId)
    .map(({ order: _order, ...node }) => node)

  const orderedGroups = groups.sort(compareByOrderThenId).map(({ order: _order, ...group }) => group)

  const edgeOrder = new Map(edges.map((edge) => [edge.id, orderOf(edge.sourceFlowIds, order.flowOrder)]))
  const orderedEdges: ProjectedEdge[] = [...edges].sort((a, b) =>
    compareByOrderThenId(
      { order: edgeOrder.get(a.id) ?? DEFAULT_ORDER, id: a.id },
      { order: edgeOrder.get(b.id) ?? DEFAULT_ORDER, id: b.id },
    ),
  )

  // 7. Report endpoints that could not be resolved to L2 business components.
  for (const componentId of coarserComponentIds) {
    const component: Component | undefined = index.componentsById.get(componentId)
    diagnostics.push({
      code: ISSUE_CODES.coarserThanView,
      severity: 'warning',
      message:
        `组件 "${componentId}" 只有 L${component?.level ?? 0} 粒度，在 L2 视图中以较粗节点显示；` +
        '它没有声明可下钻的 L2 子组件。',
      relatedIds: [componentId],
    })
  }

  return {
    nodes: orderedNodes,
    edges: orderedEdges,
    groups: orderedGroups,
    diagnostics,
  }
}
