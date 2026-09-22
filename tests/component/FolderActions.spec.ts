import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import FolderActions from '@/components/toolbar/FolderActions.vue'
import { useFolderSourceStore } from '@/stores/folderSource'

/**
 * DESIGN.md 19.2: `FolderActions` 正确区分刷新和重新选择.
 *
 * The two buttons look similar and do opposite things: one re-reads the folder
 * the page already holds permission for, the other drops that permission and
 * opens the picker again. Offering refresh where the browser cannot honour it
 * would silently show a stale folder.
 */
const browser = vi.hoisted(() => ({
  capabilities: { secureContext: true, supportsDirectoryPicker: true },
}))

vi.mock('@/composables/useFolderSession', () => ({
  useFolderSession: () => ({
    session: { value: null },
    capabilities: { value: browser.capabilities },
    setSession: () => undefined,
    clearSession: () => undefined,
  }),
}))

const pinia = createPinia()

function mountActions(): VueWrapper {
  return mount(FolderActions, { global: { plugins: [pinia] } })
}

/** The refresh button, located by its label rather than by position. */
function buttonByText(wrapper: VueWrapper, label: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text() === label)
  if (button === undefined) throw new Error(`no button labelled ${label}`)
  return button
}

describe('FolderActions', () => {
  beforeEach(() => {
    setActivePinia(pinia)
    browser.capabilities = { secureContext: true, supportsDirectoryPicker: true }
    useFolderSourceStore().clear()
  })

  it('enables refresh only for a folder that can actually be re-read', async () => {
    const folderSource = useFolderSourceStore()
    folderSource.status = 'ready'
    folderSource.displayName = 'flows'
    folderSource.canRefresh = false

    const wrapper = mountActions()

    // `directory-input` mode hands over a `FileList` that cannot be read again.
    expect(buttonByText(wrapper, '刷新').attributes('disabled')).toBeDefined()
  })

  it('enables refresh while a re-readable folder is idle', async () => {
    const folderSource = useFolderSourceStore()
    folderSource.status = 'ready'
    folderSource.displayName = 'flows'
    folderSource.canRefresh = true

    const wrapper = mountActions()
    expect(buttonByText(wrapper, '刷新').attributes('disabled')).toBeUndefined()
  })

  it('blocks refresh while a scan is already running', async () => {
    const folderSource = useFolderSourceStore()
    folderSource.canRefresh = true
    folderSource.status = 'scanning'

    const wrapper = mountActions()
    expect(buttonByText(wrapper, '刷新').attributes('disabled')).toBeDefined()
  })

  it('re-reads the current folder on refresh, without reopening the picker', async () => {
    const folderSource = useFolderSourceStore()
    folderSource.status = 'ready'
    folderSource.displayName = 'flows'
    folderSource.canRefresh = true

    const refresh = vi.spyOn(folderSource, 'refresh').mockResolvedValue()
    const chooseAnother = vi.spyOn(folderSource, 'chooseAnotherFolder')

    const wrapper = mountActions()
    await buttonByText(wrapper, '刷新').trigger('click')

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(chooseAnother).not.toHaveBeenCalled()
  })

  it('drops the session and returns to the picker on 更换目录', async () => {
    const folderSource = useFolderSourceStore()
    folderSource.status = 'ready'
    folderSource.displayName = 'flows'

    const refresh = vi.spyOn(folderSource, 'refresh').mockResolvedValue()
    const chooseAnother = vi.spyOn(folderSource, 'chooseAnotherFolder')

    const wrapper = mountActions()
    await buttonByText(wrapper, '更换目录').trigger('click')

    expect(chooseAnother).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('explains why refresh is unavailable in fallback mode', async () => {
    const folderSource = useFolderSourceStore()
    folderSource.status = 'ready'
    folderSource.displayName = 'flows'
    folderSource.canRefresh = false

    const wrapper = mountActions()

    // The reason is attached to the disabled button rather than left to be
    // guessed, so it is read off the tooltip content — a disabled button fires
    // no hover, which is why the trigger is wrapped in a span.
    const contents = wrapper
      .findAllComponents({ name: 'ElTooltip' })
      .map((tooltip) => tooltip.props('content'))

    expect(contents).toContain('该浏览器使用一次性文件选择，请重新选择目录以刷新')
    expect(wrapper.find('.folder-actions__refresh-wrap').exists()).toBe(true)
  })

  it('marks the fallback mode without pretending the feature is missing', () => {
    browser.capabilities = { secureContext: true, supportsDirectoryPicker: false }
    const folderSource = useFolderSourceStore()
    folderSource.status = 'ready'
    folderSource.displayName = 'flows'
    folderSource.canRefresh = false

    const wrapper = mountActions()
    expect(wrapper.find('.folder-actions__mode').text()).toBe('兼容模式')
  })

  it('shows no folder name before one is chosen', () => {
    const wrapper = mountActions()

    expect(wrapper.find('.folder-actions__name').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('尚未选择')
  })
})
