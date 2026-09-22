import { effectScope, watch, type EffectScope } from 'vue'

import { buildSearch, parseUrlState, replaceUrlState } from '@/app/urlState'
import { useCatalogStore } from '@/stores/catalog'
import { useExplorerStore } from '@/stores/explorer'

/**
 * Keeps the query string and the view state in step (DESIGN.md 8.4).
 *
 * The URL is a convenience, never a capability: it cannot name a folder, grant
 * file access or survive on its own. After a reload the app still starts at
 * `awaiting-folder`, and `bundle`/`scenario` in a link are only honoured if the
 * folder the user then picks actually contains those ids.
 */

const DEFAULT_LEVEL = 2

/** Parameter names reported as unreadable, for a one-off quiet notice. */
let ignoredParams: string[] = []

export function takeIgnoredUrlParams(): string[] {
  const pending = ignoredParams
  ignoredParams = []
  return pending
}

function readInitialState(): void {
  if (typeof window === 'undefined') return

  const { state, ignored } = parseUrlState(window.location.search)
  ignoredParams = ignored

  const explorer = useExplorerStore()

  if (state.level !== undefined) explorer.setLevel(state.level)
  if (state.flowKinds !== undefined) explorer.setFlowKinds(state.flowKinds)
  if (state.verificationStates !== undefined) {
    explorer.setVerificationStates(state.verificationStates)
  }

  // `bundle`/`scenario` stay pending until a catalog exists; applying them now
  // would be overwritten by the first folder load anyway.
  if (state.bundleId !== undefined || state.scenarioId !== undefined) {
    pendingBundleId = state.bundleId ?? null
    pendingScenarioId = state.scenarioId ?? null
  }
}

let pendingBundleId: string | null = null
let pendingScenarioId: string | null = null

/**
 * Applies a requested bundle/scenario once the catalog can honour it.
 *
 * A link naming ids the chosen folder does not contain simply does nothing —
 * silently falling back to the first scenario is better than an error page for
 * a stale bookmark.
 */
function applyPendingSelection(): void {
  if (pendingBundleId === null && pendingScenarioId === null) return

  const catalog = useCatalogStore()
  if (catalog.validBundles.length === 0) return

  const bundleId = pendingBundleId
  const scenarioId = pendingScenarioId
  pendingBundleId = null
  pendingScenarioId = null

  if (bundleId !== null && catalog.validBundles.some((bundle) => bundle.id === bundleId)) {
    catalog.activateBundle(bundleId)
  }
  if (scenarioId !== null) catalog.activateScenario(scenarioId)
}

let urlScope: EffectScope | null = null

/** Called once from the App root, after Pinia is installed. */
export function useUrlState(): void {
  if (urlScope !== null) return

  const explorer = useExplorerStore()
  const catalog = useCatalogStore()

  readInitialState()
  applyPendingSelection()

  urlScope = effectScope(true)
  urlScope.run(() => {
    watch(
      [
        () => catalog.activeBundleId,
        () => catalog.activeScenarioId,
        () => explorer.level,
        () => explorer.enabledFlowKinds,
        () => explorer.enabledVerificationStates,
      ],
      () => {
        applyPendingSelection()
        replaceUrlState(
          buildSearch({
            bundleId: catalog.activeBundleId,
            scenarioId: catalog.activeScenarioId,
            level: explorer.level,
            flowKinds: explorer.enabledFlowKinds,
            verificationStates: explorer.enabledVerificationStates,
            defaultLevel: DEFAULT_LEVEL,
          }),
        )
      },
      { immediate: true, deep: true },
    )
  })
}

/** Test seam: forget everything the URL bootstrap remembered. */
export function resetUrlState(): void {
  ignoredParams = []
  pendingBundleId = null
  pendingScenarioId = null
  urlScope?.stop()
  urlScope = null
}

export { DEFAULT_LEVEL }
