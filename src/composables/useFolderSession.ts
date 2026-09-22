import { computed, shallowRef } from 'vue'

import { detectDirectoryCapabilities } from '@/filesystem/chooseDirectory'
import type { DirectoryCapabilities, FolderSession } from '@/filesystem/types'

/**
 * Holds the pieces of the folder selection that must never enter Pinia
 * (DESIGN.md 8.1): a live `FileSystemDirectoryHandle` is not serialisable, is
 * not reactive state, and would end up in devtools snapshots.
 *
 * Module-private refs, cleared whenever the folder changes so a handle from a
 * previous selection cannot linger.
 */

const session = shallowRef<FolderSession | null>(null)
const capabilities = shallowRef<DirectoryCapabilities | null>(null)

function ensureCapabilities(): DirectoryCapabilities {
  const existing = capabilities.value
  if (existing !== null) return existing
  const detected = detectDirectoryCapabilities()
  capabilities.value = detected
  return detected
}

export function useFolderSession() {
  return {
    /** The authorised folder, or `null` when nothing has been picked yet. */
    session,
    capabilities: computed<DirectoryCapabilities>(() => ensureCapabilities()),
    setSession(next: FolderSession | null): void {
      session.value = next
    },
    clearSession(): void {
      session.value = null
    },
  }
}
