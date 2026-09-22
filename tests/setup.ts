/**
 * Browser APIs jsdom does not implement, needed by any component that mounts.
 *
 * These are no-ops on purpose. The suites assert on what the components render
 * and on the stores they write to; none of them depend on a real layout pass, so
 * a polyfill that reports "nothing happened" is more honest than one that
 * pretends to measure pixels jsdom cannot compute.
 */

/** Vue Flow tracks the pane size through a `ResizeObserver`. */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Element Plus reads `prefers-reduced-motion` when it animates. */
function noopMediaQueryList(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }
}

if (!('ResizeObserver' in globalThis)) {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: NoopResizeObserver,
    writable: true,
  })
}

if (!('matchMedia' in globalThis)) {
  Object.defineProperty(globalThis, 'matchMedia', {
    value: noopMediaQueryList,
    writable: true,
  })
}

// jsdom reports 1024x768 for every element; a scrollable panel needs a
// non-zero length to compute anything at all.
if (!('scrollTo' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'scrollTo', {
    value: () => undefined,
    writable: true,
  })
}
