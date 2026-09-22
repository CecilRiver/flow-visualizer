<script setup lang="ts">
import { computed } from 'vue'

import type { SourceLink } from '@/domain/sourceLinks'

/**
 * One evidence source (DESIGN.md 14.3).
 *
 * Two rules are visible in the markup:
 *   - the link text is the source's own title, never "click here", and the
 *     symbol, path and line numbers are shown next to it so the reference can
 *     be judged without following it;
 *   - when no link could be built the source is still rendered, as text, with
 *     the reason. A broken reference is a fact about the model.
 *
 * `href` is produced by `sourceLinks.ts` from the controlled GitHub base, a
 * validated SHA and an encoded relative path; nothing in the configuration can
 * supply it (DESIGN.md 17.2).
 */
const props = defineProps<{ link: SourceLink }>()

/** Shortened for the row; the full SHA stays in the tooltip. */
const shortRevision = computed(() => {
  const revision = props.link.revision
  if (revision === null || revision === '') return ''
  return revision.length > 12 ? revision.slice(0, 12) : revision
})

const fullRevision = computed(() => props.link.revision ?? '')
</script>

<template>
  <div
    class="source-link"
    :class="{ 'is-plain': link.href === null }"
  >
    <div class="source-link__head">
      <span class="source-link__kind">{{ link.kindLabel }}</span>

      <a
        v-if="link.href !== null"
        class="source-link__title"
        :href="link.href"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ link.title }}
      </a>
      <span
        v-else
        class="source-link__title source-link__title--plain"
      >
        {{ link.title }}
      </span>
    </div>

    <div class="source-link__meta">
      <code
        v-if="link.relativePath !== null"
        class="source-link__path"
      >{{ link.relativePath }}</code>
      <span
        v-if="link.locator !== null"
        class="source-link__locator"
      >{{ link.locator }}</span>
      <ElTooltip
        v-if="shortRevision !== ''"
        :content="fullRevision"
        placement="top"
      >
        <span class="source-link__rev">@{{ shortRevision }}</span>
      </ElTooltip>
    </div>

    <p
      v-if="link.href === null"
      class="source-link__blocked"
    >
      {{ link.blockedReason }}，仅以文本展示。
    </p>
  </div>
</template>

<style scoped>
.source-link {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

.source-link.is-plain {
  border-style: dashed;
}

.source-link__head {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}

.source-link__kind {
  flex: none;
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 0 var(--space-1);
}

.source-link__title {
  font-size: var(--font-size-md);
  color: var(--focus-ring);
  text-decoration: underline;
  text-underline-offset: 2px;
  overflow-wrap: anywhere;
}

.source-link__title--plain {
  color: var(--text-primary);
  text-decoration: none;
}

.source-link__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}

.source-link__path {
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}

.source-link__locator {
  font-family: var(--font-mono);
  color: var(--text-muted);
}

.source-link__rev {
  font-family: var(--font-mono);
  color: var(--text-muted);
}

.source-link__blocked {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--status-docs);
}
</style>
