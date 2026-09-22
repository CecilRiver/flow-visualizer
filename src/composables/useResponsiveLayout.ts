import { onScopeDispose } from 'vue'

import { useExplorerStore } from '@/stores/explorer'

/**
 * The width at which the left panel stops being a column (DESIGN.md 12.2).
 *
 * Below this the canvas needs the whole width, so the sidebar is collapsed on
 * entry to the range and the Inspector becomes an overlay drawer.
 */
export const COMPACT_MAX_WIDTH = 1279

/** Below this both side panels are overlays and the toolbar wraps. */
export const NARROW_MAX_WIDTH = 959

type MediaListener = (matches: boolean) => void

/**
 * Subscribes to a media query and reports both the initial state and every
 * later change. Returns a no-op when the browser has no `matchMedia` — jsdom in
 * tests, and any environment where the query can never be answered — so callers
 * do not each have to guard the API.
 */
export function watchMediaQuery(query: string, listener: MediaListener): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined
  }

  const list = window.matchMedia(query)
  const handler = (event: MediaQueryListEvent): void => {
    listener(event.matches)
  }

  list.addEventListener('change', handler)
  listener(list.matches)

  return () => {
    list.removeEventListener('change', handler)
  }
}

/**
 * Applies the layout defaults each width range asks for.
 *
 * Only the *default* is set here, and only when the range changes: a reader who
 * expands the sidebar on a laptop gets to keep it expanded until the window
 * crosses the boundary again. Forcing the state on every resize tick would
 * fight the reader for control of their own screen.
 */
export function useResponsiveLayout(): void {
  const explorer = useExplorerStore()

  const dispose = watchMediaQuery(`(max-width: ${String(COMPACT_MAX_WIDTH)}px)`, (compact) => {
    explorer.setLeftPanelCollapsed(compact)
  })

  onScopeDispose(dispose)
}
