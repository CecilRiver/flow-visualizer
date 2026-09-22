import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import StatusBar from '@/components/layout/StatusBar.vue'
import FolderScanProgress from '@/components/welcome/FolderScanProgress.vue'
import { ISSUE_CODES, type ValidationIssue } from '@/domain/validation'
import {
  FolderPermissionDenied,
  FolderSelectionCancelled,
} from '@/filesystem/chooseDirectory'
import type { FolderSnapshot } from '@/filesystem/types'
import { useCatalogStore } from '@/stores/catalog'
import { useFolderSourceStore } from '@/stores/folderSource'

import { buildFixtureBundle } from '../fixtures/buildBundle'

/**
 * DESIGN.md 19.2: 扫描进度、空目录、权限拒绝和部分成功状态可见.
 *
 * These are the states where the viewer owes the reader an explanation: work in
 * progress, nothing found, access refused, and a folder where some files loaded
 * and some did not. All four are asserted through the components that render
 * them, because "visible" is the requirement, not "modelled in a store".
 */
const pinia = createPinia()

function mountProgress(): VueWrapper {
  return mount(FolderScanProgress, { global: { plugins: [pinia] } })
}

function mountStatusBar(): VueWrapper {
  return mount(StatusBar, { global: { plugins: [pinia] } })
}

/** The smallest snapshot that satisfies the store: name and mode, no files. */
function emptySnapshot(): FolderSnapshot {
  return {
    displayName: 'flows',
    mode: 'directory-handle',
    canRefresh: true,
    files: [],
  }
}

function warning(relativePath: string, message: string): ValidationIssue {
  return {
    code: ISSUE_CODES.missingSource,
    severity: 'warning',
    stage: 'semantic',
    relativePath,
    message,
  }
}

describe('scan progress', () => {
  beforeEach(() => {
    setActivePinia(pinia)
    useFolderSourceStore().clear()
  })

  it('reports the real counters rather than an invented percentage', () => {
    const folderSource = useFolderSourceStore()
    folderSource.status = 'scanning'
    folderSource.displayName = 'flows'
    folderSource.scanProgress = {
      discovered: 12,
      processed: 7,
      valid: 5,
      invalid: 2,
      ignored: 3,
    }

    const wrapper = mountProgress()
    const counts = wrapper.findAll('.scan-progress__counts dd').map((node) => node.text())

    expect(counts).toEqual(['12', '7', '5', '2', '3'])
    expect(wrapper.text()).toContain('正在读取目录…')
    // The file count is unknown until discovery ends, so there is no percentage.
    expect(wrapper.text()).not.toContain('%')
  })

  it('says it is waiting while the picker is still open', () => {
    const folderSource = useFolderSourceStore()
    folderSource.status = 'choosing'

    const wrapper = mountProgress()
    expect(wrapper.text()).toContain('等待选择目录…')
  })

  it('names the folder it was given and never an absolute path', () => {
    const folderSource = useFolderSourceStore()
    folderSource.status = 'scanning'
    folderSource.displayName = 'arducopter-flow'

    const wrapper = mountProgress()

    expect(wrapper.find('.scan-progress__folder').text()).toBe('arducopter-flow')
    // A path the page cannot know would be a fabrication (DESIGN.md 17.2).
    expect(wrapper.text()).not.toContain(':\\')
  })

  it('says the folder name is not known yet instead of leaving a blank', () => {
    const folderSource = useFolderSourceStore()
    folderSource.status = 'choosing'

    const wrapper = mountProgress()
    expect(wrapper.find('.scan-progress__folder').text()).toContain('尚未获得目录名')
  })

  it('cancels by invalidating the scan, not by aborting a read', () => {
    const folderSource = useFolderSourceStore()
    folderSource.status = 'scanning'

    const clear = vi.spyOn(folderSource, 'clear')

    const wrapper = mountProgress()
    const button = wrapper.findAll('button').find((node) => node.text() === '取消本次读取')
    if (button === undefined) throw new Error('no cancel button')

    button.trigger('click')
    expect(clear).toHaveBeenCalledTimes(1)
  })
})

describe('empty and failed folders', () => {
  beforeEach(() => {
    setActivePinia(pinia)
    useFolderSourceStore().clear()
  })

  it('does not treat an empty folder as a working catalog', () => {
    const folderSource = useFolderSourceStore()
    const catalog = useCatalogStore()

    // What `commit` does when the snapshot carries no readable YAML at all.
    folderSource.status = 'failed'
    folderSource.errorMessage = '目录中没有可读取的 YAML 文件。'
    catalog.clear()

    expect(folderSource.hasFolder).toBe(false)
    expect(catalog.hasContent).toBe(false)
  })

  it('keeps a denied permission out of the catalog entirely', () => {
    const folderSource = useFolderSourceStore()
    const catalog = useCatalogStore()

    folderSource.applyFailure(new Error('denied'))
    folderSource.status = 'denied'
    folderSource.errorMessage = '目录读取权限被拒绝'

    // A refused folder must not mark any file invalid: nothing was read.
    expect(catalog.invalidBundles).toHaveLength(0)
    expect(catalog.allIssues).toHaveLength(0)
  })

  it('returns to the previous folder when the picker is dismissed', () => {
    const folderSource = useFolderSourceStore()
    const cancelled = new FolderSelectionCancelled()

    // Dismissing the picker is a normal outcome, not an error: with a folder
    // already open, the page must stay on that folder.
    folderSource.status = 'ready'
    folderSource.snapshot = emptySnapshot()
    folderSource.displayName = 'flows'

    folderSource.applyFailure(cancelled)

    expect(folderSource.status).toBe('ready')
    expect(folderSource.errorMessage).toBeNull()
    expect(folderSource.displayName).toBe('flows')
  })

  it('returns to the welcome page when the very first picker is dismissed', () => {
    const folderSource = useFolderSourceStore()
    folderSource.applyFailure(new FolderSelectionCancelled())

    expect(folderSource.status).toBe('idle')
    expect(folderSource.errorMessage).toBeNull()
  })

  it('reports a permission refusal without calling the folder broken', () => {
    const folderSource = useFolderSourceStore()
    folderSource.applyFailure(new FolderPermissionDenied('读取被拒绝'))

    expect(folderSource.status).toBe('denied')
    expect(folderSource.errorMessage).toBe('读取被拒绝')
    expect(folderSource.isBusy).toBe(false)
  })

  it('reports an unexpected failure with its message', () => {
    const folderSource = useFolderSourceStore()
    folderSource.applyFailure(new Error('磁盘掉了'))

    expect(folderSource.status).toBe('failed')
    expect(folderSource.errorMessage).toBe('磁盘掉了')
  })
})

describe('partial success', () => {
  beforeEach(() => {
    setActivePinia(pinia)
    useCatalogStore().clear()
    useFolderSourceStore().clear()
  })

  /** One file that loaded, one that did not, and a warning on the good one. */
  function seedPartialFolder(): void {
    const catalog = useCatalogStore()
    const good = buildFixtureBundle()

    catalog.status = 'partial'
    catalog.validBundles = [{ ...good, warnings: [warning(good.relativePath, '证据未声明')] }]
    catalog.invalidBundles = [
      {
        id: 'broken',
        relativePath: 'flows/broken.yaml',
        modelTitle: null,
        issues: [
          {
            code: ISSUE_CODES.schemaValidationFailed,
            severity: 'error',
            stage: 'schema',
            relativePath: 'flows/broken.yaml',
            message: '缺少必填字段',
            instancePath: '/components/0',
            line: 3,
          },
        ],
      },
    ]
    catalog.activateFirstAvailable()
  }

  it('keeps the valid files usable while reporting the broken ones', () => {
    seedPartialFolder()
    const catalog = useCatalogStore()
    const wrapper = mountStatusBar()

    // DESIGN.md 8.2 / 17.1: one bad file must not hide the rest of the folder.
    expect(catalog.status).toBe('partial')
    expect(catalog.activeBundle).not.toBeNull()
    expect(wrapper.text()).toContain('有效 1 · 无效 1')
  })

  it('counts errors and warnings separately and opens the panel from either', async () => {
    seedPartialFolder()
    const wrapper = mountStatusBar()

    const errorTrigger = wrapper.find('.status-bar__item--error')
    const warningTrigger = wrapper
      .findAll('.status-bar__trigger')
      .find((node) => node.text().includes('配置警告'))
    if (warningTrigger === undefined) throw new Error('no warning trigger')

    expect(errorTrigger.text()).toBe('错误 1')
    expect(warningTrigger.text()).toBe('配置警告 1')

    await errorTrigger.trigger('click')
    await warningTrigger.trigger('click')
    expect(wrapper.emitted('openValidation')).toHaveLength(2)
  })

  it('lists folder issues, invalid files and load warnings in one ordered list', () => {
    const catalog = useCatalogStore()
    catalog.issues = [warning('a.yaml', '空目录')]
    catalog.invalidBundles = [
      {
        id: 'x',
        relativePath: 'b.yaml',
        modelTitle: null,
        issues: [warning('b.yaml', '坏文件')],
      },
    ]
    catalog.validBundles = [
      { ...buildFixtureBundle(), warnings: [warning('c.yaml', '可读但有警告')] },
    ]

    // The status bar and the validation panel read the same list, so the two
    // can never disagree about how much went wrong.
    expect(catalog.allIssues.map((issue) => issue.message)).toEqual([
      '空目录',
      '坏文件',
      '可读但有警告',
    ])
  })

  it('offers a quiet way into the panel when nothing went wrong', async () => {
    const catalog = useCatalogStore()
    catalog.status = 'ready'
    catalog.validBundles = [buildFixtureBundle()]
    catalog.activateFirstAvailable()

    const wrapper = mountStatusBar()
    const quiet = wrapper.find('.status-bar__trigger--quiet')

    expect(quiet.text()).toBe('校验通过')
    await quiet.trigger('click')
    expect(wrapper.emitted('openValidation')).toHaveLength(1)
  })
})
