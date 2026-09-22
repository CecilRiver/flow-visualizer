/**
 * Missing pieces of the File System Access API.
 *
 * TypeScript's DOM library ships the handle interfaces but not the directory
 * picker entry point, the async directory iterator, or the permission queries.
 * Only read-only members are declared here on purpose: the viewer must never
 * be able to reach a write API through these augmentations.
 */
export {}

declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite'
  }

  interface FileSystemHandle {
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  }

  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>
    entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>
    keys(): AsyncIterableIterator<string>
  }

  interface DirectoryPickerOptions {
    id?: string
    mode?: 'read' | 'readwrite'
    startIn?: FileSystemHandle | string
  }

  interface Window {
    showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>
  }
}
