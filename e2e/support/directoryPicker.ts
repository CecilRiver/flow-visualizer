import type { Page } from '@playwright/test'

/**
 * A mocked `showDirectoryPicker` (DESIGN.md 19.3).
 *
 * The real system picker cannot be driven by an automated test, and the
 * capability is a browser API rather than an application one — so it is the
 * boundary that gets mocked, not the application. Everything above it (the
 * handle walk, the limits, path normalisation, parsing, projection) is the real
 * code under test.
 *
 * The mock implements exactly the surface `directoryHandleReader` consumes:
 * `values()`, `name`, `kind`, `getFileHandle()` and the permission pair. It is
 * deliberately small — a mock that grew beyond the consumed surface would be
 * asserting against itself.
 */

export interface MockFile {
  name: string
  content: string
  /** Overrides the reported size, so the size limit can be probed cheaply. */
  size?: number
}

export interface MockDirectory {
  name: string
  files?: MockFile[]
  directories?: MockDirectory[]
}

/** How the picker behaves when the reader asks for a folder. */
export type PickerOutcome =
  | { kind: 'granted' }
  /** The reader dismissed the dialog: an `AbortError`, never an error state. */
  | { kind: 'cancelled' }
  /** The browser refused access: a `NotAllowedError`. */
  | { kind: 'denied' }

export interface PickerFolder {
  directory: MockDirectory
  outcome?: PickerOutcome
}

/**
 * Installs the mock. Each call to `showDirectoryPicker` consumes the next
 * folder in the list and the last one repeats, which is what lets a test pick
 * one folder and then "choose another" without re-installing anything.
 *
 * The tree is passed as plain data through `addInitScript`, so it has to stay
 * JSON-serialisable.
 */
export async function installDirectoryPickerMock(
  page: Page,
  folders: readonly PickerFolder[],
): Promise<void> {
  if (folders.length === 0) throw new Error('the picker mock needs at least one folder')

  await page.addInitScript((serialisedFolders: readonly PickerFolder[]) => {
    function makeAbortError(): DOMException {
      return new DOMException('The user aborted a request.', 'AbortError')
    }

    function makeNotAllowedError(): DOMException {
      return new DOMException('The request is not allowed.', 'NotAllowedError')
    }

    function buildFileHandle(file: MockFile, readCount: { value: number }): unknown {
      const handle = {
        kind: 'file',
        name: file.name,
        async getFile(): Promise<File> {
          readCount.value += 1
          const blob = new File([file.content], file.name, { type: 'text/yaml' })
          // `File.size` is derived from the content, so a reported size that
          // disagrees with it has to be redefined rather than overwritten.
          if (file.size !== undefined) {
            Object.defineProperty(blob, 'size', { value: file.size })
          }
          return blob
        },
      }
      return handle
    }

    function buildDirectoryHandle(directory: MockDirectory, readCount: { value: number }): unknown {
      const resolve = (name: string): MockFile | null =>
        (directory.files ?? []).find((file) => file.name === name) ?? null

      const handle = {
        kind: 'directory',
        name: directory.name,
        async queryPermission(): Promise<PermissionState> {
          return 'granted'
        },
        async requestPermission(): Promise<PermissionState> {
          return 'granted'
        },
        async getFileHandle(name: string): Promise<unknown> {
          const file = resolve(name)
          if (file === null) throw new DOMException(`${name} not found`, 'NotFoundError')
          return buildFileHandle(file, readCount)
        },
        async *values(): AsyncGenerator<unknown> {
          for (const file of directory.files ?? []) {
            yield buildFileHandle(file, readCount)
          }
          for (const child of directory.directories ?? []) {
            yield buildDirectoryHandle(child, readCount)
          }
        },
      }
      return handle
    }

    let call = 0
    // Shared across handles so a test can tell a re-read from a cached one.
    const readCount = { value: 0 }
    ;(window as unknown as Record<string, unknown>)['__flowReadCount'] = readCount

    ;(window as unknown as Record<string, unknown>)['showDirectoryPicker'] = async (
      _options?: { id?: string; mode?: string },
    ) => {
      const entry = serialisedFolders[Math.min(call, serialisedFolders.length - 1)]
      call += 1
      if (entry === undefined) throw makeAbortError()

      const outcome = entry.outcome ?? { kind: 'granted' }
      if (outcome.kind === 'cancelled') throw makeAbortError()
      if (outcome.kind === 'denied') throw makeNotAllowedError()

      return buildDirectoryHandle(entry.directory, readCount)
    }
  }, folders as readonly PickerFolder[])
}

/**
 * Removes `showDirectoryPicker` so the app takes the `<input webkitdirectory>`
 * path (DESIGN.md 19.3 path 1).
 */
export async function removeDirectoryPicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // The property lives on `window` itself in Chromium, so deleting it is
    // enough for `detectDirectoryCapabilities` to report the fallback.
    delete (window as unknown as Record<string, unknown>)['showDirectoryPicker']
  })
}

/** Number of times the mock served a file's contents. */
export async function readCount(page: Page): Promise<number> {
  return page.evaluate(
    () => ((window as unknown as Record<string, { value: number }>)['__flowReadCount']?.value ?? 0),
  )
}

/** A directory of `count` trivial YAML files, to push past the scan limit. */
export function oversizedDirectory(count: number, name = 'huge'): MockDirectory {
  return {
    name,
    files: Array.from({ length: count }, (_unused, index) => ({
      name: `flow-${String(index).padStart(4, '0')}.yaml`,
      content: 'schema_version: "0.1"\n',
    })),
  }
}
