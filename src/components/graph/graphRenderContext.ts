import { computed, inject, provide, ref, type InjectionKey, type Ref } from 'vue'

import { zoomBucket, type ZoomBucket } from '@/layout/readabilityOptions'

/**
 * The zoom band, handed from the canvas to the edge renderer
 * (GRAPH_READABILITY_DESIGN.md 5.3).
 *
 * It travels by provide/inject rather than through a store or the URL. Zoom is
 * transient view state that exists only while a canvas is mounted: putting it in
 * Pinia would make it survive the canvas it describes, and putting it in the URL
 * would make a zoomed-in link a different document from a zoomed-out one. The
 * deeper reason is that the band must not rebuild the edge array — an edge that
 * re-renders because it scrolled past a threshold is a re-layout the reader did
 * not ask for.
 *
 * Inject survives Vue's `<Teleport>`, which matters here: `EdgeLabelRenderer`
 * moves the label out of the edge's DOM subtree, but the component instance
 * chain that `inject` walks is unchanged.
 */

const ZOOM_BUCKET: InjectionKey<Readonly<Ref<ZoomBucket>>> = Symbol(
  'flow-visualizer:zoom-bucket',
)

/** The band used when no canvas is above the caller. */
const ALWAYS_NORMAL: Readonly<Ref<ZoomBucket>> = ref('normal')

/**
 * Publishes a zoom factor as a band. Called by the canvas.
 *
 * Takes the factor rather than the band so the thresholds stay in
 * `readabilityOptions` and there is exactly one place that decides where the
 * bands begin.
 */
export function provideZoomBucket(zoom: Readonly<Ref<number>>): void {
  provide(
    ZOOM_BUCKET,
    computed(() => zoomBucket(zoom.value)),
  )
}

/**
 * The current zoom band. Called by the edge renderer.
 *
 * Falls back to `normal` rather than hiding everything: a component mounted
 * without a canvas — in a test, or in a future static export — should draw its
 * labels, and only a canvas that knows the zoom is entitled to suppress them.
 */
export function useZoomBucket(): Readonly<Ref<ZoomBucket>> {
  return inject(ZOOM_BUCKET, ALWAYS_NORMAL)
}
