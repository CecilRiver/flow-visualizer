import type { ComponentKind, GraphLevel, Verification } from '@/domain/model'
import type { ProjectedNode } from '@/domain/view-model'
import { GROUP_ID_PREFIX } from '@/projection/projectScenario'

/**
 * Node type names and the data contract each custom node renders.
 *
 * The three types are fixed string constants, never values derived from
 * configuration: a config field must not be able to choose which component gets
 * rendered (DESIGN.md 17.2).
 */
export const NODE_TYPE = {
  business: 'business',
  external: 'external',
  group: 'group',
} as const

export type NodeTypeName = (typeof NODE_TYPE)[keyof typeof NODE_TYPE]

/**
 * Picks the fixed node type for a projected node.
 *
 * Group containers are marked by their id prefix, which the projection layer
 * owns, so nothing here has to know how a group was decided.
 */
export function nodeTypeFor(node: ProjectedNode): NodeTypeName {
  if (node.id.startsWith(GROUP_ID_PREFIX)) return NODE_TYPE.group
  if (node.scope === 'external') return NODE_TYPE.external
  return NODE_TYPE.business
}

export interface NodePortHandle {
  id: string
  name: string
  direction: 'input' | 'output'
  /** Vertical position on the node's side, as a percentage from the top. */
  offset: number
}

/** Everything a business-component node renders. No store access from a node. */
export interface BusinessNodeData {
  /** Projected node id, unique inside the current view. */
  id: string
  label: string
  level: GraphLevel
  kind: string
  /** Chinese label for `kind`; the raw enum stays available for copy. */
  kindLabel: string
  /** Raw Schema value, so the renderer can pick a token without re-parsing. */
  verification: Verification
  verificationLabel: string
  verificationShortLabel: string
  verificationGlyph: string
  portCounts: { inputs: number; outputs: number }
  /**
   * Declared ports, each becoming a handle on the node's matching side.
   * `offset` is a percentage down the side, so several ports stay distinct
   * instead of stacking on the centre.
   */
  ports: NodePortHandle[]
  /** Flows folded onto this node because both endpoints projected there. */
  hiddenFlowCount: number
  /** Responsibility text, shown on hover. */
  responsibility: string
  /** Short description excerpt; rendered as text, never as HTML. */
  summary: string
}

export interface ExternalNodeData {
  id: string
  label: string
  kind: string
  kindLabel: string
  verification: Verification
  verificationLabel: string
  verificationShortLabel: string
  verificationGlyph: string
  responsibility: string
}

export interface GroupNodeData {
  id: string
  label: string
  /** Number of visible L2 children inside the container. */
  childCount: number
  /** The real L1 component id this display-only container stands for. */
  domainId: string
}

export interface NodeDataByType {
  [NODE_TYPE.business]: BusinessNodeData
  [NODE_TYPE.external]: ExternalNodeData
  [NODE_TYPE.group]: GroupNodeData
}

/** Re-exported so node renderers do not import domain types individually. */
export type { ComponentKind }
