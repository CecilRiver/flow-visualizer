<script setup lang="ts">
import { computed, ref } from 'vue'

import { flowKindLegend, scopeLegend, verificationLegend } from '@/styles/semanticTokens'

/**
 * The legend (DESIGN.md 15.2).
 *
 * It reads the same table the canvas draws from, so it cannot describe a
 * palette the graph is not using. Each entry carries its non-colour cue — the
 * verification glyph, the line pattern and width — because colour alone is
 * never allowed to be the whole message.
 */
const collapsed = ref(false)

const verifications = computed(() => verificationLegend())
const kinds = computed(() => flowKindLegend())
const scopes = computed(() => scopeLegend())
</script>

<template>
  <section
    class="legend"
    aria-label="图例"
  >
    <header class="legend__head">
      <h2 class="legend__title">
        图例
      </h2>
      <button
        type="button"
        class="legend__toggle"
        :aria-expanded="!collapsed"
        @click="collapsed = !collapsed"
      >
        {{ collapsed ? '展开' : '收起' }}
      </button>
    </header>

    <div
      v-show="!collapsed"
      class="legend__body"
    >
      <h3 class="legend__group">
        验证状态
      </h3>
      <ul class="legend__list">
        <li
          v-for="entry in verifications"
          :key="entry.verification"
          class="legend__item"
          :title="entry.description"
        >
          <span
            class="legend__glyph"
            :style="{ color: entry.color, borderColor: entry.color, background: entry.surface }"
            aria-hidden="true"
          >{{ entry.glyph }}</span>
          <span>{{ entry.label }}</span>
        </li>
      </ul>

      <h3 class="legend__group">
        数据流类型
      </h3>
      <ul class="legend__list">
        <li
          v-for="entry in kinds"
          :key="entry.kind"
          class="legend__item"
          :title="entry.description"
        >
          <svg
            class="legend__swatch"
            width="28"
            height="10"
            aria-hidden="true"
          >
            <line
              x1="1"
              y1="5"
              x2="27"
              y2="5"
              :stroke="entry.color"
              :stroke-width="entry.strokeWidth"
              :stroke-dasharray="entry.dashArray === '' ? undefined : entry.dashArray"
              stroke-linecap="round"
            />
          </svg>
          <span>{{ entry.label }}</span>
        </li>
      </ul>

      <h3 class="legend__group">
        组件边界
      </h3>
      <ul class="legend__list">
        <li
          v-for="entry in scopes"
          :key="entry.scope"
          class="legend__item"
          :title="entry.description"
        >
          <span
            class="legend__swatch-box"
            :style="{ borderColor: entry.color, background: entry.surface }"
            aria-hidden="true"
          />
          <span>{{ entry.label }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.legend {
  background: var(--surface-panel);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  max-width: 260px;
  font-size: var(--font-size-xs);
}

.legend__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
}

.legend__title {
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.legend__toggle {
  border: none;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  font: inherit;
  padding: 0;
}

.legend__body {
  padding: 0 var(--space-3) var(--space-3);
  max-height: 46vh;
  overflow-y: auto;
}

.legend__group {
  margin: var(--space-3) 0 var(--space-1);
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.legend__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.legend__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-secondary);
}

.legend__glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  border: 1px solid;
  border-radius: var(--radius-sm);
  font-size: 10px;
  line-height: 1;
  flex: none;
}

.legend__swatch {
  flex: none;
}

.legend__swatch-box {
  width: 18px;
  height: 12px;
  border: 1px solid;
  border-radius: var(--radius-sm);
  flex: none;
}

</style>
