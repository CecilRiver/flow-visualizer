<script setup lang="ts">
import { computed } from 'vue'

import { groupIssues, summarizeIssues, type IssueStage, type ValidationIssue } from '@/domain/validation'

/**
 * Everything that went wrong while loading the folder (DESIGN.md 17.1).
 *
 * Issues are grouped by file and stage because a file that fails Schema
 * validation produces several at once and the shared cause is the interesting
 * part. The stable issue code is shown next to each message: the wording may
 * change, the code does not, and it is what a bug report should quote.
 */
const props = defineProps<{ issues: readonly ValidationIssue[] }>()

const emit = defineEmits<{
  close: []
  selectFile: [relativePath: string]
}>()

const STAGE_LABEL: Record<IssueStage, string> = {
  filesystem: '文件系统',
  discovery: '文件发现',
  yaml: 'YAML',
  schema: 'Schema',
  semantic: '语义',
  layout: '布局',
}

const counts = computed(() => summarizeIssues(props.issues))

/** Errors first, then warnings; each already grouped by file and stage. */
const groups = computed(() => groupIssues(props.issues))
</script>

<template>
  <section
    class="validation-panel"
    aria-label="校验问题"
  >
    <header class="validation-panel__head">
      <h2 class="validation-panel__title">
        校验问题
      </h2>
      <span class="validation-panel__counts">
        <span class="validation-panel__count validation-panel__count--error">
          错误 {{ counts.errors }}
        </span>
        <span class="validation-panel__count validation-panel__count--warning">
          警告 {{ counts.warnings }}
        </span>
      </span>
      <button
        type="button"
        class="validation-panel__close"
        aria-label="关闭校验面板"
        @click="emit('close')"
      >
        ✕
      </button>
    </header>

    <p
      v-if="issues.length === 0"
      class="validation-panel__empty"
    >
      当前目录没有发现问题。
    </p>

    <div
      v-else
      class="validation-panel__body"
    >
      <section
        v-for="group in groups"
        :key="group.key"
        class="validation-panel__group"
      >
        <header class="validation-panel__group-head">
          <button
            v-if="group.relativePath !== ''"
            type="button"
            class="validation-panel__file"
            @click="emit('selectFile', group.relativePath)"
          >
            {{ group.relativePath }}
          </button>
          <span
            v-else
            class="validation-panel__file validation-panel__file--none"
          >目录级</span>

          <span class="validation-panel__stage">{{ STAGE_LABEL[group.stage] }}</span>
          <span
            class="validation-panel__count"
            :class="`validation-panel__count--${group.severity}`"
          >
            {{ group.severity === 'error' ? '错误' : '警告' }}
            {{ group.issues.length }}
          </span>
        </header>

        <ul class="validation-panel__issues">
          <li
            v-for="(issue, index) in group.issues"
            :key="`${issue.code}-${String(index)}`"
            class="validation-panel__issue"
          >
            <code class="validation-panel__code">{{ issue.code }}</code>
            <span class="validation-panel__message">{{ issue.message }}</span>
            <span
              v-if="issue.instancePath !== undefined && issue.instancePath !== ''"
              class="validation-panel__where"
            >
              <code>{{ issue.instancePath }}</code>
            </span>
            <span
              v-if="issue.line !== undefined"
              class="validation-panel__where"
            >
              第 {{ issue.line }} 行{{ issue.column === undefined ? '' : ` 第 ${issue.column} 列` }}
            </span>
            <span
              v-if="issue.relatedIds !== undefined && issue.relatedIds.length > 0"
              class="validation-panel__where"
            >
              相关：{{ issue.relatedIds.join('、') }}
            </span>
          </li>
        </ul>
      </section>
    </div>
  </section>
</template>

<style scoped>
.validation-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  max-height: 60vh;
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.validation-panel__head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}

.validation-panel__title {
  margin: 0;
  font-size: var(--font-size-md);
  font-weight: 600;
}

.validation-panel__counts {
  display: flex;
  gap: var(--space-2);
  margin-left: auto;
  font-size: var(--font-size-xs);
}

.validation-panel__count--error {
  color: var(--status-conflict);
}

.validation-panel__count--warning {
  color: var(--status-docs);
}

.validation-panel__close {
  flex: none;
  border: 1px solid var(--border-subtle);
  background: none;
  border-radius: var(--radius-md);
  width: 26px;
  height: 26px;
  line-height: 1;
  font: inherit;
  color: var(--text-secondary);
  cursor: pointer;
}

.validation-panel__empty {
  margin: 0;
  padding: var(--space-4);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.validation-panel__body {
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-2) var(--space-3) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.validation-panel__group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.validation-panel__group-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
}

.validation-panel__file {
  border: none;
  background: none;
  padding: 0;
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  color: var(--focus-ring);
  text-decoration: underline;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.validation-panel__file--none {
  color: var(--text-muted);
  text-decoration: none;
  cursor: default;
  font-family: var(--font-sans);
}

.validation-panel__stage {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 0 var(--space-1);
}

.validation-panel__issues {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.validation-panel__issue {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-left: 2px solid var(--border-subtle);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}

.validation-panel__code {
  font-family: var(--font-mono);
  color: var(--text-muted);
}

.validation-panel__message {
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.validation-panel__where {
  color: var(--text-muted);
}

.validation-panel__where code {
  font-family: var(--font-mono);
}
</style>
