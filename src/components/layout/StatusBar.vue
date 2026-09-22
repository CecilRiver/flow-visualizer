<script setup lang="ts">
import { computed } from 'vue'

import { REVIEW_STATUS_LABEL, labelFor } from '@/domain/labels'
import { summarizeIssues } from '@/domain/validation'
import { useGraphController } from '@/composables/useGraphController'
import { useCatalogStore } from '@/stores/catalog'
import { useFolderSourceStore } from '@/stores/folderSource'

/**
 * Status bar (DESIGN.md 15.3).
 *
 * Everything here is a fact about what is on screen: which folder, which
 * revision, which review status, how much is valid, and whether the layout was
 * degraded. The disclaimer is permanent, not a dismissible toast.
 */
const catalog = useCatalogStore()
const folderSource = useFolderSourceStore()
const controller = useGraphController()

/** The panel opens from here; the view owns whether it is showing. */
const emit = defineEmits<{ openValidation: [] }>()

const bundle = computed(() => catalog.activeBundle)

const shortRevision = computed(() => {
  const revision = bundle.value?.bundle.model.source_revision ?? ''
  return revision === '' ? '—' : revision.slice(0, 8)
})

const fullRevision = computed(() => bundle.value?.bundle.model.source_revision ?? '')

const reviewLabel = computed(() => {
  const status = bundle.value?.bundle.model.review_status
  return status === undefined ? '—' : labelFor(REVIEW_STATUS_LABEL, status)
})

/**
 * `review_status` and per-item `verification` are different claims, and the bar
 * keeps them visibly apart: a Schema-validated model is not a reviewed one
 * (DESIGN.md 14.3).
 */
const reviewHint = computed(() => {
  const status = bundle.value?.bundle.model.review_status
  if (status === 'human_reviewed') return '模型整体已完成人工评审'
  if (status === undefined) return '尚未加载模型'
  return `模型整体状态为${labelFor(REVIEW_STATUS_LABEL, status)}，不代表单条结论已人工评审`
})

const componentCount = computed(() => controller.slice.value?.components.length ?? 0)
const flowCount = computed(() => controller.slice.value?.flows.length ?? 0)
const edgeCount = computed(() => controller.graph.value.edges.length)
const nodeCount = computed(
  () => controller.graph.value.nodes.length + controller.graph.value.groups.length,
)

const modeLabel = computed(() => {
  const mode = folderSource.mode
  if (mode === null) return '—'
  return mode === 'directory-handle' ? '目录句柄' : '兼容选择'
})

/**
 * Warnings are counted separately from errors: they never invalidate a file.
 *
 * Both come from the same list the validation panel lists, so the numbers here
 * always match the rows there.
 */
const issueCounts = computed(() => summarizeIssues(catalog.allIssues))
const warningCount = computed(() => issueCounts.value.warnings)
const errorCount = computed(() => issueCounts.value.errors)

const layoutDegraded = computed(() => controller.layoutUsedFallback.value)
</script>

<template>
  <footer class="status-bar">
    <span class="status-bar__disclaimer">语义数据依赖图，非单次循环严格时序</span>

    <span class="status-bar__sep" />

    <span class="status-bar__item">
      <span class="status-bar__label">目录</span>
      {{ folderSource.displayLabel }}
    </span>
    <span class="status-bar__item">
      <span class="status-bar__label">读取</span>{{ modeLabel }}
    </span>
    <span class="status-bar__item">
      <span class="status-bar__label">文件</span>
      有效 {{ catalog.validBundles.length }} · 无效 {{ catalog.invalidBundles.length }}
    </span>

    <span class="status-bar__sep" />

    <ElTooltip
      :content="fullRevision === '' ? '未提供 revision' : fullRevision"
      placement="top"
    >
      <span class="status-bar__item status-bar__mono">
        <span class="status-bar__label">rev</span>{{ shortRevision }}
      </span>
    </ElTooltip>

    <ElTooltip
      :content="reviewHint"
      placement="top"
    >
      <span class="status-bar__item">
        <span class="status-bar__label">review</span>{{ reviewLabel }}
      </span>
    </ElTooltip>

    <span class="status-bar__sep" />

    <span class="status-bar__item">
      <span class="status-bar__label">组件</span>{{ componentCount }}
      <span class="status-bar__label">原始流</span>{{ flowCount }}
      <span class="status-bar__label">节点</span>{{ nodeCount }}
      <span class="status-bar__label">投影边</span>{{ edgeCount }}
    </span>

    <span class="status-bar__spacer" />

    <button
      v-if="warningCount > 0"
      type="button"
      class="status-bar__item status-bar__item--warning status-bar__trigger"
      @click="emit('openValidation')"
    >
      配置警告 {{ warningCount }}
    </button>
    <button
      v-if="errorCount > 0"
      type="button"
      class="status-bar__item status-bar__item--error status-bar__trigger"
      @click="emit('openValidation')"
    >
      错误 {{ errorCount }}
    </button>
    <button
      v-if="warningCount === 0 && errorCount === 0 && catalog.hasContent"
      type="button"
      class="status-bar__item status-bar__trigger status-bar__trigger--quiet"
      @click="emit('openValidation')"
    >
      校验通过
    </button>
    <span
      v-if="layoutDegraded"
      class="status-bar__item status-bar__item--warning"
      role="status"
    >
      布局降级为列式排布
    </span>
  </footer>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--statusbar-height);
  padding: 0 var(--space-4);
  background: var(--surface-panel);
  border-top: 1px solid var(--border-subtle);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  overflow-x: auto;
  white-space: nowrap;
  flex: none;
}

.status-bar__disclaimer {
  color: var(--text-primary);
  font-weight: 600;
  flex: none;
}

.status-bar__sep {
  width: 1px;
  height: 16px;
  background: var(--border-subtle);
  flex: none;
}

.status-bar__item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  flex: none;
}

.status-bar__label {
  color: var(--text-muted);
}

.status-bar__mono {
  font-family: var(--font-mono);
}

.status-bar__item--warning {
  color: var(--status-docs);
}

.status-bar__item--error {
  color: var(--status-conflict);
}

/* The counts are the way into the full list, so they are buttons. */
.status-bar__trigger {
  border: none;
  background: none;
  padding: 0 var(--space-1);
  font: inherit;
  cursor: pointer;
  border-radius: var(--radius-sm);
}

.status-bar__trigger:hover {
  background: var(--surface-sunken);
}

.status-bar__trigger:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.status-bar__trigger--quiet {
  color: var(--text-muted);
}

.status-bar__spacer {
  margin-left: auto;
}
</style>
