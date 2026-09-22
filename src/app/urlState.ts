import { GRAPH_LEVELS, asGraphLevel, type FlowKind, type GraphLevel, type Verification } from '@/domain/model'

/**
 * URL synchronisation without a router (DESIGN.md 8.4).
 *
 * The URL carries view configuration only. It never carries a folder name, an
 * absolute path, a directory handle or any file content, and it cannot grant
 * file access: after a reload the app still starts at `awaiting-folder`, and
 * the link is only honoured once the user has picked a folder themselves.
 */

export const FLOW_KIND_VALUES: readonly FlowKind[] = [
  'command',
  'measurement',
  'state',
  'event',
  'control',
  'actuation',
  'feedback',
]

export const VERIFICATION_VALUES: readonly Verification[] = [
  'conflict',
  'inferred',
  'docs_only',
  'code_confirmed',
  'docs_and_code_confirmed',
  'human_verified',
]

/**
 * The subset of view state mirrored into the query string.
 *
 * `bundleId`/`scenarioId` allow an explicit `null` (the parameter was present
 * and empty, meaning "no preference"); `level` does not, because an absent
 * level and a cleared one are the same thing.
 */
export interface UrlViewState {
  bundleId: string | null
  scenarioId: string | null
  level: GraphLevel
  flowKinds: FlowKind[]
  verificationStates: Verification[]
}

export interface ParsedUrlState {
  state: Partial<UrlViewState>
  /** Parameter names that were present but not understood, for a quiet notice. */
  ignored: string[]
}

function parseList<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  parameter: string,
  ignored: string[],
): T[] | undefined {
  if (raw === null) return undefined
  const permit = new Set<string>(allowed)
  const values: T[] = []
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    if (!permit.has(trimmed)) {
      // Unknown values are dropped rather than failing the boot.
      ignored.push(`${parameter}=${trimmed}`)
      continue
    }
    if (!values.includes(trimmed as T)) values.push(trimmed as T)
  }

  /*
   * An empty value is how a cleared selection is written (`?flow=`), and it is
   * honoured as "nothing selected". A parameter that carries text but not one
   * value this build knows is a different thing: it is a link written against
   * a vocabulary we no longer have, and applying it as an empty selection would
   * hide every flow while the notice claims the parameter was ignored.
   * Falling back to the defaults is the only reading that neither hides data
   * nor contradicts the notice (DESIGN.md 8.4, 15.1).
   */
  if (values.length === 0 && raw.trim() !== '') return undefined

  return values
}

/**
 * Reads the view state out of a query string.
 *
 * Anything unrecognised is ignored and reported, never thrown: a stale
 * bookmark must still open the viewer.
 */
export function parseUrlState(search: string): ParsedUrlState {
  const ignored: string[] = []
  const params = new URLSearchParams(search)
  const state: Partial<UrlViewState> = {}

  const bundle = params.get('bundle')
  if (bundle !== null) state.bundleId = bundle === '' ? null : bundle

  const scenario = params.get('scenario')
  if (scenario !== null) state.scenarioId = scenario === '' ? null : scenario

  const rawLevel = params.get('level')
  // `?level=` parses as `Number('') === 0`, which would silently boot at L0.
  // An absent level and a cleared one mean the same thing, so the empty value
  // is treated as absent rather than as a request for the coarse view.
  if (rawLevel !== null && rawLevel.trim() !== '') {
    const level = asGraphLevel(Number(rawLevel))
    if (level === null || !GRAPH_LEVELS.includes(level)) ignored.push(`level=${rawLevel}`)
    else state.level = level
  }

  const flowKinds = parseList(params.get('flow'), FLOW_KIND_VALUES, 'flow', ignored)
  if (flowKinds !== undefined) state.flowKinds = flowKinds

  const verificationStates = parseList(
    params.get('verification'),
    VERIFICATION_VALUES,
    'verification',
    ignored,
  )
  if (verificationStates !== undefined) state.verificationStates = verificationStates

  return { state, ignored }
}

/**
 * Serialises the view state back into a query string.
 *
 * Defaults are omitted so a freshly loaded folder produces a clean URL.
 */
export function buildSearch(state: {
  bundleId: string | null
  scenarioId: string | null
  level: GraphLevel
  flowKinds: readonly FlowKind[]
  verificationStates: readonly Verification[]
  defaultLevel: GraphLevel
}): string {
  const params = new URLSearchParams()

  if (state.bundleId !== null && state.bundleId !== '') params.set('bundle', state.bundleId)
  if (state.scenarioId !== null && state.scenarioId !== '') {
    params.set('scenario', state.scenarioId)
  }
  if (state.level !== state.defaultLevel) params.set('level', String(state.level))

  if (state.flowKinds.length !== FLOW_KIND_VALUES.length) {
    params.set('flow', state.flowKinds.join(','))
  }
  if (state.verificationStates.length !== VERIFICATION_VALUES.length) {
    params.set('verification', state.verificationStates.join(','))
  }

  const query = params.toString()
  return query === '' ? '' : `?${query}`
}

/**
 * Rewrites the current URL in place.
 *
 * `replaceState` is deliberate: adjusting a filter should not stack browser
 * history entries that the back button then walks one at a time.
 */
export function replaceUrlState(search: string): void {
  if (typeof window === 'undefined') return
  const { pathname, hash } = window.location
  window.history.replaceState(null, '', `${pathname}${search}${hash}`)
}
