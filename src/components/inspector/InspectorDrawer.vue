<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import type { ReviewContext, SelectionDetails } from '@/composables/useSelectionDetails'

import ComponentDetails from './ComponentDetails.vue'
import DataContractDetails from './DataContractDetails.vue'
import FlowDetails from './FlowDetails.vue'
import VerificationBadge from './VerificationBadge.vue'

/**
 * The Inspector (DESIGN.md 12.2, 14).
 *
 * Prop-driven by design: it receives an already-resolved `SelectionDetails` and
 * never queries a store or the raw arrays itself, which is what keeps the
 * resolution rules testable without mounting a drawer.
 *
 * A projected element can stand for more than one configuration item — an
 * aggregated edge carries several flows, an L1 node folds several L2 components.
 * Both cases show the count first and then the individual items, so nothing is
 * presented as if a single claim covered everything.
 */
const props = defineProps<{
  details: SelectionDetails
  review: ReviewContext | null
}>()

const emit = defineEmits<{
  close: []
  selectSourceItem: [payload: { kind: 'component' | 'flow'; id: string }]
}>()

const isGroup = computed(() => props.details?.kind === 'node' && props.details.isGroup)

const multipleFlows = computed(
  () => props.details?.kind === 'edge' && props.details.flows.length > 1,
)

/**
 * `review_status` and per-item `verification` are different claims. The footer
 * says which one this is, so "证据已核对" is never read as "人工评审通过".
 */
const reviewHint = computed(() => {
  const status = props.review?.status
  if (status === 'human_reviewed') return '模型整体已完成人工评审'
  if (status === undefined) return ''
  return '模型整体状态不代表单条结论已人工评审'
})

/**
 * Focus moves into the panel when it opens, so a keyboard reader arrives at the
 * conclusion rather than at the top of the page (DESIGN.md 16.2). The heading is
 * the right landing spot: it names what was selected without stealing the
 * tab order, which is why it takes `tabindex="-1"` and not `0`.
 *
 * The matching return to the trigger lives in `useFocusReturn`, which has to
 * read the focused element before this component exists.
 */
const titleElement = ref<HTMLElement | null>(null)

onMounted(() => {
  titleElement.value?.focus()
})
</script>

<template>
  <aside
    v-if="details !== null"
    class="inspector"
    aria-label="选中项详情"
  >
    <header class="inspector__head">
      <div class="inspector__title-group">
        <p class="inspector__kicker">
          {{ details.kind === 'node' ? (isGroup ? '能力域分组' : '节点') : '数据流边' }}
        </p>
        <h2
          ref="titleElement"
          class="inspector__title"
          tabindex="-1"
        >
          {{ details.label }}
        </h2>
      </div>
      <button
        type="button"
        class="inspector__close"
        aria-label="关闭详情"
        @click="emit('close')"
      >
        ✕
      </button>
    </header>

    <div class="inspector__body">
      <!-- Node -->
      <template v-if="details.kind === 'node'">
        <p
          v-if="isGroup"
          class="inspector__note"
        >
          分组容器不承载独立结论，下面列出的是它包含的组件。
        </p>

        <p
          v-if="details.emptyReason !== ''"
          class="inspector__empty"
        >
          {{ details.emptyReason }}
        </p>

        <div
          v-if="details.components.length > 1"
          class="inspector__summary"
          role="status"
        >
          该节点在 L{{ details.components[0]?.level }} 折叠了
          {{ details.components.length }} 个组件。
        </div>

        <ComponentDetails
          v-for="component in details.components"
          :key="component.id"
          :component="component"
        />

        <section
          v-if="details.hiddenFlows.length > 0"
          class="inspector__section"
        >
          <h3 class="inspector__heading">
            折叠的内部流程（{{ details.hiddenFlows.length }}）
          </h3>
          <p class="inspector__note">
            这些 flow 的两端在当前层级投影到同一节点，属于该节点的实现细节。
          </p>
          <ul class="inspector__items">
            <li
              v-for="flow in details.hiddenFlows"
              :key="flow.id"
            >
              <button
                type="button"
                class="inspector__item"
                @click="emit('selectSourceItem', { kind: 'flow', id: flow.id })"
              >
                <span class="inspector__item-name">{{ flow.name }}</span>
                <span class="inspector__item-meta">
                  {{ flow.kindLabel }} · {{ flow.fromLabel }} → {{ flow.toLabel }}
                </span>
              </button>
            </li>
          </ul>
        </section>
      </template>

      <!-- Edge -->
      <template v-else>
        <div class="inspector__summary">
          <span class="inspector__summary-label">
            {{ multipleFlows ? `聚合了 ${String(details.aggregatedFlowCount)} 条原始 flow` : '单条 flow' }}
          </span>
          <VerificationBadge
            :verification="details.verification"
            :label="details.verificationLabel"
            :note="multipleFlows ? '取最保守状态' : undefined"
          />
        </div>

        <p
          v-if="details.emptyReason !== ''"
          class="inspector__empty"
        >
          {{ details.emptyReason }}
        </p>

        <section class="inspector__section">
          <h3 class="inspector__heading">
            数据契约
          </h3>
          <DataContractDetails :entries="details.contracts" />
        </section>

        <FlowDetails
          v-if="details.flows.length === 1 && details.flows[0]"
          :flow="details.flows[0]"
        />

        <details
          v-else-if="details.flows.length > 1"
          class="inspector__disclosure"
          open
        >
          <summary class="inspector__disclosure-summary">
            原始 flow（{{ details.flows.length }}）
          </summary>
          <p class="inspector__note">
            聚合边的结论取全部底层 flow 的最保守状态，不采用多数表决。
          </p>

          <details
            v-for="flow in details.flows"
            :key="flow.id"
            class="inspector__disclosure inspector__disclosure--nested"
          >
            <summary class="inspector__disclosure-summary inspector__disclosure-summary--nested">
              <span class="inspector__item-name">{{ flow.name }}</span>
              <span class="inspector__item-meta">
                {{ flow.kindLabel }} · {{ flow.fromLabel }} → {{ flow.toLabel }}
              </span>
            </summary>
            <button
              type="button"
              class="inspector__locate"
              @click="emit('selectSourceItem', { kind: 'flow', id: flow.id })"
            >
              在图中定位
            </button>
            <FlowDetails :flow="flow" />
          </details>
        </details>
      </template>
    </div>

    <footer
      v-if="review !== null"
      class="inspector__footer"
    >
      <span class="inspector__footer-item">
        <span class="inspector__footer-label">模型评审</span>{{ review.label }}
      </span>
      <span class="inspector__footer-item">
        <span class="inspector__footer-label">revision</span>
        <code>{{ review.sourceRevision }}</code>
      </span>
      <span
        v-if="reviewHint !== ''"
        class="inspector__footer-hint"
      >{{ reviewHint }}</span>
    </footer>
  </aside>
</template>

<style scoped>
.inspector {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  height: 100%;
  min-height: 0;
  background: var(--surface-panel);
  border-left: 1px solid var(--border-subtle);
}

.inspector__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}

.inspector__title-group {
  min-width: 0;
}

.inspector__kicker {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.inspector__title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.inspector__close {
  flex: none;
  border: 1px solid var(--border-subtle);
  background: none;
  border-radius: var(--radius-md);
  width: 28px;
  height: 28px;
  line-height: 1;
  font: inherit;
  color: var(--text-secondary);
  cursor: pointer;
}

.inspector__close:hover {
  background: var(--surface-sunken);
}

.inspector__body {
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.inspector__section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.inspector__heading {
  margin: 0;
  font-size: var(--font-size-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.inspector__summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.inspector__summary-label {
  color: var(--text-primary);
}

.inspector__note {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--text-muted);
}

.inspector__empty {
  margin: 0;
  padding: var(--space-2);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.inspector__items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.inspector__item,
.inspector__locate {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: none;
  font: inherit;
  text-align: left;
  color: var(--text-primary);
  cursor: pointer;
}

.inspector__item:hover,
.inspector__locate:hover {
  border-color: var(--focus-ring);
}

.inspector__locate {
  align-items: center;
  width: auto;
  align-self: flex-start;
  margin: var(--space-1) 0;
  font-size: var(--font-size-xs);
  color: var(--focus-ring);
}

.inspector__item-name {
  font-size: var(--font-size-sm);
}

.inspector__item-meta {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.inspector__disclosure {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-2);
}

.inspector__disclosure--nested {
  margin-top: var(--space-2);
}

.inspector__disclosure-summary {
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
}

.inspector__disclosure-summary--nested {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.inspector__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--border-subtle);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}

.inspector__footer-label {
  color: var(--text-muted);
  margin-right: var(--space-1);
}

.inspector__footer code {
  font-family: var(--font-mono);
}

.inspector__footer-hint {
  flex-basis: 100%;
  color: var(--text-muted);
}
</style>
