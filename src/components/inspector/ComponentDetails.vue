<script setup lang="ts">
import type { ComponentDetail } from '@/composables/useSelectionDetails'

import EvidenceList from './EvidenceList.vue'
import SourceLinkItem from './SourceLinkItem.vue'
import VerificationBadge from './VerificationBadge.vue'

/**
 * One component, in the fixed order of DESIGN.md 14.1.
 *
 * Everything shown here is configuration text or an enum translation of it —
 * never a rephrasing. The `level` shown is the component's own level, which is
 * not always the level of the view it is drawn in.
 */
defineProps<{ component: ComponentDetail }>()
</script>

<template>
  <article class="component-details">
    <header class="component-details__head">
      <h3 class="component-details__name">
        {{ component.name }}
      </h3>
      <div class="component-details__badges">
        <span class="component-details__chip">L{{ component.level }}</span>
        <span class="component-details__chip">{{ component.kindLabel }}</span>
        <span class="component-details__chip">{{ component.scopeLabel }}</span>
        <VerificationBadge
          :verification="component.verification"
          :label="component.verificationLabel"
        />
      </div>
      <code class="component-details__id">{{ component.id }}</code>
    </header>

    <section class="component-details__section">
      <h4 class="component-details__heading">
        职责
      </h4>
      <p class="component-details__text">
        {{ component.responsibility }}
      </p>
      <p
        v-if="component.description !== ''"
        class="component-details__text component-details__text--muted"
      >
        {{ component.description }}
      </p>
    </section>

    <section
      v-if="component.conditions.length > 0"
      class="component-details__section"
    >
      <h4 class="component-details__heading">
        条件
      </h4>
      <ul class="component-details__list">
        <li
          v-for="(condition, index) in component.conditions"
          :key="index"
        >
          {{ condition }}
        </li>
      </ul>
    </section>

    <section
      v-if="component.tags.length > 0"
      class="component-details__section"
    >
      <h4 class="component-details__heading">
        标签
      </h4>
      <div class="component-details__badges">
        <span
          v-for="tag in component.tags"
          :key="tag"
          class="component-details__chip"
        >{{ tag }}</span>
      </div>
    </section>

    <section
      v-if="component.ports.length > 0"
      class="component-details__section"
    >
      <h4 class="component-details__heading">
        端口（{{ component.ports.length }}）
      </h4>
      <ul class="component-details__list">
        <li
          v-for="port in component.ports"
          :key="port.id"
          class="component-details__port"
        >
          <span class="component-details__port-name">{{ port.name }}</span>
          <span class="component-details__chip">{{ port.directionLabel }}</span>
          <span
            v-if="port.required"
            class="component-details__chip component-details__chip--required"
          >必填</span>
          <span class="component-details__contract">{{ port.contractName }}</span>
          <span
            v-if="port.description !== ''"
            class="component-details__text--muted"
          >{{ port.description }}</span>
        </li>
      </ul>
    </section>

    <section
      v-if="component.implementations.length > 0"
      class="component-details__section"
    >
      <h4 class="component-details__heading">
        实现绑定（{{ component.implementations.length }}）
      </h4>
      <div class="component-details__stack">
        <div
          v-for="(binding, index) in component.implementations"
          :key="index"
          class="component-details__binding"
        >
          <span class="component-details__chip">{{ binding.roleLabel }}</span>
          <p
            v-if="binding.notes !== ''"
            class="component-details__text component-details__text--muted"
          >
            {{ binding.notes }}
          </p>
        </div>
      </div>
    </section>

    <section
      v-if="component.evidence.length > 0"
      class="component-details__section"
    >
      <h4 class="component-details__heading">
        证据（{{ component.evidence.length }}）
      </h4>
      <EvidenceList :evidence="component.evidence" />
    </section>

    <section
      v-if="component.links.length > 0"
      class="component-details__section"
    >
      <h4 class="component-details__heading">
        来源
      </h4>
      <div class="component-details__stack">
        <SourceLinkItem
          v-for="link in component.links"
          :key="link.source.id"
          :link="link"
        />
      </div>
    </section>
  </article>
</template>

<style scoped>
.component-details {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.component-details__head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.component-details__name {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.component-details__badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
}

.component-details__chip {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 0 var(--space-1);
}

.component-details__chip--required {
  color: var(--status-docs);
  border-color: var(--status-docs);
}

.component-details__id {
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.component-details__section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.component-details__heading {
  margin: 0;
  font-size: var(--font-size-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.component-details__text {
  margin: 0;
  font-size: var(--font-size-md);
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.component-details__text--muted {
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}

.component-details__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.component-details__port {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1);
  overflow-wrap: anywhere;
}

.component-details__port-name {
  font-family: var(--font-mono);
  color: var(--text-primary);
}

.component-details__contract {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
}

.component-details__stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.component-details__binding {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  align-items: flex-start;
}
</style>
