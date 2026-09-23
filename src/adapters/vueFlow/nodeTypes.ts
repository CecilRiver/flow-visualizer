import type { ComponentKind, GraphLevel, Verification } from '@/domain/model'
import type { ProjectedNode } from '@/domain/view-model'
import type { PortEnd, PortSide } from '@/layout/layoutPorts'
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

/**
 * One handle a node renders, positioned by the layout (7.3).
 *
 * Replaces a node-local percentage derived from the declared port list. That
 * percentage was a third port geometry, unrelated to the one ELK routed with,
 * so the line and the handle it was attached to only ever nearly agreed — and
 * a node whose declared ports had no edge got a handle nothing could reach.
 */
export interface NodePortHandle {
  /** The render port id, which is also what the edge references (7.3 rule 3). */
  id: string
  /**
   * Which end of its edge this is, and so whether Vue Flow treats the handle as
   * a source or a target.
   */
  end: PortEnd
  side: PortSide
  /** Position inside the node's own box, in pixels. */
  x: number
  y: number
  /**
   * The Schema port the edge named, when it named one (7.3 rule 4).
   *
   * Absent for an aggregated edge, which has no single port to point at.
   */
  semanticPortId?: string
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
   * The layout's render ports for this node, one per attached edge (7.3).
   *
   * Not the declared ports: `portCounts` above is what the configuration
   * declares, and this is what the drawing attaches. A declared port with no
   * edge on it gets no handle, because a handle is only ever a place a route
   * ends and a dot for a port nothing reaches claims otherwise.
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
  /**
   * Render ports, exactly as on a business node.
   *
   * A boundary had none of its own before: it hardcoded a pair of generic
   * handles while the adapter handed its edges whichever handle ids the
   * component declared — ids that existed on no element. Vue Flow answers a
   * handle it cannot find by silently falling back to the node's centre, so the
   * edges stayed on screen and were quietly attached to the wrong place.
   */
  ports: NodePortHandle[]
}

export interface GroupNodeData {
  id: string
  label: string
  /** Number of visible L2 children inside the container. */
  childCount: number
  /** Render ports for the edges retargeted onto the container (7.3). */
  ports: NodePortHandle[]
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
