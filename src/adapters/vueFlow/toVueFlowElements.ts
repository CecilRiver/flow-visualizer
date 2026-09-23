import { MarkerType, type Edge as VueFlowEdge, type Node as VueFlowNode } from '@vue-flow/core'

import {
  COMPONENT_KIND_LABEL,
  VERIFICATION_LABEL,
  VERIFICATION_SHORT_LABEL,
  labelFor,
} from '@/domain/labels'
import type { Component, GraphLevel, Port } from '@/domain/model'
import type { ProjectedGraph, ProjectedNode } from '@/domain/view-model'
import { edgePresentation } from '@/layout/edgePresentation'
import type { LaidOutEdge, LaidOutNode, LayoutResult } from '@/layout/elkLayout'
import type { PlacedLabel } from '@/layout/labelPlacement'
import { sizeForNode } from '@/layout/nodeMetrics'
import { GROUP_ID_PREFIX } from '@/projection/projectScenario'

import { EDGE_TYPE, type SemanticEdgeData } from './edgeTypes'
import {
  NODE_TYPE,
  nodeTypeFor,
  type BusinessNodeData,
  type ExternalNodeData,
  type GroupNodeData,
  type NodePortHandle,
} from './nodeTypes'

/**
 * The one and only framework adaptation (DESIGN.md 10.5).
 *
 * Above this file the graph is plain data; below it, Vue Flow. Nothing here
 * decides what should be visible — the projection already did — it only places
 * nodes, attaches handles and shapes the data each renderer reads.
 */

/** Every node is read-only: the drawing is a report, not an editor. */
const READ_ONLY_NODE_FLAGS = {
  draggable: false,
  connectable: false,
  deletable: false,
  selectable: true,
  focusable: true,
} as const

/**
 * The arrowhead every edge carries at its target end (DESIGN.md 13.4).
 *
 * A feedback edge gets it at the *source* end instead: the flow runs back the
 * way the layout draws it, and an arrowhead at the far end would state the
 * opposite of the configuration. Direction is the one thing about a feedback
 * edge that no amount of colour or dashing can convey.
 */
const ARROW_MARKER = { type: MarkerType.ArrowClosed, width: 14, height: 14 } as const

const VERIFICATION_GLYPH: Record<string, string> = {
  conflict: '!',
  inferred: '?',
  docs_only: 'D',
  code_confirmed: 'C',
  docs_and_code_confirmed: 'DC',
  human_verified: '✓',
}

function verificationParts(verification: string | null): {
  label: string
  shortLabel: string
  glyph: string
} {
  if (verification === null) return { label: '未声明', shortLabel: '未声明', glyph: '·' }
  return {
    label: labelFor(VERIFICATION_LABEL, verification),
    shortLabel: labelFor(VERIFICATION_SHORT_LABEL, verification),
    glyph: VERIFICATION_GLYPH[verification] ?? '·',
  }
}

/** First sentence of the description, for the node's one-line summary. */
function summarize(description: string | undefined): string {
  if (description === undefined) return ''
  const trimmed = description.trim()
  const stop = trimmed.search(/[。;；\n]/)
  return stop === -1 ? trimmed : trimmed.slice(0, stop)
}

/** Spreads a side's ports evenly so several never stack on one spot. */
function placeHandles(ports: readonly Port[]): NodePortHandle[] {
  const counts = {
    input: ports.filter((port) => port.direction === 'input').length,
    output: ports.filter((port) => port.direction === 'output').length,
  }
  const seen = { input: 0, output: 0 }

  return ports.map((port) => {
    seen[port.direction] += 1
    return {
      id: port.id,
      name: port.name,
      direction: port.direction,
      offset: (seen[port.direction] / (counts[port.direction] + 1)) * 100,
    }
  })
}

function businessNodeData(node: ProjectedNode, component: Component | undefined): BusinessNodeData {
  const ports = component?.ports ?? []
  const raw = component?.verification ?? null
  const verification = verificationParts(raw)

  return {
    id: node.id,
    label: node.label,
    level: node.level,
    kind: node.kind,
    kindLabel: labelFor(COMPONENT_KIND_LABEL, node.kind),
    // A component the configuration never gave a verification reads as the
    // weakest state, never as a good one.
    verification: raw ?? 'inferred',
    verificationLabel: verification.label,
    verificationShortLabel: verification.shortLabel,
    verificationGlyph: verification.glyph,
    portCounts: {
      inputs: ports.filter((port) => port.direction === 'input').length,
      outputs: ports.filter((port) => port.direction === 'output').length,
    },
    ports: placeHandles(ports),
    hiddenFlowCount: node.hiddenInternalFlowIds.length,
    responsibility: component?.responsibility ?? '',
    summary: summarize(component?.description),
  }
}

function externalNodeData(node: ProjectedNode, component: Component | undefined): ExternalNodeData {
  const raw = component?.verification ?? null
  const verification = verificationParts(raw)

  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    kindLabel: labelFor(COMPONENT_KIND_LABEL, node.kind),
    verification: raw ?? 'inferred',
    verificationLabel: verification.label,
    verificationShortLabel: verification.shortLabel,
    verificationGlyph: verification.glyph,
    responsibility: component?.responsibility ?? '',
  }
}

function groupNodeData(group: ProjectedNode, childCount: number): GroupNodeData {
  return {
    id: group.id,
    label: group.label,
    childCount,
    // The group stands for exactly one real L1 component; the display prefix is
    // stripped so the Inspector opens the component, not the box.
    domainId: group.id.startsWith(GROUP_ID_PREFIX)
      ? group.id.slice(GROUP_ID_PREFIX.length)
      : group.id,
  }
}

export interface ToVueFlowOptions {
  graph: ProjectedGraph
  layout: LayoutResult
  /**
   * The projection's level, needed to pick the label wording (5.1).
   *
   * `ProjectedGraph` does not carry it — the level is a projection *input*, and
   * adding it to the graph would make two graphs with identical contents
   * distinguishable by a field nothing else reads.
   */
  level: GraphLevel
  componentsById: ReadonlyMap<string, Component>
  /** Projected ids related to the current selection, for highlighting. */
  highlightedNodeIds?: ReadonlySet<string>
  highlightedEdgeIds?: ReadonlySet<string>
  /** True while a selection exists, so unrelated elements can be dimmed. */
  hasSelection?: boolean
}

export interface VueFlowElements {
  nodes: VueFlowNode[]
  edges: VueFlowEdge[]
}

/**
 * Converts one projected and laid-out graph into Vue Flow elements.
 *
 * Positions come from the layout result only. Vue Flow's internal node state is
 * never read back into the domain model (DESIGN.md 7.3).
 */
export function toVueFlowElements(options: ToVueFlowOptions): VueFlowElements {
  const {
    graph,
    layout,
    level,
    componentsById,
    highlightedNodeIds,
    highlightedEdgeIds,
    hasSelection = false,
  } = options

  // Names, for the direction clause of an edge's accessible text. Groups are
  // included because an L2 edge can point at one.
  const nameById = new Map<string, string>(
    [...graph.nodes, ...graph.groups].map((node) => [node.id, node.label]),
  )

  const positionById = new Map<string, LaidOutNode>(layout.nodes.map((node) => [node.id, node]))

  const childrenByGroup = new Map<string, string[]>()
  for (const node of graph.nodes) {
    const groupId = node.parentGroupId
    if (groupId === undefined) continue
    const bucket = childrenByGroup.get(groupId)
    if (bucket === undefined) childrenByGroup.set(groupId, [node.id])
    else bucket.push(node.id)
  }

  const nodes: VueFlowNode[] = []
  const missingPositions: string[] = []

  const buildNode = (
    node: ProjectedNode,
    parentGroupId: string | undefined,
  ): VueFlowNode | null => {
    const placed = positionById.get(node.id)
    // A node the layout never placed is skipped rather than drawn at the
    // origin, where it would look like real business data.
    if (placed === undefined) {
      missingPositions.push(node.id)
      return null
    }

    const type = nodeTypeFor(node)
    const fallbackSize = sizeForNode(node)
    // Containers take the size the layout computed from their children; leaves
    // use the constant footprint they were laid out with.
    const width = placed.width > 0 ? placed.width : fallbackSize.width
    const height = placed.height > 0 ? placed.height : fallbackSize.height

    const component = componentsById.get(node.sourceComponentIds[0] ?? '')
    const highlighted = highlightedNodeIds?.has(node.id) ?? false
    const dimmed = hasSelection && !highlighted

    const data =
      type === NODE_TYPE.group
        ? groupNodeData(node, (childrenByGroup.get(node.id) ?? []).length)
        : type === NODE_TYPE.external
          ? externalNodeData(node, component)
          : businessNodeData(node, component)

    const element: VueFlowNode = {
      id: node.id,
      type,
      position: { x: placed.x, y: placed.y },
      data,
      width,
      height,
      class: [
        'fv-node',
        `fv-node--${type}`,
        highlighted ? 'is-highlighted' : '',
        dimmed ? 'is-dimmed' : '',
      ]
        .filter(Boolean)
        .join(' '),
      // Vue Flow renders both of these onto the node element, which is what the
      // E2E selectors and screen readers key off.
      ariaLabel: `${node.label}（${labelFor(COMPONENT_KIND_LABEL, node.kind)}）`,
      ...READ_ONLY_NODE_FLAGS,
    }

    if (parentGroupId !== undefined) {
      element.parentNode = parentGroupId
      // ELK and the fallback both report absolute coordinates; Vue Flow places
      // a child relative to its container.
      const parentPosition = positionById.get(parentGroupId)
      if (parentPosition !== undefined) {
        element.position = { x: placed.x - parentPosition.x, y: placed.y - parentPosition.y }
      }
    }

    return element
  }

  // Groups come first: Vue Flow needs a parent node to exist before its children.
  for (const group of graph.groups) {
    const element = buildNode(group, undefined)
    if (element !== null) nodes.push(element)
  }
  for (const node of graph.nodes) {
    const element = buildNode(node, node.parentGroupId)
    if (element !== null) nodes.push(element)
  }

  const routeById = new Map<string, LaidOutEdge>(layout.edges.map((edge) => [edge.id, edge]))
  const labelByEdgeId = new Map<string, PlacedLabel>(layout.labels.map((label) => [label.edgeId, label]))
  const nodeById = new Map<string, ProjectedNode>()
  for (const node of graph.nodes) nodeById.set(node.id, node)
  for (const group of graph.groups) nodeById.set(group.id, group)

  /**
   * Picks the handle an edge attaches to (DESIGN.md 10.5).
   *
   * Only an L2 edge standing for a single flow keeps the declared port: at
   * L0/L1 an edge always stands for several flows, and no single port speaks
   * for the aggregate. The fallback also catches a port the component never
   * declared, because an edge with a dangling handle would silently vanish
   * from the drawing rather than show up as a data problem.
   */
  const portHandle = (
    nodeId: string,
    portId: string | undefined,
    fallback: string,
  ): string => {
    if (portId === undefined) return fallback
    const node = nodeById.get(nodeId)
    if (node === undefined || node.level !== 2) return fallback
    const component = componentsById.get(node.sourceComponentIds[0] ?? '')
    const declared = component?.ports?.some((port) => port.id === portId) ?? false
    return declared ? portId : fallback
  }

  const edges: VueFlowEdge[] = graph.edges.map((edge) => {
    const route = routeById.get(edge.id)
    const highlighted = highlightedEdgeIds?.has(edge.id) ?? false

    const presentation = edgePresentation({
      edge,
      level,
      nodeLabel: (id) => nameById.get(id),
    })

    const data: SemanticEdgeData = {
      id: edge.id,
      kind: edge.kind,
      label: edge.label,
      presentation,
      verification: edge.verification,
      feedback: edge.feedback,
      verificationLabel: labelFor(VERIFICATION_LABEL, edge.verification),
      verificationShortLabel: labelFor(VERIFICATION_SHORT_LABEL, edge.verification),
      flowCount: edge.sourceFlowIds.length,
      bendPoints: route === undefined ? [] : [...route.bendPoints],
      startPoint: route?.startPoint ?? null,
      endPoint: route?.endPoint ?? null,
      // A label the layout did not place is `null`, never a zero-sized box at
      // the origin: an origin box would render as a real label in the top-left
      // corner of the drawing, which is exactly the kind of confident wrong
      // answer this whole pass exists to remove.
      labelBox: labelByEdgeId.get(edge.id) ?? null,
      highlighted,
      dimmed: hasSelection && !highlighted,
    }

    return {
      id: edge.id,
      type: EDGE_TYPE.semantic,
      source: edge.source,
      target: edge.target,
      sourceHandle: portHandle(edge.source, edge.sourceHandle, 'out'),
      targetHandle: portHandle(edge.target, edge.targetHandle, 'in'),
      data,
      selectable: true,
      focusable: true,
      /*
       * `focusable` alone does not make the edge reachable by keyboard.
       *
       * Vue Flow's wrapper for an edge is an SVG `<g>`, and SVG attribute names
       * are case-sensitive. The library renders `tabIndex`, the browser looks
       * for `tabindex`, and the element ends up focusable by mouse and by
       * nothing else — so DESIGN.md 16.2's keyboard selection of edges would be
       * met on paper and not in the browser. It works for nodes only because
       * those are HTML `<div>`s, where the attribute name is folded to lower
       * case for it.
       *
       * `domAttributes` is the library's own escape hatch for attributes on
       * that element, and it is spread *after* its own `tabIndex`, so the
       * correctly-cased attribute is present alongside the inert one.
       * `focusable` stays: it is what gives the wrapper `role="group"` and the
       * keyboard description.
       */
      domAttributes: { tabindex: '0' },
      // Read-only like the nodes: Vue Flow's default delete key would otherwise
      // let Backspace drop an edge, leaving the drawing disagreeing with the
      // projection until the next one (DESIGN.md 1, 10.5).
      updatable: false,
      deletable: false,
      // No animation: the graph is static business semantics, and motion would
      // read as live telemetry (DESIGN.md 10.5, 13.4).
      animated: false,
      // Feedback runs the other way, so its arrowhead moves to the far end.
      ...(edge.feedback
        ? { markerStart: ARROW_MARKER }
        : { markerEnd: ARROW_MARKER }),
      class: ['fv-edge', highlighted ? 'is-highlighted' : '', data.dimmed ? 'is-dimmed' : '']
        .filter(Boolean)
        .join(' '),
      /*
       * The full sentence, not the drawn text (5.1).
       *
       * At L0/L1 the canvas shows a two-word kind label, and at low zoom it
       * shows nothing at all. Neither is what a screen reader should hear, so
       * the accessible name is derived from the projection and never shortened.
       */
      ariaLabel: presentation.accessibleText,
    } satisfies VueFlowEdge
  })

  if (missingPositions.length > 0 && import.meta.env.DEV) {
    // Only a layout/adapter mismatch can cause this; it is a bug, not user data.
    console.warn('[flow-visualizer] nodes without layout positions:', missingPositions)
  }

  return { nodes, edges }
}

/** Label for the level switch, reused by the toolbar and the status bar. */
export function levelLabel(level: GraphLevel): string {
  if (level === 0) return 'L0 系统'
  if (level === 1) return 'L1 能力域'
  return 'L2 业务组件'
}
