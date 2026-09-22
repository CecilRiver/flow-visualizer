<script setup lang="ts">
import { computed } from 'vue'

import FolderScanProgress from '@/components/welcome/FolderScanProgress.vue'
import FolderWelcome from '@/components/welcome/FolderWelcome.vue'
import ExplorerView from '@/views/ExplorerView.vue'
import { useCatalogStore } from '@/stores/catalog'
import { useFolderSourceStore } from '@/stores/folderSource'

/**
 * Root screen selection (DESIGN.md 6.4).
 *
 * The viewer has no "booting" screen: there is nothing to load before the
 * folder picker, and a spinner would suggest work that is not happening. The
 * welcome page is where the app waits, and it waits for a user gesture because
 * that is what the browser's picker requires.
 */
const folderSource = useFolderSourceStore()
const catalog = useCatalogStore()

type Screen = 'welcome' | 'scanning' | 'explorer'

const screen = computed<Screen>(() => {
  if (folderSource.isBusy) return 'scanning'
  if (folderSource.hasFolder || catalog.hasContent) return 'explorer'
  return 'welcome'
})
</script>

<template>
  <FolderScanProgress v-if="screen === 'scanning'" />

  <ExplorerView v-else-if="screen === 'explorer'" />

  <FolderWelcome v-else />
</template>
