import type { DirectoryCapabilities } from './types'

/** Picker id lets the browser remember the last folder across sessions. */
export const DIRECTORY_PICKER_ID = 'arducopter-flow-folder'

/** The user dismissed the picker. Not an error (DESIGN.md 17.1). */
export class FolderSelectionCancelled extends Error {
  constructor() {
    super('用户取消了文件夹选择')
    this.name = 'FolderSelectionCancelled'
  }
}

/** The browser refused or revoked read access to the chosen folder. */
export class FolderPermissionDenied extends Error {
  constructor(message = '目录读取权限被拒绝') {
    super(message)
    this.name = 'FolderPermissionDenied'
  }
}

export function detectDirectoryCapabilities(): DirectoryCapabilities {
  if (typeof window === 'undefined') {
    return { secureContext: false, supportsDirectoryPicker: false }
  }
  const secureContext = window.isSecureContext === true
  return {
    secureContext,
    // The picker only exists in a secure context, so an insecure page always
    // falls back to the directory input rather than pretending to be broken.
    supportsDirectoryPicker:
      secureContext && typeof window.showDirectoryPicker === 'function',
  }
}
