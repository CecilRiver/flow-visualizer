<script setup lang="ts">
import type { EvidenceDetail } from '@/composables/useSelectionDetails'

import SourceLinkItem from './SourceLinkItem.vue'

/**
 * Evidence claims with the source each one rests on (DESIGN.md 14.1-14.3).
 *
 * The claim is shown exactly as configured — it is untrusted text and is
 * rendered as text, never as markup (DESIGN.md 17.2). An evidence entry whose
 * `source_id` is not declared keeps its raw id visible instead of silently
 * disappearing.
 */
defineProps<{ evidence: readonly EvidenceDetail[] }>()
</script>

<template>
  <ul class="evidence-list">
    <li
      v-for="(entry, index) in evidence"
      :key="index"
      class="evidence-list__item"
    >
      <div class="evidence-list__claim">
        <span class="evidence-list__support">{{ entry.supportLabel }}</span>
        <span>{{ entry.claim }}</span>
      </div>

      <SourceLinkItem
        v-if="entry.link !== null"
        :link="entry.link"
      />
      <p
        v-else
        class="evidence-list__dangling"
      >
        引用了未声明的 source：<code>{{ entry.sourceId }}</code>
      </p>
    </li>
  </ul>
</template>

<style scoped>
.evidence-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.evidence-list__item {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.evidence-list__claim {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--font-size-md);
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.evidence-list__support {
  flex: none;
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 0 var(--space-1);
}

.evidence-list__dangling {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--status-conflict);
  overflow-wrap: anywhere;
}
</style>
