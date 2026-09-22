import { nextTick, watch, type Ref } from 'vue'

/**
 * Returns focus to whatever the reader was on when a panel opened
 * (DESIGN.md 16.2: "Inspector 打开时焦点移入标题，关闭后返回触发元素").
 *
 * The trigger is read while the panel is still closed. The watcher runs before
 * the DOM is patched (`flush: 'pre'`), so `document.activeElement` is still the
 * node, edge or button that opened the panel rather than the panel title the
 * drawer is about to focus.
 *
 * Only the return half lives here; moving focus *into* the panel belongs to the
 * panel, which is the component that knows what its own title is.
 */
export function useFocusReturn(isOpen: Ref<boolean>): void {
  let returnTarget: HTMLElement | null = null

  watch(
    isOpen,
    (open) => {
      if (open) {
        const active = document.activeElement
        /*
         * `body` is what `activeElement` reports when nothing is focused — a
         * click on something that cannot take focus, or a selection restored
         * from the URL before any interaction. Focusing `body` on close would
         * silently send a keyboard user back to the top of the document, which
         * is worse than leaving focus where the removal put it.
         */
        returnTarget = active instanceof HTMLElement && active !== document.body ? active : null
        return
      }

      const target = returnTarget
      returnTarget = null
      // A trigger that the close itself unmounted (a filtered-out node) has
      // nowhere to receive focus.
      if (target === null || !target.isConnected) return

      void nextTick(() => {
        target.focus()
      })
    },
    { flush: 'pre' },
  )
}
