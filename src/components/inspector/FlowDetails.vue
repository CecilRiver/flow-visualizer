<script setup lang="ts">
import type { FlowDetail } from '@/composables/useSelectionDetails'

import DataContractDetails from './DataContractDetails.vue'
import EvidenceList from './EvidenceList.vue'
import SourceLinkItem from './SourceLinkItem.vue'
import VerificationBadge from './VerificationBadge.vue'

/**
 * One raw flow, in the fixed order of DESIGN.md 14.2.
 *
 * The contract section is a table rather than a summary so a reader can check
 * an individual field's unit and range — the details a data-flow claim usually
 * depends on.
 */
defineProps<{ flow: FlowDetail }>()
</script>

<template>
  <article class="flow-details">
    <header class="flow-details__head">
      <h3 class="flow-details__name">
        {{ flow.name }}
      </h3>
      <div class="flow-details__badges">
        <span class="flow-details__chip flow-details__chip--kind">{{ flow.kindLabel }}</span>
        <span
          v-if="flow.feedback"
          class="flow-details__chip"
        >反馈</span>
        <VerificationBadge
          :verification="flow.verification"
          :label="flow.verificationLabel"
        />
      </div>
      <code class="flow-details__id">{{ flow.id }}</code>
    </header>

    <section class="flow-details__section">
      <h4 class="flow-details__heading">
        端点
      </h4>
      <p class="flow-details__endpoint">
        <code>{{ flow.fromLabel }}</code>
        <span aria-hidden="true">→</span>
        <code>{{ flow.toLabel }}</code>
      </p>
    </section>

    <section class="flow-details__section">
      <h4 class="flow-details__heading">
        数据契约
      </h4>
      <DataContractDetails :entries="flow.contracts" />
    </section>

    <section class="flow-details__section">
      <h4 class="flow-details__heading">
        传输
      </h4>
      <dl class="flow-details__meta">
        <dt>transport</dt>
        <dd>{{ flow.transportLabel }}</dd>
        <dt>cadence</dt>
        <dd>{{ flow.cadenceLabel }}</dd>
        <dt>transform</dt>
        <dd>{{ flow.transform }}</dd>
        <dt>feedback</dt>
        <dd>{{ flow.feedback ? '是' : '否' }}</dd>
      </dl>
      <ul
        v-if="flow.conditions.length > 0"
        class="flow-details__list"
      >
        <li
          v-for="(condition, index) in flow.conditions"
          :key="index"
        >
          {{ condition }}
        </li>
      </ul>
      <p
        v-if="flow.notes !== ''"
        class="flow-details__text flow-details__text--muted"
      >
        {{ flow.notes }}
      </p>
    </section>

    <section class="flow-details__section">
      <h4 class="flow-details__heading">
        证据（{{ flow.evidence.length }}）
      </h4>
      <EvidenceList :evidence="flow.evidence" />
    </section>

    <section
      v-if="flow.links.length > 0"
      class="flow-details__section"
    >
      <h4 class="flow-details__heading">
        来源
      </h4>
      <div class="flow-details__stack">
        <SourceLinkItem
          v-for="link in flow.links"
          :key="link.source.id"
          :link="link"
        />
      </div>
    </section>
  </article>
</template>

<style scoped>
.flow-details {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.flow-details__head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.flow-details__name {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.flow-details__badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
}

.flow-details__chip {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 0 var(--space-1);
}

.flow-details__chip--kind {
  color: var(--text-primary);
  font-weight: 600;
}

.flow-details__id {
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.flow-details__section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.flow-details__heading {
  margin: 0;
  font-size: var(--font-size-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.flow-details__endpoint {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--font-size-sm);
  overflow-wrap: anywhere;
}

.flow-details__endpoint code {
  font-family: var(--font-mono);
  color: var(--text-primary);
}

.flow-details__meta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-1) var(--space-3);
  margin: 0;
  font-size: var(--font-size-sm);
}

.flow-details__meta dt {
  font-family: var(--font-mono);
  color: var(--text-muted);
}

.flow-details__meta dd {
  margin: 0;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.flow-details__list {
  margin: 0;
  padding-left: var(--space-4);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.flow-details__text {
  margin: 0;
  font-size: var(--font-size-sm);
  overflow-wrap: anywhere;
}

.flow-details__text--muted {
  color: var(--text-secondary);
}

.flow-details__stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
</style>
