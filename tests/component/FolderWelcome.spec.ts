import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import FolderWelcome from '@/components/welcome/FolderWelcome.vue'
import type { DirectoryCapabilities } from '@/filesystem/types'
import { useFolderSourceStore } from '@/stores/folderSource'

/**
 * DESIGN.md 19.2: `FolderWelcome` 在 capability 不同情况下选择正确适配器并显示隐私说明.
 *
 * Browser capabilities are read once by `useFolderSession()` and cached for the
 * life of the page, so the composable is mocked here rather than re-probing
 * `window` between tests. That is also the honest way to test it: the component
 * must pick its wording from the reported capabilities, not from the environment
 * the test happens to run in.
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

function setCapabilities(next: DirectoryCapabilities): void {
  browser.capabilities = next
}

function mountWelcome(): VueWrapper {
  return mount(FolderWelcome, { global: { plugins: [pinia] } })
}

describe('FolderWelcome', () => {
  beforeEach(() => {
    setActivePinia(pinia)
    setCapabilities({ secureContext: true, supportsDirectoryPicker: true })
    useFolderSourceStore().clear()
  })

  it('states what is read and that nothing leaves the browser', () => {
    const wrapper = mountWelcome()
    const text = wrapper.text()

    // DESIGN.md 12.1: the three facts a reader needs before handing over a
    // folder. They are the product's central promise, so they are asserted.
    expect(text).toContain('不上传、不修改、不写入')
    expect(text).toContain('文件内容不会离开本机')
    expect(text).toContain('0.1')
    expect(text).toContain('只读取所选目录中的 YAML 文件')
  })

  it('explains the fallback as a supported mode when the picker is missing', () => {
    setCapabilities({ secureContext: true, supportsDirectoryPicker: false })
    const wrapper = mountWelcome()

    expect(wrapper.text()).toContain('兼容目录选择')
    // The fallback is not a fault, and the page must not read as broken.
    expect(wrapper.text()).toContain('功能完整')
    expect(wrapper.find('.el-alert--warning').exists()).toBe(false)
  })

  it('says nothing about a fallback when the picker is available', () => {
    const wrapper = mountWelcome()

    expect(wrapper.text()).not.toContain('兼容目录选择')
  })

  it('warns when the page is not a secure context', () => {
    setCapabilities({ secureContext: false, supportsDirectoryPicker: false })
    const wrapper = mountWelcome()

    // The picker API simply does not exist outside a secure context, so the
    // reader has to be told why rather than left with a silently degraded page.
    expect(wrapper.text()).toContain('不是安全上下文')
    expect(wrapper.text()).toContain('localhost')
  })

  it('reports a refused permission as recoverable, not as a bad folder', () => {
    const folderSource = useFolderSourceStore()
    folderSource.status = 'denied'
    folderSource.errorMessage = '目录读取权限被拒绝'

    const wrapper = mountWelcome()

    expect(wrapper.text()).toContain('未获得目录读取权限')
    expect(wrapper.text()).toContain('目录读取权限被拒绝')
    expect(wrapper.find('.el-alert--error').exists()).toBe(false)
  })

  it('falls back to a generic hint when a denial carries no message', () => {
    const folderSource = useFolderSourceStore()
    folderSource.status = 'denied'

    const wrapper = mountWelcome()
    expect(wrapper.text()).toContain('可以重新选择目录以继续')
  })

  it('reports a failed read as an error with the message it was given', () => {
    const folderSource = useFolderSourceStore()
    folderSource.status = 'failed'
    folderSource.errorMessage = '目录中没有可读取的 YAML 文件。'

    const wrapper = mountWelcome()
    const alert = wrapper.find('.el-alert--error')

    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('目录中没有可读取的 YAML 文件。')
  })

  it('opens the picker from the button, once', async () => {
    const folderSource = useFolderSourceStore()
    const chooseFolder = vi.spyOn(folderSource, 'chooseFolder').mockResolvedValue()

    const wrapper = mountWelcome()
    await wrapper.find('button').trigger('click')

    // A user gesture is what the browser requires, so the button is the only
    // way in — nothing may call the picker on mount.
    expect(chooseFolder).toHaveBeenCalledTimes(1)
  })

  it('points at a flow folder, not at the ArduPilot source root', () => {
    const wrapper = mountWelcome()

    // The single most likely mistake a reader can make; DESIGN.md 12.1 asks for
    // it to be said on the first screen.
    expect(wrapper.text()).toContain('ArduPilot 源码根目录')
  })
})
