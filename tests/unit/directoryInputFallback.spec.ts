import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ISSUE_CODES } from '@/domain/validation'
import {
  deriveRootName,
  filesToSnapshot,
  pickFilesViaInput,
  relativePathFrom,
} from '@/filesystem/directoryInputFallback'
import { FOLDER_LIMITS } from '@/filesystem/pathPolicy'
import type { FolderFile } from '@/filesystem/types'

const MIB = 1024 * 1024

/**
 * Builds a `File` that reports the `webkitRelativePath` a folder input would
 * have produced. The property is read-only on `File.prototype`, so it is
 * shadowed with an own property instead of being cast away.
 */
function makeFile(webkitRelativePath: string, content = '', size?: number): File {
  const name = webkitRelativePath.replace(/\\/g, '/').split('/').pop() ?? ''
  const file = new File([content], name, { lastModified: 0 })
  Object.defineProperty(file, 'webkitRelativePath', { value: webkitRelativePath, configurable: true })
  // jsdom 没有实现 Blob.text()（真实浏览器上 File 自带），补一个等价实现，
  // 这样 readText 的去向仍然是被测试的契约而不是环境的缺口。
  Object.defineProperty(file, 'text', { value: async () => content, configurable: true })
  if (size !== undefined) {
    // Lets the size limits be tested without allocating megabytes of text.
    Object.defineProperty(file, 'size', { value: size, configurable: true })
  }
  return file
}

function snapshotOf(outcome: ReturnType<typeof filesToSnapshot>) {
  const { snapshot } = outcome
  if (snapshot === null) throw new Error('期望得到快照，实际因超限被丢弃')
  return snapshot
}

function relativePathsOf(files: readonly FolderFile[]): string[] {
  return files.map((file) => file.relativePath)
}

/** The input the adapter keeps in the DOM until the picker settles. */
function pendingInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('未找到尚未结算的文件选择 input')
  return input
}

/** Installs a `FileList` on the input, the only way a real picker fills it. */
function setFiles(input: HTMLInputElement, files: readonly File[]): void {
  const list = Object.assign({ length: files.length, item: (index: number) => files[index] ?? null }, files)
  Object.defineProperty(input, 'files', { value: list, configurable: true })
}

function fileNamesOf(list: FileList | null): string[] {
  return Array.from(list ?? []).map((file) => file.name)
}

beforeEach(() => {
  // jsdom 不会弹对话框；显式 mock 掉 click，让用例只关注适配器自己的状态机。
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('relativePathFrom / webkitRelativePath 解析', () => {
  it('去掉所选目录那一段，得到目录内的相对路径', () => {
    expect(relativePathFrom('my-flows/stabilize.yaml')).toBe('stabilize.yaml')
    expect(relativePathFrom('my-flows/scenarios/auto-waypoint.yaml')).toBe(
      'scenarios/auto-waypoint.yaml',
    )
  })

  it('反斜杠分隔同样处理（Windows 浏览器会给出反斜杠）', () => {
    expect(relativePathFrom('my-flows\\scenarios\\auto.yaml')).toBe('scenarios/auto.yaml')
  })

  it('没有根目录段时返回 null：无法确定相对路径', () => {
    expect(relativePathFrom('stabilize.yaml')).toBeNull()
    expect(relativePathFrom('')).toBeNull()
    expect(relativePathFrom('/')).toBeNull()
    // 只剩根目录名，没有文件名。
    expect(relativePathFrom('my-flows/')).toBeNull()
  })

  it('跳过目录下的文件返回 null（DESIGN 6.3 规则 2）', () => {
    expect(relativePathFrom('root/.git/config.yaml')).toBeNull()
    expect(relativePathFrom('root/node_modules/pkg/a.yaml')).toBeNull()
    expect(relativePathFrom('root/dist/a.yaml')).toBeNull()
    expect(relativePathFrom('root/coverage/a.yaml')).toBeNull()
    expect(relativePathFrom('root/.vscode/a.yaml')).toBeNull()
  })

  it('含 .. 的路径返回 null', () => {
    expect(relativePathFrom('root/../escape.yaml')).toBeNull()
    expect(relativePathFrom('root/scenarios/../../escape.yaml')).toBeNull()
  })

  it('名字相近的目录不会被误跳过', () => {
    expect(relativePathFrom('root/distance/a.yaml')).toBe('distance/a.yaml')
    expect(relativePathFrom('root/node_modules_backup/a.yaml')).toBe('node_modules_backup/a.yaml')
  })

  it('末尾一段是文件名，不做目录跳过', () => {
    // DESIGN 6.3 要求跳过的是隐藏目录；`.hidden.yaml` 是文件。
    expect(relativePathFrom('root/.hidden.yaml')).toBe('.hidden.yaml')
  })
})

describe('deriveRootName / 目录显示名', () => {
  it('取根目录段作为显示名', () => {
    expect(deriveRootName([makeFile('my-flows/a.yaml'), makeFile('my-flows/b.yaml')])).toBe(
      'my-flows',
    )
  })

  it('空列表返回空字符串', () => {
    expect(deriveRootName([])).toBe('')
  })

  it('webkitRelativePath 为空时返回空字符串', () => {
    // 拿不到绝对路径时显示名退回空字符串，UI 不能再拼出目录位置。
    expect(deriveRootName([makeFile('')])).toBe('')
  })

  it('没有目录前缀时返回第一段本身', () => {
    // 这种输入在真实 FileList 里不会出现（webkitdirectory 总是带根目录），
    // 这里固定住纯函数的退化行为。
    expect(deriveRootName([makeFile('a.yaml')])).toBe('a.yaml')
  })
})

describe('filesToSnapshot / 快照构建', () => {
  it('按相对路径排序，并标记 directory-input 不可刷新', async () => {
    const outcome = filesToSnapshot([
      makeFile('my-flows/scenarios/z.yaml'),
      makeFile('my-flows/stabilize.yaml'),
      makeFile('my-flows/scenarios/a.yaml'),
    ])
    const snapshot = snapshotOf(outcome)

    expect(snapshot.displayName).toBe('my-flows')
    expect(snapshot.mode).toBe('directory-input')
    // FileList 是一次性快照：源文件变化后必须让用户重新选择文件夹。
    expect(snapshot.canRefresh).toBe(false)
    expect(relativePathsOf(snapshot.files)).toEqual([
      'scenarios/a.yaml',
      'scenarios/z.yaml',
      'stabilize.yaml',
    ])
    expect(outcome.issues).toEqual([])
  })

  it('readText 直接读取原 File，并保留大小与修改时间', async () => {
    const file = makeFile('my-flows/flow.yaml', 'schema_version: "0.1"')
    const snapshot = snapshotOf(filesToSnapshot([file]))

    const entry = snapshot.files[0]
    if (entry === undefined) throw new Error('缺少文件条目')
    await expect(entry.readText()).resolves.toBe('schema_version: "0.1"')
    expect(entry.size).toBe(file.size)
    expect(entry.lastModified).toBe(file.lastModified)
  })

  it('非 YAML 文件不进入快照（DESIGN 6.3 规则 3）', () => {
    const snapshot = snapshotOf(
      filesToSnapshot([
        makeFile('my-flows/README.md', '# 说明'),
        makeFile('my-flows/package.json', '{}'),
        makeFile('my-flows/flow.yaml', ''),
        makeFile('my-flows/notes.yaml.bak', ''),
      ]),
    )

    expect(relativePathsOf(snapshot.files)).toEqual(['flow.yaml'])
  })

  it('跳过目录中的文件既不进入快照也不产生噪音', () => {
    const outcome = filesToSnapshot([
      makeFile('my-flows/.git/config.yaml'),
      makeFile('my-flows/node_modules/pkg/flow.yaml'),
      makeFile('my-flows/flow.yaml', ''),
    ])

    expect(relativePathsOf(snapshotOf(outcome).files)).toEqual(['flow.yaml'])
    expect(outcome.issues).toEqual([])
  })
})

describe('filesToSnapshot / 深度限制', () => {
  it('恰好 8 层保留，第 9 层跳过并给出 PATH_TOO_DEEP 警告', () => {
    const atLimit = `my-flows/${['a', 'b', 'c', 'd', 'e', 'f', 'g', 'flow.yaml'].join('/')}`
    const overLimit = `my-flows/${['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'flow.yaml'].join('/')}`
    const outcome = filesToSnapshot([makeFile(atLimit, ''), makeFile(overLimit, '')])

    expect(relativePathsOf(snapshotOf(outcome).files)).toEqual([
      'a/b/c/d/e/f/g/flow.yaml',
    ])

    const warning = outcome.issues.find((issue) => issue.code === ISSUE_CODES.pathTooDeep)
    expect(warning?.severity).toBe('warning')
    expect(warning?.stage).toBe('filesystem')
    expect(warning?.relativePath).toBe('a/b/c/d/e/f/g/h/flow.yaml')
  })
})

describe('filesToSnapshot / 单文件大小限制', () => {
  it('恰好 5 MiB 保留，超出 1 字节跳过并给出 FILE_TOO_LARGE 警告', () => {
    const atLimit = makeFile('my-flows/exact.yaml', '', FOLDER_LIMITS.maxFileBytes)
    const overLimit = makeFile('my-flows/big.yaml', '', FOLDER_LIMITS.maxFileBytes + 1)
    const outcome = filesToSnapshot([atLimit, overLimit])

    expect(relativePathsOf(snapshotOf(outcome).files)).toEqual(['exact.yaml'])

    const warning = outcome.issues.find((issue) => issue.code === ISSUE_CODES.fileTooLarge)
    expect(warning?.severity).toBe('warning')
    expect(warning?.stage).toBe('filesystem')
    expect(warning?.relativePath).toBe('big.yaml')
  })

  it('被跳过的超大文件不计入 YAML 总量', () => {
    // 两个 6 MiB 文件若都计数会直接撑爆 50 MiB 总量；它们都被单文件上限挡下，
    // 因此剩下的合法文件仍然可以被扫描。
    const outcome = filesToSnapshot([
      makeFile('my-flows/big-a.yaml', '', 6 * MIB),
      makeFile('my-flows/big-b.yaml', '', 6 * MIB),
      makeFile('my-flows/flow.yaml', '', 1024),
    ])

    expect(relativePathsOf(snapshotOf(outcome).files)).toEqual(['flow.yaml'])
  })
})

describe('filesToSnapshot / 总量与枚举上限', () => {
  it('YAML 总量恰好 50 MiB 保留，超出后整份快照作废', () => {
    const exactly = Array.from({ length: 10 }, (_, index) =>
      makeFile(`my-flows/part-${index}.yaml`, '', FOLDER_LIMITS.maxFileBytes),
    )
    expect(snapshotOf(filesToSnapshot(exactly)).files).toHaveLength(10)

    const overflowing = Array.from({ length: 11 }, (_, index) =>
      makeFile(`my-flows/part-${index}.yaml`, '', FOLDER_LIMITS.maxFileBytes),
    )
    const outcome = filesToSnapshot(overflowing)

    // 超限时不能返回半份快照，否则 UI 会拿截断的扫描结果当完整目录。
    expect(outcome.snapshot).toBeNull()
    const error = outcome.issues.find((issue) => issue.code === ISSUE_CODES.folderLimitExceeded)
    expect(error?.severity).toBe('error')
    expect(error?.stage).toBe('filesystem')
    expect(error?.relativePath).toBe('my-flows')
  })

  it('枚举文件数超过 500 时整份快照作废，并保留此前的警告', () => {
    const tooDeep = makeFile(`my-flows/${['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'flow.yaml'].join('/')}`, '')
    const yamlFiles = Array.from({ length: 500 }, (_, index) =>
      makeFile(`my-flows/f${String(index).padStart(3, '0')}.yaml`, ''),
    )
    const outcome = filesToSnapshot([tooDeep, ...yamlFiles])

    expect(outcome.snapshot).toBeNull()
    expect(outcome.issues.some((issue) => issue.code === ISSUE_CODES.pathTooDeep)).toBe(true)
    expect(outcome.issues.some((issue) => issue.code === ISSUE_CODES.folderLimitExceeded)).toBe(true)
  })

  it('恰好 500 个文件仍然可用', () => {
    const files = Array.from({ length: FOLDER_LIMITS.maxFiles }, (_, index) =>
      makeFile(`my-flows/f${String(index).padStart(3, '0')}.yaml`, ''),
    )
    expect(snapshotOf(filesToSnapshot(files)).files).toHaveLength(FOLDER_LIMITS.maxFiles)
  })

  it('上限按枚举到的文件总数计算，非 YAML 也占名额', () => {
    const docs = Array.from({ length: FOLDER_LIMITS.maxFiles }, (_, index) =>
      makeFile(`my-flows/doc${String(index).padStart(3, '0')}.md`, '# 文档'),
    )
    const outcome = filesToSnapshot([makeFile('my-flows/flow.yaml', ''), ...docs])

    expect(outcome.snapshot).toBeNull()
    expect(outcome.issues.some((issue) => issue.code === ISSUE_CODES.folderLimitExceeded)).toBe(true)
  })
})

describe('pickFilesViaInput / 文件对话框', () => {
  it('只接受 YAML 且使用 webkitdirectory，input 不进入页面布局', async () => {
    const pending = pickFilesViaInput()
    const input = pendingInput()

    expect(input.type).toBe('file')
    expect(input.multiple).toBe(true)
    expect(input.accept).toBe('.yaml,.yml')
    expect(input.hasAttribute('webkitdirectory')).toBe(true)
    expect(input.style.display).toBe('none')

    setFiles(input, [makeFile('my-flows/flow.yaml')])
    input.dispatchEvent(new Event('change'))
    await pending
  })

  it('选择文件后以 change 事件携带的列表结算，并清理 input', async () => {
    const pending = pickFilesViaInput()
    const input = pendingInput()

    setFiles(input, [makeFile('my-flows/scenarios/a.yaml'), makeFile('my-flows/flow.yaml')])
    input.dispatchEvent(new Event('change'))

    expect(fileNamesOf(await pending)).toEqual(['a.yaml', 'flow.yaml'])
    expect(input.isConnected).toBe(false)
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it('用户取消时以 null 结算，且不产生校验错误', async () => {
    vi.useFakeTimers()
    const pending = pickFilesViaInput()
    const input = pendingInput()

    // 对话框没有 change 事件，关闭后焦点回到页面。
    window.dispatchEvent(new Event('focus'))
    // 留出 300ms 给可能同帧到达的 change 事件。
    await vi.advanceTimersByTimeAsync(300)

    await expect(pending).resolves.toBeNull()
    expect(input.isConnected).toBe(false)
  })

  it('change 在竞态窗口内到达时以所选文件为准', async () => {
    vi.useFakeTimers()
    const pending = pickFilesViaInput()
    const input = pendingInput()

    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(100)
    setFiles(input, [makeFile('my-flows/flow.yaml')])
    input.dispatchEvent(new Event('change'))
    // 焦点计时器仍会到点，但结果已经结算，不能覆盖已选中的文件。
    await vi.advanceTimersByTimeAsync(500)

    expect(fileNamesOf(await pending)).toEqual(['flow.yaml'])
  })

  it('结算后再次调用是全新的选择：directory-input 没有刷新', async () => {
    const first = pickFilesViaInput()
    const firstInput = pendingInput()
    setFiles(firstInput, [makeFile('first/flow.yaml')])
    firstInput.dispatchEvent(new Event('change'))
    expect(fileNamesOf(await first)).toEqual(['flow.yaml'])

    const second = pickFilesViaInput()
    const secondInput = pendingInput()
    expect(secondInput).not.toBe(firstInput)
    setFiles(secondInput, [makeFile('second/stabilize.yaml')])
    secondInput.dispatchEvent(new Event('change'))

    expect(fileNamesOf(await second)).toEqual(['stabilize.yaml'])
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })
})
