<script setup lang="ts">
import { computed } from 'vue'

import { useGraphController } from '@/composables/useGraphController'
import { useExplorerStore } from '@/stores/explorer'
import { useFolderSourceStore } from '@/stores/folderSource'

/**
 * Graph-level actions (DESIGN.md 15.3).
 *
 * Only actions that change the view live here. There is deliberately no export,
 * no share-a-link and no "apply changes" control: the viewer is read-only and a
 * button that implied otherwise would misrepresent what it does.
 */
const explorer = useExplorerStore()
const controller = useGraphController()
const folderSource = useFolderSourceStore()

const hiddenByFilter = computed(() => !explorer.allFlowKindsSelected || !explorer.allVerificationsSelected)

const collapsed = computed({
  get: () => explorer.leftPanelCollapsed,
  set: (value: boolean) => explorer.setLeftPanelCollapsed(value),
})
</script>

<template>
  <div class="graph-actions">
    <ElButton @click="collapsed = !collapsed">
      {{ collapsed ? '显示场景栏' : '隐藏场景栏' }}
    </ElButton>

    <ElButton
      :disabled="!hiddenByFilter"
      @click="explorer.resetFlowKinds(); explorer.resetVerifications()"
    >
      重置筛选
    </ElButton>

    <ElButton
      :disabled="controller.selection.value === null"
      @click="controller.clearSelection()"
    >
      清除选择
    </ElButton>

    <span
      v-if="folderSource.status === 'denied'"
      class="graph-actions__denied"
      role="status"
    >
      目录权限已被拒绝，可重新选择目录
    </span>
  </div>
</template>

<style scoped>
.graph-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.graph-actions__denied {
  font-size: var(--font-size-xs);
  color: var(--status-conflict);
}
</style>
