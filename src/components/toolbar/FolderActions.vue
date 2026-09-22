<script setup lang="ts">
import { computed } from 'vue'

import { useFolderSession } from '@/composables/useFolderSession'
import { useFolderSourceStore } from '@/stores/folderSource'

/**
 * Folder selection and refresh (DESIGN.md 6.1).
 *
 * Every action here starts from a user gesture, which is what the browser's
 * picker requires. The viewer only ever asks for read access, and it never
 * writes, creates or deletes anything in the chosen folder.
 */
const folderSource = useFolderSourceStore()
const session = useFolderSession()

const folderName = computed(() => folderSource.displayName ?? '')

/**
 * Refresh is only offered for the directory-handle mode: a one-shot `<input>`
 * snapshot cannot be re-read after the fact, and pretending otherwise would
 * silently show stale data.
 */
const refreshHint = computed(() =>
  folderSource.canRefresh
    ? '重新扫描当前目录'
    : '该浏览器使用一次性文件选择，请重新选择目录以刷新',
)
</script>

<template>
  <div class="folder-actions">
    <ElTooltip
      v-if="folderName !== ''"
      :content="folderName"
      placement="bottom"
    >
      <span
        class="folder-actions__name u-truncate"
        aria-label="当前目录"
      >{{ folderName }}</span>
    </ElTooltip>

    <ElTooltip
      :content="refreshHint"
      placement="bottom"
    >
      <!-- A disabled button cannot fire a tooltip, so it is wrapped instead. -->
      <span class="folder-actions__refresh-wrap">
        <ElButton
          :disabled="!folderSource.canRefresh || folderSource.isBusy"
          :loading="folderSource.isBusy"
          @click="folderSource.refresh()"
        >
          刷新
        </ElButton>
      </span>
    </ElTooltip>

    <ElButton @click="folderSource.chooseAnotherFolder()">
      更换目录
    </ElButton>

    <span
      v-if="!session.capabilities.value.supportsDirectoryPicker"
      class="folder-actions__mode"
    >
      兼容模式
    </span>
  </div>
</template>

<style scoped>
.folder-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.folder-actions__name {
  max-width: 160px;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  background: var(--surface-sunken);
  border-radius: var(--radius-pill);
  padding: var(--space-1) var(--space-3);
}

.folder-actions__refresh-wrap {
  display: inline-flex;
}

.folder-actions__mode {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-pill);
  padding: 0 var(--space-2);
}
</style>
