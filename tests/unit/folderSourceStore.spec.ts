import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ValidationIssue } from '@/domain/validation'
import { useFolderSourceStore } from '@/stores/folderSource'

/**
 * Why a refused scan says what it says (DESIGN.md 6.3, 16.3).
 *
 * A scan that returns no snapshot is refused, and the welcome page shows
 * exactly one message explaining that. When the folder carried warnings from
 * before the refusal — a file too large, a file that could not be read — the
 * first issue in the list is one of those, and leading with it would tell the
 * reader that a skipped file is why the folder came back empty. The limit that
 * actually ended the scan is appended last and would never be shown.
 *
 * These tests pin the selection rule, not the copy: the messages are the
 * fixture's own strings.
 */

function issue(severity: ValidationIssue['severity'], message: string): ValidationIssue {
  return {
    code: 'TEST',
    severity,
    stage: 'filesystem',
    relativePath: 'huge',
    message,
  }
}

const LIMIT_MESSAGE =
  '所选目录超过扫描上限（最多 500 个文件、50 MiB YAML）。' +
  '请改为选择 flow 提取结果目录，而不是源码仓库根目录。'

/** A scan that produced no snapshot, which is what makes a scan a refusal. */
async function refuse(issues: readonly ValidationIssue[]): Promise<string | null> {
  const store = useFolderSourceStore()
  await store.commit(store.beginScan(), {
    mode: 'directory-handle',
    displayName: 'huge',
    snapshot: null,
    issues,
  })
  return store.errorMessage
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('目录被拒绝时的说明', () => {
  it('只有上限问题时，显示上限问题', async () => {
    expect(await refuse([issue('error', LIMIT_MESSAGE)])).toBe(LIMIT_MESSAGE)
  })

  it('先有跳过文件的警告时，仍然显示真正终止扫描的上限问题', async () => {
    const message = await refuse([
      issue('warning', '文件超过 5 MiB 上限，已跳过。'),
      issue('warning', '目录深度超过 8 层，已跳过。'),
      issue('error', LIMIT_MESSAGE),
    ])

    expect(message).toBe(LIMIT_MESSAGE)
    expect(message).not.toContain('已跳过')
  })

  it('没有任何问题时，说明目录里没有可读取的 YAML', async () => {
    expect(await refuse([])).toBe('目录中没有可读取的 YAML 文件。')
  })
})
