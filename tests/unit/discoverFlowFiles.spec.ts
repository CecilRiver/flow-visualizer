import { describe, expect, it } from 'vitest'

import { FILE_READ_CONCURRENCY } from '@/catalog/concurrency'
import {
  discoverFlowFiles,
  hasFlowModelSignature,
  type FlowCandidate,
} from '@/catalog/discoverFlowFiles'
import type { FolderFile } from '@/filesystem/types'

/** A flow model with all five signature keys at the top level. */
const SIGNATURE_TEXT = [
  'schema_version: "0.1"',
  'model:',
  '  id: model.demo',
  'components: []',
  'flows: []',
  'scenarios: []',
].join('\n')

interface FakeFile {
  file: FolderFile
  /** How many times the discovery layer had to read the file. */
  reads: () => number
}

function makeFile(relativePath: string, text: string): FakeFile {
  let reads = 0
  return {
    file: {
      relativePath,
      size: text.length,
      lastModified: 0,
      readText: async () => {
        reads += 1
        return text
      },
    },
    reads: () => reads,
  }
}

function pathsOf(candidates: readonly FlowCandidate[]): string[] {
  return candidates.map((candidate) => candidate.file.relativePath)
}

function candidateAt(candidates: readonly FlowCandidate[], index: number): FlowCandidate {
  const candidate = candidates[index]
  if (candidate === undefined) throw new Error(`缺少第 ${index} 个候选`)
  return candidate
}

describe('hasFlowModelSignature / 签名探测', () => {
  it('五个签名键齐全时为真，额外键不影响', () => {
    expect(hasFlowModelSignature(SIGNATURE_TEXT)).toBe(true)
    expect(hasFlowModelSignature(`${SIGNATURE_TEXT}\nrevision: 3\n`)).toBe(true)
  })

  it('缺少任意一个签名键都为假', () => {
    const lines: Record<string, string> = {
      schema_version: 'schema_version: "0.1"',
      model: 'model:\n  id: model.demo',
      components: 'components: []',
      flows: 'flows: []',
      scenarios: 'scenarios: []',
    }
    for (const missing of Object.keys(lines)) {
      const text = Object.entries(lines)
        .filter(([key]) => key !== missing)
        .map(([, line]) => line)
        .join('\n')
      expect(hasFlowModelSignature(text)).toBe(false)
    }
  })

  it('键只在顶层生效，嵌套出现不算签名', () => {
    const nested = [
      'schema_version: "0.1"',
      'model:',
      '  components: []',
      '  flows: []',
      '  scenarios: []',
    ].join('\n')
    expect(hasFlowModelSignature(nested)).toBe(false)
  })

  it('键名区分大小写', () => {
    expect(hasFlowModelSignature(SIGNATURE_TEXT.replace('schema_version', 'Schema_Version'))).toBe(
      false,
    )
  })

  it('非对象根节点、空文本和语法错误都是假', () => {
    expect(hasFlowModelSignature('')).toBe(false)
    expect(hasFlowModelSignature('just a string')).toBe(false)
    expect(hasFlowModelSignature('- schema_version\n- model\n')).toBe(false)
    // 语法错误时宁可当作无关 YAML，也不能让签名探测抛异常打断整次扫描。
    expect(hasFlowModelSignature('key: [unclosed')).toBe(false)
  })
})

describe('discoverFlowFiles / 强候选', () => {
  it('强候选直接入选，不预读文件，也不要求内容可解析', async () => {
    const direct = makeFile('stabilize.yaml', 'this: is: not: yaml: at: all: [')
    const underScenarios = makeFile('scenarios/auto-waypoint.yaml', 'key: [unclosed')
    const flowSuffix = makeFile('flows/mission.flow.yaml', 'key: [unclosed')
    const flowSuffixYml = makeFile('flows/mission.flow.yml', '')

    const result = await discoverFlowFiles([
      direct.file,
      underScenarios.file,
      flowSuffix.file,
      flowSuffixYml.file,
    ])

    expect(result.candidates.map((candidate) => candidate.kind)).toEqual([
      'strong',
      'strong',
      'strong',
      'strong',
    ])
    expect(pathsOf(result.candidates)).toEqual([
      'flows/mission.flow.yaml',
      'flows/mission.flow.yml',
      'scenarios/auto-waypoint.yaml',
      'stabilize.yaml',
    ])
    expect(result.ignoredCount).toBe(0)
    // DESIGN 6.3 规则 7：强候选即使 YAML 语法错误也必须报错，
    // 因此发现阶段不能靠“先解析一遍能不能读懂”来决定是否保留它。
    expect(direct.reads()).toBe(0)
    expect(underScenarios.reads()).toBe(0)
    expect(flowSuffix.reads()).toBe(0)
    expect(result.candidates.every((candidate) => candidate.text === undefined)).toBe(true)
  })
})

describe('discoverFlowFiles / 签名候选', () => {
  it('非强候选的 YAML 通过签名后入选，并缓存已读文本', async () => {
    const deep = makeFile('models/demo.yaml', SIGNATURE_TEXT)
    const deepYml = makeFile('models/other.yml', SIGNATURE_TEXT)

    const result = await discoverFlowFiles([deep.file, deepYml.file])

    expect(pathsOf(result.candidates)).toEqual(['models/demo.yaml', 'models/other.yml'])
    expect(result.candidates.map((candidate) => candidate.kind)).toEqual(['signature', 'signature'])
    expect(result.ignoredCount).toBe(0)
    // 探测时读到的文本要带回给 catalog，避免同一个文件被读第二遍。
    expect(candidateAt(result.candidates, 0).text).toBe(SIGNATURE_TEXT)
    expect(deep.reads()).toBe(1)
  })
})

describe('discoverFlowFiles / 无关 YAML', () => {
  it('没有签名或无法解析的 YAML 计入 ignored，不作为错误', async () => {
    const unrelated = makeFile('docs/readme.yaml', 'title: 说明\n')
    const partial = makeFile('docs/partial.yaml', 'schema_version: "0.1"\nmodel:\n  id: x\n')
    const listRoot = makeFile('docs/list.yaml', '- one\n- two\n')
    const broken = makeFile('docs/broken.yaml', 'key: [unclosed')
    const empty = makeFile('docs/empty.yaml', '')

    const result = await discoverFlowFiles([
      unrelated.file,
      partial.file,
      listRoot.file,
      broken.file,
      empty.file,
    ])

    expect(result.candidates).toEqual([])
    expect(result.ignoredCount).toBe(5)
    expect(unrelated.reads()).toBe(1)
  })

  it('读取失败的候选按忽略处理，不中断同目录下的其他文件', async () => {
    const unreadable: FolderFile = {
      relativePath: 'docs/unreadable.yaml',
      size: 0,
      lastModified: 0,
      readText: async () => {
        throw new Error('该文件已被删除')
      },
    }
    const readable = makeFile('models/demo.yaml', SIGNATURE_TEXT)

    const result = await discoverFlowFiles([unreadable, readable.file])

    expect(pathsOf(result.candidates)).toEqual(['models/demo.yaml'])
    expect(result.ignoredCount).toBe(1)
  })
})

describe('discoverFlowFiles / 稳定排序', () => {
  it('候选按相对路径字典序返回，与输入顺序无关', async () => {
    const result = await discoverFlowFiles([
      makeFile('scenarios/z.yaml', '').file,
      makeFile('b.yaml', '').file,
      makeFile('a.yaml', '').file,
      makeFile('flows/mission.flow.yaml', '').file,
      makeFile('models/demo.yaml', SIGNATURE_TEXT).file,
    ])

    expect(pathsOf(result.candidates)).toEqual([
      'a.yaml',
      'b.yaml',
      'flows/mission.flow.yaml',
      'models/demo.yaml',
      'scenarios/z.yaml',
    ])
  })

  it('读取完成顺序不同也不影响候选顺序', async () => {
    const gates: Array<() => void> = []
    const file = (relativePath: string, text: string): FolderFile => ({
      relativePath,
      size: text.length,
      lastModified: 0,
      readText: () => {
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })
        gates.push(release)
        return gate.then(() => text)
      },
    })

    const pending = discoverFlowFiles([
      file('m/a.yaml', SIGNATURE_TEXT),
      file('m/b.yaml', SIGNATURE_TEXT),
      file('m/c.yaml', SIGNATURE_TEXT),
    ])

    // 与发起顺序正好相反地放行读取：结果顺序必须仍由路径决定。
    for (const release of [...gates].reverse()) release()
    const result = await pending

    expect(pathsOf(result.candidates)).toEqual(['m/a.yaml', 'm/b.yaml', 'm/c.yaml'])
    expect(result.candidates.every((candidate) => candidate.kind === 'signature')).toBe(true)
  })

  it('签名探测的并发读取数不超过上限（DESIGN 6.5）', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const files: FolderFile[] = Array.from({ length: 20 }, (_, index) => ({
      relativePath: `docs/f${String(index).padStart(2, '0')}.yaml`,
      size: 16,
      lastModified: 0,
      readText: async () => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await Promise.resolve()
        inFlight -= 1
        return 'title: 无关文档'
      },
    }))

    const result = await discoverFlowFiles(files)

    expect(result.ignoredCount).toBe(20)
    expect(maxInFlight).toBeLessThanOrEqual(FILE_READ_CONCURRENCY)
    // 也确实并行过：串行实现会让这个断言失败。
    expect(maxInFlight).toBeGreaterThan(1)
  })
})

describe('discoverFlowFiles / 混合目录', () => {
  it('强候选、签名候选与无关 YAML 各归其位', async () => {
    const strong = makeFile('stabilize.yaml', SIGNATURE_TEXT)
    const signature = makeFile('models/demo.yaml', SIGNATURE_TEXT)
    const unrelated = makeFile('docs/readme.yaml', 'title: 说明\n')

    const result = await discoverFlowFiles([unrelated.file, signature.file, strong.file])

    expect(pathsOf(result.candidates)).toEqual(['models/demo.yaml', 'stabilize.yaml'])
    expect(result.candidates.map((candidate) => candidate.kind)).toEqual(['signature', 'strong'])
    expect(result.ignoredCount).toBe(1)
    // 强候选不预读；签名候选读一次并把文本带上。
    expect(strong.reads()).toBe(0)
    expect(signature.reads()).toBe(1)
  })
})
