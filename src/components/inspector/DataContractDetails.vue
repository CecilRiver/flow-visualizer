<script setup lang="ts">
import { computed } from 'vue'

import type { ContractUsage } from '@/composables/useSelectionDetails'

/**
 * The data contracts behind a flow or an aggregated edge (DESIGN.md 14.2).
 *
 * When the flows behind an edge do not share one contract, every contract is
 * listed and the disagreement is stated. Picking one of them as "the" contract
 * would be inventing a fact: aggregation preserves what the configuration says,
 * and the configuration says the endpoints exchange different things.
 */
const props = defineProps<{ entries: readonly ContractUsage[] }>()

const multiple = computed(() => props.entries.length > 1)
</script>

<template>
  <div class="contract-details">
    <p
      v-if="multiple"
      class="contract-details__warning"
      role="status"
    >
      该边聚合的 {{ entries.length }} 个 data contract 并不相同，未合并展示。
    </p>

    <section
      v-for="entry in entries"
      :key="entry.contract.id"
      class="contract-details__contract"
    >
      <header class="contract-details__head">
        <h4 class="contract-details__name">
          {{ entry.contract.name }}
        </h4>
        <span class="contract-details__id">{{ entry.contract.id }}</span>
        <span
          v-if="multiple"
          class="contract-details__count"
        >{{ entry.flowCount }} 条流</span>
      </header>

      <p
        v-if="entry.contract.description !== ''"
        class="contract-details__description"
      >
        {{ entry.contract.description }}
      </p>

      <p
        v-if="!entry.contract.resolved"
        class="contract-details__warning"
      >
        配置引用了未声明的 data contract，字段无法展开。
      </p>

      <div
        v-else
        class="contract-details__table-wrap"
      >
        <table class="contract-details__table">
          <caption class="u-visually-hidden">
            {{ entry.contract.name }} 的字段
          </caption>
          <thead>
            <tr>
              <th scope="col">
                字段
              </th>
              <th scope="col">
                类型
              </th>
              <th scope="col">
                说明
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="field in entry.contract.fields"
              :key="field.name"
            >
              <td class="contract-details__field">
                {{ field.name }}
                <span
                  v-if="field.nullable"
                  class="contract-details__tag"
                >可空</span>
              </td>
              <td>
                {{ field.typeLabel }}
                <span
                  v-if="field.unit !== ''"
                  class="contract-details__tag"
                >{{ field.unit }}</span>
              </td>
              <td>
                <span class="contract-details__field-desc">{{ field.description }}</span>
                <span
                  v-if="field.rangeText !== ''"
                  class="contract-details__constraint"
                >范围 {{ field.rangeText }}</span>
                <span
                  v-if="field.frame !== ''"
                  class="contract-details__constraint"
                >坐标系 {{ field.frame }}</span>
                <span
                  v-if="field.values.length > 0"
                  class="contract-details__constraint"
                >取值 {{ field.values.join(' / ') }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.contract-details {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.contract-details__contract {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.contract-details__head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.contract-details__name {
  margin: 0;
  font-size: var(--font-size-md);
  font-weight: 600;
}

.contract-details__id,
.contract-details__count {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.contract-details__count {
  font-family: var(--font-sans);
}

.contract-details__description {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.contract-details__warning {
  margin: 0;
  padding: var(--space-2);
  border: 1px solid var(--status-docs);
  background: var(--status-docs-bg);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
}

.contract-details__table-wrap {
  overflow-x: auto;
}

.contract-details__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-xs);
}

.contract-details__table th,
.contract-details__table td {
  text-align: left;
  vertical-align: top;
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
}

.contract-details__table th {
  color: var(--text-muted);
  font-weight: 500;
}

.contract-details__field {
  font-family: var(--font-mono);
  color: var(--text-primary);
  white-space: nowrap;
}

.contract-details__field-desc {
  display: block;
  color: var(--text-secondary);
}

.contract-details__constraint {
  display: block;
  color: var(--text-muted);
}

.contract-details__tag {
  display: inline-block;
  margin-left: var(--space-1);
  padding: 0 var(--space-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  color: var(--text-muted);
}
</style>
