import { FLOW_KIND_LABEL } from '@/domain/labels'
import type { Flow, FlowKind, GraphLevel } from '@/domain/model'
import type { ProjectedEdge } from '@/domain/view-model'

import { aggregateVerification } from './verificationRank'

/** One flow whose endpoints have already been projected to the view level. */
export interface ProjectedFlowEndpoints {
  flow: Flow
  /** Projected component id of the source endpoint. */
  sourceId: string
  targetId: string
  /**
   * Original port ids, set only when the endpoint was not folded to a coarser
   * component. Coarser edges use generic handles instead (DESIGN.md 10.5).
   */
  sourceHandle?: string
  targetHandle?: string
}

export function edgeAggregationKey(
  sourceId: string,
  targetId: string,
  kind: FlowKind,
  feedback: boolean,
): string {
  return [sourceId, targetId, kind, feedback === true].join('|')
}

export function projectedEdgeId(
  level: GraphLevel,
  sourceId: string,
  targetId: string,
  kind: FlowKind,
  feedback: boolean,
): string {
  // Derived from the projection identity, never from an array index, so the
  // same input always produces the same id (DESIGN.md 9.6).
  return `edge:L${level}:${sourceId}:${targetId}:${kind}:${feedback ? 'fb' : 'fw'}`
}

/**
 * Groups already-projected flows into aggregated edges.
 *
 * Input order is the configuration order, so `sourceFlowIds` keeps that order
 * and every aggregated edge can be traced back to the raw flows behind it.
 */
export function aggregateEdges(
  level: GraphLevel,
  entries: readonly ProjectedFlowEndpoints[],
): ProjectedEdge[] {
  interface Group {
    sourceId: string
    targetId: string
    kind: FlowKind
    feedback: boolean
    sourceFlowIds: string[]
    verifications: Flow['verification'][]
    sourceHandle?: string
    targetHandle?: string
    firstFlowName: string
  }

  const groups = new Map<string, Group>()

  for (const entry of entries) {
    const feedback = entry.flow.feedback === true
    const key = edgeAggregationKey(entry.sourceId, entry.targetId, entry.flow.kind, feedback)
    const existing = groups.get(key)

    if (existing === undefined) {
      const group: Group = {
        sourceId: entry.sourceId,
        targetId: entry.targetId,
        kind: entry.flow.kind,
        feedback,
        sourceFlowIds: [entry.flow.id],
        verifications: [entry.flow.verification],
        firstFlowName: entry.flow.name,
      }
      if (entry.sourceHandle !== undefined) group.sourceHandle = entry.sourceHandle
      if (entry.targetHandle !== undefined) group.targetHandle = entry.targetHandle
      groups.set(key, group)
      continue
    }

    existing.sourceFlowIds.push(entry.flow.id)
    existing.verifications.push(entry.flow.verification)
    // A group only keeps port handles while it stands for exactly one flow.
    if (existing.sourceFlowIds.length > 1) {
      delete existing.sourceHandle
      delete existing.targetHandle
    }
  }

  const edges: ProjectedEdge[] = []
  for (const group of groups.values()) {
    const count = group.sourceFlowIds.length
    const edge: ProjectedEdge = {
      id: projectedEdgeId(level, group.sourceId, group.targetId, group.kind, group.feedback),
      source: group.sourceId,
      target: group.targetId,
      kind: group.kind,
      // A single underlying flow keeps its own name; an aggregate shows what it
      // is and how many flows it stands for. The names live in the Inspector.
      label: count === 1 ? group.firstFlowName : `${FLOW_KIND_LABEL[group.kind]} × ${count}`,
      feedback: group.feedback,
      verification: aggregateVerification(group.verifications),
      sourceFlowIds: group.sourceFlowIds,
    }
    if (group.sourceHandle !== undefined) edge.sourceHandle = group.sourceHandle
    if (group.targetHandle !== undefined) edge.targetHandle = group.targetHandle
    edges.push(edge)
  }

  return edges
}
