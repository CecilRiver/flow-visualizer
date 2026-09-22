<script setup lang="ts">
import { computed } from 'vue'

import { useFolderSession } from '@/composables/useFolderSession'
import { useFolderSourceStore } from '@/stores/folderSource'

/**
 * The first screen (DESIGN.md 12.1).
 *
 * It states the three things a reader needs before handing over a folder: what
 * is read, that nothing leaves the browser, and which Schema version is
 * supported. The fallback path is described as a normal mode, not a fault.
 */
const folderSource = useFolderSourceStore()
const session = useFolderSession()

const capabilities = computed(() => session.capabilities.value)

const denied = computed(() => folderSource.status === 'denied')
const failed = computed(() => folderSource.status === 'failed')

const failureMessage = computed(() => folderSource.errorMessage ?? '')
</script>

<template>
  <div class="folder-welcome">
    <div class="folder-welcome__panel">
      <h1 class="folder-welcome__title">
        业务流程查看器
      </h1>
      <p class="folder-welcome__lead">
        选择一个包含提取结果 YAML 的本地目录，查看 L0–L2 业务流程与数据依赖图。
      </p>

      <ul class="folder-welcome__facts">
        <li>只读取所选目录中的 YAML 文件，不上传、不修改、不写入。</li>
        <li>所有解析与布局都在浏览器内完成，文件内容不会离开本机。</li>
        <li>当前支持的 Schema 版本：<code>0.1</code>。</li>
      </ul>

      <ElButton
        type="primary"
        size="large"
        :loading="folderSource.isBusy"
        @click="folderSource.chooseFolder()"
      >
        选择 flow 文件夹
      </ElButton>

      <p class="folder-welcome__hint">
        请选择提取结果目录（包含 <code>*.flow.yaml</code> 的文件夹），
        而不是 ArduPilot 源码根目录。
      </p>

      <ElAlert
        v-if="!capabilities.supportsDirectoryPicker"
        type="info"
        :closable="false"
        show-icon
        title="当前浏览器使用兼容目录选择"
      >
        该浏览器未提供目录句柄 API，将使用一次性文件选择。功能完整，
        但「刷新」需要重新选择目录。
      </ElAlert>

      <ElAlert
        v-if="!capabilities.secureContext"
        type="warning"
        :closable="false"
        show-icon
        title="当前页面不是安全上下文"
      >
        目录选择 API 需要安全上下文。请通过 <code>pnpm dev</code> 的 localhost
        地址或 HTTPS 部署打开本页面。
      </ElAlert>

      <ElAlert
        v-if="denied"
        type="warning"
        :closable="false"
        show-icon
        title="未获得目录读取权限"
      >
        {{ failureMessage === '' ? '可以重新选择目录以继续。' : failureMessage }}
      </ElAlert>

      <ElAlert
        v-if="failed"
        type="error"
        :closable="false"
        show-icon
        title="目录读取失败"
      >
        {{ failureMessage }}
      </ElAlert>
    </div>
  </div>
</template>

<style scoped>
.folder-welcome {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: var(--space-6);
  background: var(--surface-app);
  overflow-y: auto;
}

.folder-welcome__panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 560px;
  padding: var(--space-8);
  background: var(--surface-panel);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}

.folder-welcome__title {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: 600;
}

.folder-welcome__lead {
  margin: 0;
  color: var(--text-secondary);
}

.folder-welcome__facts {
  margin: 0;
  padding-left: var(--space-5);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.folder-welcome__hint {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--text-muted);
}

code {
  font-family: var(--font-mono);
  background: var(--surface-sunken);
  border-radius: var(--radius-sm);
  padding: 0 var(--space-1);
}
</style>
