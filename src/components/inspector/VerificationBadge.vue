<script setup lang="ts">
import { computed } from 'vue'

import type { Verification } from '@/domain/model'
import { verificationGlyph, verificationTokenName } from '@/styles/semanticTokens'

/**
 * The verification state of one configuration item (DESIGN.md 14.3, 16.2).
 *
 * Colour comes from the shared token table and is always accompanied by the
 * glyph and the full label, so the state is readable without colour — and so it
 * cannot drift away from the legend the canvas uses.
 *
 * This is the state of a single component or flow. The model-wide
 * `review_status` is a different claim and is shown separately, with different
 * wording.
 */
const props = defineProps<{
  verification: Verification | null
  label: string
  /** Rendered after the label, e.g. the underlying flow count of an edge. */
  note?: string
}>()

const color = computed(() =>
  props.verification === null ? 'var(--text-muted)' : `var(${verificationTokenName(props.verification)})`,
)

const background = computed(() =>
  props.verification === null
    ? 'transparent'
    : `var(${verificationTokenName(props.verification)}-bg)`,
)

const glyph = computed(() =>
  props.verification === null ? '–' : verificationGlyph(props.verification),
)
</script>

<template>
  <span
    class="verification-badge"
    :style="{ color, background, borderColor: color }"
  >
    <span
      class="verification-badge__glyph"
      aria-hidden="true"
    >{{ glyph }}</span>
    <span>{{ label }}</span>
    <span
      v-if="note !== undefined"
      class="verification-badge__note"
    >{{ note }}</span>
  </span>
</template>

<style scoped>
.verification-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-2);
  border: 1px solid;
  border-radius: var(--radius-pill);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.verification-badge__glyph {
  font-family: var(--font-mono);
  font-weight: 700;
}

.verification-badge__note {
  color: var(--text-muted);
}
</style>
