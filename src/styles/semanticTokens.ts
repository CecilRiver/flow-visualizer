import { FLOW_KIND_LABEL, VERIFICATION_LABEL, VERIFICATION_SHORT_LABEL } from '@/domain/labels'
import type { FlowKind, Verification } from '@/domain/model'

/**
 * The single source of truth for semantic colour (DESIGN.md 15.2, 16.1).
 *
 * The legend, the node renderers, the edges and the minimap all read these
 * values, either directly or through the CSS custom properties installed by
 * `installSemanticTokens()`. Keeping the table here — rather than in
 * `tokens.css` and again in a component — is what stops the legend from
 * drifting away from what the canvas actually draws.
 *
 * Every family also carries a non-colour cue (glyph, dash pattern, line width,
 * label) so a status is never communicated by colour alone (DESIGN.md 16.2).
 */

export interface SemanticToken {
  /** CSS custom property name, e.g. `--status-conflict`. */
  name: string
  value: string
}

/**
 * The one place the `--` prefix is decided.
 *
 * The maps above name their variables the way a stylesheet does, with the
 * prefix included, because that is what a component has to write to read them
 * back. Everything that turns one of those names into either a declaration or a
 * `var()` reference goes through here, so the name that is installed and the
 * name that is read can never end up one prefix apart.
 */
function customPropertyName(name: string): string {
  return name.startsWith('--') ? name : `--${name}`
}

const VERIFICATION_TOKENS: Record<Verification, { color: string; surface: string }> = {
  conflict: { color: '#b42318', surface: '#fef3f2' },
  inferred: { color: '#667085', surface: '#f2f4f7' },
  docs_only: { color: '#b54708', surface: '#fffaeb' },
  code_confirmed: { color: '#026aa2', surface: '#f0f9ff' },
  docs_and_code_confirmed: { color: '#3538cd', surface: '#eef2ff' },
  human_verified: { color: '#027a48', surface: '#ecfdf3' },
}

const VERIFICATION_VAR: Record<Verification, string> = {
  conflict: '--status-conflict',
  inferred: '--status-inferred',
  docs_only: '--status-docs',
  code_confirmed: '--status-code',
  docs_and_code_confirmed: '--status-docs-code',
  human_verified: '--status-human',
}

const FLOW_KIND_TOKENS: Record<FlowKind, { color: string }> = {
  command: { color: '#1d4ed8' },
  measurement: { color: '#0e7490' },
  state: { color: '#7c3aed' },
  event: { color: '#b45309' },
  control: { color: '#1e3a8a' },
  actuation: { color: '#c2410c' },
  feedback: { color: '#7c3aed' },
}

const FLOW_KIND_VAR: Record<FlowKind, string> = {
  command: '--flow-command',
  measurement: '--flow-measurement',
  state: '--flow-state',
  event: '--flow-event',
  control: '--flow-control',
  actuation: '--flow-actuation',
  feedback: '--flow-feedback',
}

const SCOPE_VARS = {
  internalAccent: '--node-internal-accent',
  internalSurface: '--node-internal-surface',
  externalAccent: '--node-external-accent',
  externalSurface: '--node-external-surface',
  groupSurface: '--node-group-surface',
  groupBorder: '--node-group-border',
} as const

const SCOPE_TOKENS = {
  internalAccent: '#2563eb',
  internalSurface: '#ffffff',
  externalAccent: '#0f766e',
  externalSurface: '#f2fbfa',
  groupSurface: '#f7f9fc',
  groupBorder: '#cdd8e6',
} as const

/** Every custom property this module owns, ready to install on `:root`. */
export function semanticTokenEntries(): SemanticToken[] {
  const entries: SemanticToken[] = []

  for (const verification of Object.keys(VERIFICATION_TOKENS) as Verification[]) {
    const tone = VERIFICATION_TOKENS[verification]
    entries.push({ name: VERIFICATION_VAR[verification], value: tone.color })
    // The surface variant shares the base name with a `-bg` suffix.
    entries.push({ name: `${VERIFICATION_VAR[verification]}-bg`, value: tone.surface })
  }

  for (const kind of Object.keys(FLOW_KIND_TOKENS) as FlowKind[]) {
    entries.push({ name: FLOW_KIND_VAR[kind], value: FLOW_KIND_TOKENS[kind].color })
  }

  for (const key of Object.keys(SCOPE_TOKENS) as Array<keyof typeof SCOPE_TOKENS>) {
    entries.push({ name: SCOPE_VARS[key], value: SCOPE_TOKENS[key] })
  }

  return entries
}

/**
 * Installs the custom properties on the document root.
 *
 * Called once during bootstrap; components then reference `var(--flow-command)`
 * like any other token instead of hard-coding a hex value.
 */
export function installSemanticTokens(target?: HTMLElement): void {
  const element = target ?? (typeof document === 'undefined' ? undefined : document.documentElement)
  if (element === undefined) return
  for (const token of semanticTokenEntries()) {
    element.style.setProperty(customPropertyName(token.name), token.value)
  }
}

/**
 * `var(--flow-command)` — for CSS-in-JS style bindings.
 *
 * Accepts the name with or without the prefix, so a caller can pass either the
 * entries from `semanticTokenEntries()` or a literal from `tokens.css`.
 */
export function cssVar(name: string): string {
  return `var(${customPropertyName(name)})`
}

export function verificationColor(verification: Verification): string {
  return cssVar(VERIFICATION_VAR[verification])
}

/**
 * The raw custom-property name, without the `var()` wrapper.
 *
 * Node renderers need it to build `--node-accent` inside a scoped style
 * binding, which is where a component may not hard-code a hex value
 * (DESIGN.md 16.1).
 */
export function verificationTokenName(verification: Verification): string {
  return VERIFICATION_VAR[verification]
}

/**
 * The non-colour cue for a verification state.
 *
 * Exposed so a badge in the Inspector repeats exactly what the legend and the
 * node glyphs show, instead of inventing a second set of symbols.
 */
export function verificationGlyph(verification: Verification): string {
  return VERIFICATION_GLYPH[verification]
}

/**
 * Same, for a value that arrived as a plain string — the minimap reads it out
 * of node data. An unrecognised value falls back to `inferred`, the weakest
 * state, so an unknown string can never be painted as verified.
 */
export function verificationTokenNameOf(value: string): string {
  return (VERIFICATION_VAR as Record<string, string>)[value] ?? VERIFICATION_VAR.inferred
}

export function flowKindColor(kind: FlowKind): string {
  return cssVar(FLOW_KIND_VAR[kind])
}

// ---------------------------------------------------------------------------
// Legend descriptors
// ---------------------------------------------------------------------------

/**
 * How each verification state is drawn. `glyph` is the non-colour cue that
 * repeats the meaning for anyone who cannot separate the hues.
 */
export interface VerificationLegendEntry {
  verification: Verification
  label: string
  shortLabel: string
  color: string
  surface: string
  glyph: string
  /** Wording used in the legend's accessibility description. */
  description: string
}

const VERIFICATION_GLYPH: Record<Verification, string> = {
  conflict: '!',
  inferred: '?',
  docs_only: 'D',
  code_confirmed: 'C',
  docs_and_code_confirmed: 'DC',
  human_verified: '✓',
}

const VERIFICATION_DESCRIPTION: Record<Verification, string> = {
  conflict: '证据之间存在矛盾，需要人工判定',
  inferred: '由上下文推断，缺少直接证据',
  docs_only: '只有文档证据，尚未与代码核对',
  code_confirmed: '已在源码中确认',
  docs_and_code_confirmed: '文档与源码均已确认',
  human_verified: '已由人工评审确认',
}

export function verificationLegend(): VerificationLegendEntry[] {
  return (Object.keys(VERIFICATION_TOKENS) as Verification[]).map((verification) => ({
    verification,
    label: VERIFICATION_LABEL[verification],
    shortLabel: VERIFICATION_SHORT_LABEL[verification],
    color: cssVar(VERIFICATION_VAR[verification]),
    surface: cssVar(`${VERIFICATION_VAR[verification]}-bg`),
    glyph: VERIFICATION_GLYPH[verification],
    description: VERIFICATION_DESCRIPTION[verification],
  }))
}

export interface FlowKindLegendEntry {
  kind: FlowKind
  label: string
  color: string
  /** SVG dash array; empty string means a solid line. */
  dashArray: string
  strokeWidth: number
  description: string
}

const FLOW_KIND_STROKE: Record<FlowKind, { dashArray: string; strokeWidth: number }> = {
  command: { dashArray: '', strokeWidth: 2 },
  measurement: { dashArray: '', strokeWidth: 1.25 },
  state: { dashArray: '', strokeWidth: 1.25 },
  event: { dashArray: '2 4', strokeWidth: 2 },
  control: { dashArray: '', strokeWidth: 2.5 },
  actuation: { dashArray: '', strokeWidth: 3.5 },
  feedback: { dashArray: '6 4', strokeWidth: 2 },
}

export function flowKindLegend(): FlowKindLegendEntry[] {
  return (Object.keys(FLOW_KIND_TOKENS) as FlowKind[]).map((kind) => ({
    kind,
    label: FLOW_KIND_LABEL[kind],
    color: cssVar(FLOW_KIND_VAR[kind]),
    dashArray: FLOW_KIND_STROKE[kind].dashArray,
    strokeWidth: FLOW_KIND_STROKE[kind].strokeWidth,
    // The feedback kind used to carry a `reversed` flag for the arrowhead, drawn
    // at the source end. The arrow points at `to` on every edge now
    // (GRAPH_READABILITY_DESIGN.md 9.2), so there is nothing left for a reader
    // to be warned about: what marks feedback is the dashed line and the wording.
    description:
      kind === 'feedback'
        ? '反馈：影响上游的数据回流，走下方通道并画成虚线'
        : `${FLOW_KIND_LABEL[kind]}数据流`,
  }))
}

/** Stroke style for one edge, honouring the `feedback: true` override. */
export function edgeStroke(kind: FlowKind, feedback: boolean): { color: string; dashArray: string; strokeWidth: number } {
  const stroke = FLOW_KIND_STROKE[kind]
  if (feedback) {
    // `feedback: true` on any kind renders as a feedback edge (DESIGN.md 13.4).
    return { color: cssVar(FLOW_KIND_VAR.feedback), ...FLOW_KIND_STROKE.feedback }
  }
  return { color: cssVar(FLOW_KIND_VAR[kind]), ...stroke }
}

export interface ScopeLegendEntry {
  scope: 'internal' | 'external'
  label: string
  color: string
  surface: string
  description: string
}

export function scopeLegend(): ScopeLegendEntry[] {
  return [
    {
      scope: 'internal',
      label: '内部业务组件',
      color: cssVar(SCOPE_VARS.internalAccent),
      surface: cssVar(SCOPE_VARS.internalSurface),
      description: 'ArduCopter 内部的业务组件与能力域',
    },
    {
      scope: 'external',
      label: '外部边界',
      color: cssVar(SCOPE_VARS.externalAccent),
      surface: cssVar(SCOPE_VARS.externalSurface),
      description: '系统之外的参与者与物理设备',
    },
  ]
}

export const NODE_SURFACE = {
  groupSurface: cssVar(SCOPE_VARS.groupSurface),
  groupBorder: cssVar(SCOPE_VARS.groupBorder),
} as const
