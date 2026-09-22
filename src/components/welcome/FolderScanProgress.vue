<script setup lang="ts">
import { computed } from 'vue'

import { useFolderSourceStore } from '@/stores/folderSource'

/**
 * Scan progress (DESIGN.md 12.1).
 *
 * The counts are the scan's real counters, not an animation. There is no
 * percentage: the number of files is only known once discovery finishes, so a
 * bar that filled smoothly would be inventing a denominator.
 *
 * Only the folder name the browser exposes is shown — an absolute path is not
 * available to the page, and fabricating one would misrepresent the machine.
 */
const folderSource = useFolderSourceStore()

const progress = computed(() => folderSource.scanProgress)

const stageLabel = computed(() =>
  folderSource.status === 'choosing' ? '等待选择目录…' : '正在读取目录…',
)

/**
 * Cancelling does not abort an in-flight file read; it invalidates the scan id,
 * so a late result is discarded rather than committed (DESIGN.md 6.5).
 */
function cancel(): void {
  folderSource.clear()
}
</script>

<template>
  <div class="scan-progress">
    <div class="scan-progress__panel">
      <h1 class="scan-progress__title">
        {{ stageLabel }}
      </h1>

      <p class="scan-progress__folder">
        {{ folderSource.displayName ?? '（尚未获得目录名）' }}
      </p>

      <ElProgress
        :percentage="0"
        :show-text="false"
        :indeterminate="true"
        :duration="2"
      />

      <dl class="scan-progress__counts">
        <div>
          <dt>发现</dt>
          <dd>{{ progress.discovered }}</dd>
        </div>
        <div>
          <dt>已处理</dt>
          <dd>{{ progress.processed }}</dd>
        </div>
        <div>
          <dt>有效</dt>
          <dd>{{ progress.valid }}</dd>
        </div>
        <div>
          <dt>无效</dt>
          <dd>{{ progress.invalid }}</dd>
        </div>
        <div>
          <dt>忽略</dt>
          <dd>{{ progress.ignored }}</dd>
        </div>
      </dl>

      <ElButton @click="cancel">
        取消本次读取
      </ElButton>
    </div>
  </div>
</template>

<style scoped>
.scan-progress {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: var(--space-6);
  background: var(--surface-app);
}

.scan-progress__panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: min(480px, 100%);
  padding: var(--space-8);
  background: var(--surface-panel);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}

.scan-progress__title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 600;
}

.scan-progress__folder {
  margin: 0;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
}

.scan-progress__counts {
  display: flex;
  gap: var(--space-5);
  margin: 0;
  flex-wrap: wrap;
}

.scan-progress__counts dt {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
}

.scan-progress__counts dd {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 600;
}
</style>
