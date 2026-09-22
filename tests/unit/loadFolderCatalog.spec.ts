import { describe, expect, it } from 'vitest'
import { stringify } from 'yaml'

import { loadFolderCatalog, type CatalogProgress, type LoadedCatalog } from '@/catalog/loadFolderCatalog'
import type { Component, FlowModelV01 } from '@/domain/model'
import { ISSUE_CODES } from '@/domain/validation'
import type { FolderFile, FolderSnapshot } from '@/filesystem/types'

import { makeComponent, makeFlow, makeModel, makeScenario, makeSource, withPorts } from '../fixtures/buildModel'

/**
 * Folder-level loading (DESIGN.md 6.1, 6.5, 6.6).
 *
 * The snapshot is built in memory from synthetic YAML text, following
 * `realModel.spec.ts`: the point is the behaviour of the pipeline, not of the
 * filesystem, and no test may depend on a folder being checked out beside the
 * viewer.
 *
 * The documents are produced by serialising the fixture builders rather than
 * by hand-writing YAML, so that a Schema change shows up as a fixture error and
 * not as a silently different document.
 */

const SOURCE_ID = 'source.test'
const CONTRACT_ID = 'data.test'
const REVISION = '0123456789abcdef0123456789abcdef01234567'

function l2Component(id: string, parentId: string): Component {
  return {
    ...withPorts(makeComponent({ id, level: 2, parent_id: parentId }), [CONTRACT_ID]),
    implementation: [{ source_id: SOURCE_ID, role: 'primary' }],
    evidence: [{ source_id: SOURCE_ID, support: 'direct', claim: `${id} claim` }],
  }
}

/** A minimal model that passes Schema validation and the semantic checks. */
function validModel(id: string): FlowModelV01 {
  const components = [
    makeComponent({ id: 'system.ac', level: 0, kind: 'system' }),
    makeComponent({
      id: 'domain.control',
      level: 1,
      kind: 'capability_domain',
      parent_id: 'system.ac',
    }),
    l2Component('l2.attitude', 'domain.control'),
    l2Component('l2.rate', 'domain.control'),
  ]
  const flows = [makeFlow({ id: 'flow.attitude_rate', from: 'l2.attitude', to: 'l2.rate' })]
  const scenarios = [
    makeScenario({
      id: 'scenario.test',
      component_ids: components.map((component) => component.id),
      flow_ids: flows.map((flow) => flow.id),
    }),
  ]

  return makeModel({
    id,
    revision: REVISION,
    sources: [makeSource(SOURCE_ID, { revision: REVISION })],
    components,
    flows,
    scenarios,
  })
}

function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected an object')
  }
  return value as Record<string, unknown>
}

function recordAt(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  return recordOf(parent[key])
}

function arrayAt(parent: Record<string, unknown>, key: string): unknown[] {
  const child = parent[key]
  if (!Array.isArray(child)) throw new Error(`expected an array at ${key}`)
  return child
}

/** Serialises a valid model, optionally after a single mutation. */
function modelText(id: string, mutate?: (document: Record<string, unknown>) => void): string {
  const document = recordOf(JSON.parse(JSON.stringify(validModel(id))) as unknown)
  mutate?.(document)
  return stringify(document)
}

function textFile(relativePath: string, text: string): FolderFile {
  return {
    relativePath,
    size: text.length,
    lastModified: 0,
    readText: async () => text,
  }
}

function unreadableFile(relativePath: string): FolderFile {
  return {
    relativePath,
    size: 0,
    lastModified: 0,
    readText: async () => {
      throw new Error('EACCES: permission denied')
    },
  }
}

function snapshotOf(files: readonly FolderFile[], displayName = 'flows'): FolderSnapshot {
  return { displayName, mode: 'directory-input', canRefresh: false, files }
}

interface LoadOptions {
  isCurrent?: () => boolean
  onProgress?: (progress: CatalogProgress) => void
  discovered?: number
}

async function load(
  files: readonly FolderFile[],
  options: LoadOptions = {},
): Promise<LoadedCatalog> {
  const catalog = await loadFolderCatalog({
    snapshot: snapshotOf(files),
    scanId: 7,
    ...options,
  })
  if (catalog === null) throw new Error('catalog result was discarded')
  return catalog
}

describe('loadFolderCatalog / 全部有效', () => {
  it('每个合法文件都变成可用 bundle，状态为 ready', async () => {
    const catalog = await load([
      textFile('scenarios/alpha.yaml', modelText('alpha.model.v0_1')),
      textFile('scenarios/beta.yaml', modelText('beta.model.v0_1')),
    ])

    expect(catalog.scanId).toBe(7)
    expect(catalog.status).toBe('ready')
    expect(catalog.validBundles.map((bundle) => bundle.id).sort()).toEqual([
      'alpha.model.v0_1',
      'beta.model.v0_1',
    ])
    expect(catalog.invalidBundles).toEqual([])
    expect(catalog.issues).toEqual([])
    expect(catalog.progress).toEqual({
      discovered: 2,
      processed: 2,
      valid: 2,
      invalid: 0,
      ignored: 0,
    })

    const bundle = catalog.validBundles[0]
    expect(bundle?.schemaVersion).toBe('0.1')
    expect(bundle?.relativePath).toBe('scenarios/alpha.yaml')
    expect(bundle?.warnings).toEqual([])
    // A valid bundle carries the lookup indexes the graph needs.
    expect(bundle?.index.componentsById.size).toBe(4)
    expect(bundle?.index.flowsById.size).toBe(1)
  })

  it('已枚举数量可以来自扫描层而不是文件列表长度', async () => {
    const catalog = await load([textFile('scenarios/alpha.yaml', modelText('alpha.model.v0_1'))], {
      discovered: 99,
    })

    expect(catalog.progress.discovered).toBe(99)
  })

  it('YAML warning 随 bundle 一起保留，而不是让文件无效', async () => {
    // The `%YAML 1.3` directive is a warning in the parser, so the model is
    // still loadable; losing the warning would hide it from the panel.
    const catalog = await load([
      textFile(
        'scenarios/alpha.yaml',
        `%YAML 1.3\n---\n${modelText('alpha.model.v0_1')}`,
      ),
    ])

    expect(catalog.status).toBe('ready')
    expect(catalog.validBundles[0]?.warnings).toHaveLength(1)
    expect(catalog.validBundles[0]?.warnings[0]?.code).toBe(ISSUE_CODES.yamlSyntaxError)
    expect(catalog.validBundles[0]?.warnings[0]?.severity).toBe('warning')
  })

  it('进度回调按文件递增，最后一次快照就是返回的进度', async () => {
    const snapshots: CatalogProgress[] = []
    const catalog = await load(
      [
        textFile('scenarios/alpha.yaml', modelText('alpha.model.v0_1')),
        textFile('scenarios/beta.yaml', modelText('beta.model.v0_1')),
      ],
      { onProgress: (progress) => snapshots.push({ ...progress }) },
    )

    expect(snapshots.length).toBeGreaterThanOrEqual(2)
    expect(snapshots.at(-1)).toEqual(catalog.progress)
    expect(snapshots.at(-1)?.processed).toBe(2)
    // Progress is monotonic: a processed file is never counted twice.
    for (const snapshot of snapshots) {
      expect(snapshot.processed).toBeLessThanOrEqual(2)
      expect(snapshot.valid + snapshot.invalid).toBe(snapshot.processed)
    }
  })
})

describe('loadFolderCatalog / 部分成功', () => {
  it('一个文件坏掉不影响其他文件，状态为 partial', async () => {
    const catalog = await load([
      textFile('scenarios/broken.yaml', 'model:\n  id: alpha\n  id: beta\n'),
      textFile('scenarios/alpha.yaml', modelText('alpha.model.v0_1')),
    ])

    expect(catalog.status).toBe('partial')
    expect(catalog.validBundles.map((bundle) => bundle.id)).toEqual(['alpha.model.v0_1'])
    // Folder-level issues stay empty: the folder itself is fine.
    expect(catalog.issues).toEqual([])

    expect(catalog.invalidBundles).toHaveLength(1)
    const summary = catalog.invalidBundles[0]
    expect(summary?.relativePath).toBe('scenarios/broken.yaml')
    expect(summary?.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.yamlSyntaxError)
    // Nothing identified the model, so the path stands in as the id.
    expect(summary?.id).toBe('scenarios/broken.yaml')
    expect(catalog.progress).toEqual({
      discovered: 2,
      processed: 2,
      valid: 1,
      invalid: 1,
      ignored: 0,
    })
  })

  it('Schema 错误带上源文件行列，并按 instancePath 归属', async () => {
    const catalog = await load([
      textFile(
        'scenarios/bad.yaml',
        modelText('bad.model.v0_1', (document) => {
          recordAt(document, 'model')['review_status'] = 'approved'
        }),
      ),
    ])

    expect(catalog.status).toBe('invalid')
    const issue = catalog.invalidBundles[0]?.issues[0]
    expect(issue?.code).toBe(ISSUE_CODES.schemaValidationFailed)
    expect(issue?.instancePath).toBe('/model/review_status')
    // `locateIssues` resolves the pointer back to the YAML line.
    expect(issue?.line).toBeGreaterThan(0)
    expect(issue?.column).toBeGreaterThan(0)
  })

  it('语义错误让文件无效，但不影响其他 bundle', async () => {
    const catalog = await load([
      textFile(
        'scenarios/semantic.yaml',
        modelText('semantic.model.v0_1', (document) => {
          const flow = recordOf(arrayAt(document, 'flows')[0])
          flow['data_contract_id'] = 'data.ghost'
        }),
      ),
      textFile('scenarios/alpha.yaml', modelText('alpha.model.v0_1')),
    ])

    expect(catalog.status).toBe('partial')
    expect(catalog.validBundles.map((bundle) => bundle.id)).toEqual(['alpha.model.v0_1'])
    const summary = catalog.invalidBundles[0]
    expect(summary?.relativePath).toBe('scenarios/semantic.yaml')
    // The document passed the Schema, so the failure is the semantic layer's.
    expect(summary?.issues.some((issue) => issue.stage === 'semantic')).toBe(true)
    expect(summary?.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.missingContract)
    expect(summary?.id).toBe('semantic.model.v0_1')
    expect(summary?.modelTitle).toBe('Test model')
  })

  it('不支持的 schema_version 让文件无效并说明支持的版本', async () => {
    const catalog = await load([
      textFile(
        'scenarios/future.yaml',
        modelText('future.model.v0_1', (document) => {
          document['schema_version'] = '0.2'
        }),
      ),
    ])

    const issue = catalog.invalidBundles[0]?.issues[0]
    expect(issue?.code).toBe(ISSUE_CODES.unsupportedSchemaVersion)
    expect(issue?.stage).toBe('schema')
    expect(issue?.message).toContain('0.2')
  })

  it('缺少 schema_version 时同样按不支持处理', async () => {
    const catalog = await load([
      textFile(
        'scenarios/naked.yaml',
        modelText('naked.model.v0_1', (document) => {
          delete document['schema_version']
        }),
      ),
    ])

    const summary = catalog.invalidBundles[0]
    expect(summary?.issues[0]?.code).toBe(ISSUE_CODES.unsupportedSchemaVersion)
    // The model metadata was still readable, so the summary keeps its identity.
    expect(summary?.id).toBe('naked.model.v0_1')
  })

  it('无法读取的文件报 FILE_UNREADABLE，并以相对路径作为 id', async () => {
    const catalog = await load([unreadableFile('scenarios/locked.yaml')])

    expect(catalog.status).toBe('invalid')
    const summary = catalog.invalidBundles[0]
    expect(summary?.issues[0]?.code).toBe(ISSUE_CODES.fileUnreadable)
    expect(summary?.issues[0]?.stage).toBe('filesystem')
    expect(summary?.relativePath).toBe('scenarios/locked.yaml')
    expect(summary?.id).toBe('scenarios/locked.yaml')
    expect(summary?.modelTitle).toBeNull()
  })

  it('全部文件无效时状态为 invalid，且没有任何可用 bundle', async () => {
    const catalog = await load([
      textFile('scenarios/alpha.yaml', 'not: a flow model\n'),
      textFile('scenarios/broken.yaml', 'a: [1, 2\n'),
    ])

    expect(catalog.status).toBe('invalid')
    expect(catalog.validBundles).toEqual([])
    expect(catalog.invalidBundles).toHaveLength(2)
  })
})

describe('loadFolderCatalog / 重复 model ID', () => {
  it('冲突文件全部标为无效', async () => {
    const catalog = await load([
      textFile('scenarios/one.yaml', modelText('same.model.id')),
      textFile('scenarios/two.yaml', modelText('same.model.id')),
    ])

    expect(catalog.status).toBe('invalid')
    expect(catalog.validBundles).toEqual([])
    expect(catalog.invalidBundles.map((summary) => summary.relativePath)).toEqual([
      'scenarios/one.yaml',
      'scenarios/two.yaml',
    ])
    for (const summary of catalog.invalidBundles) {
      const issue = summary.issues[0]
      expect(issue?.code).toBe(ISSUE_CODES.duplicateModelId)
      expect(issue?.relatedIds).toEqual(['same.model.id'])
      expect(issue?.relativePath).toBe(summary.relativePath)
    }
    // Post-dedup counts, not the pre-dedup ones seen while reading.
    expect(catalog.progress).toEqual({
      discovered: 2,
      processed: 2,
      valid: 0,
      invalid: 2,
      ignored: 0,
    })
  })

  it('唯一 id 的其他 bundle 不受重复冲突影响', async () => {
    const catalog = await load([
      textFile('scenarios/one.yaml', modelText('same.model.id')),
      textFile('scenarios/two.yaml', modelText('same.model.id')),
      textFile('scenarios/unique.yaml', modelText('unique.model.id')),
    ])

    expect(catalog.status).toBe('partial')
    expect(catalog.validBundles.map((bundle) => bundle.id)).toEqual(['unique.model.id'])
    expect(catalog.invalidBundles.map((summary) => summary.relativePath).sort()).toEqual([
      'scenarios/one.yaml',
      'scenarios/two.yaml',
    ])
    expect(catalog.progress.valid).toBe(1)
    expect(catalog.progress.invalid).toBe(2)
  })

  it('三个文件同名时三个都无效', async () => {
    const catalog = await load([
      textFile('scenarios/one.yaml', modelText('same.model.id')),
      textFile('scenarios/two.yaml', modelText('same.model.id')),
      textFile('scenarios/three.yaml', modelText('same.model.id')),
    ])

    expect(catalog.validBundles).toEqual([])
    expect(catalog.invalidBundles).toHaveLength(3)
    expect(
      catalog.invalidBundles.every((summary) =>
        summary.issues.some((issue) => issue.code === ISSUE_CODES.duplicateModelId),
      ),
    ).toBe(true)
  })
})

describe('loadFolderCatalog / 过期 scanId', () => {
  it('扫描已被取代时返回 null，不返回半成品目录', async () => {
    let calls = 0
    const result = await loadFolderCatalog({
      snapshot: snapshotOf([textFile('scenarios/alpha.yaml', modelText('alpha.model.v0_1'))]),
      scanId: 1,
      isCurrent: () => {
        calls += 1
        return false
      },
    })

    expect(result).toBeNull()
    // The check happens right after discovery, before any file is read.
    expect(calls).toBe(1)
  })

  it('处理过程中被取代时丢弃已经完成的工作', async () => {
    let calls = 0
    const snapshots: CatalogProgress[] = []
    const result = await loadFolderCatalog({
      snapshot: snapshotOf([
        textFile('scenarios/alpha.yaml', modelText('alpha.model.v0_1')),
        textFile('scenarios/beta.yaml', modelText('beta.model.v0_1')),
      ]),
      scanId: 1,
      // Current while discovery runs, superseded by the time the bundles are
      // ready: the caller must get nothing rather than a stale catalog.
      isCurrent: () => {
        calls += 1
        return calls === 1
      },
      onProgress: (progress) => snapshots.push({ ...progress }),
    })

    expect(result).toBeNull()
    expect(calls).toBe(2)
    // The files really were read and validated before the result was dropped.
    expect(snapshots.length).toBeGreaterThanOrEqual(2)
    expect(snapshots.at(-1)?.processed).toBe(2)
  })

  it('仍然是最新的扫描时返回完整目录', async () => {
    const catalog = await load(
      [textFile('scenarios/alpha.yaml', modelText('alpha.model.v0_1'))],
      { isCurrent: () => true },
    )

    expect(catalog.status).toBe('ready')
    expect(catalog.validBundles).toHaveLength(1)
  })
})

describe('loadFolderCatalog / 目录级问题', () => {
  it('空目录报 FOLDER_EMPTY，并以目录名作为相对路径', async () => {
    const catalog = await load([])

    expect(catalog.status).toBe('invalid')
    expect(catalog.validBundles).toEqual([])
    expect(catalog.issues).toHaveLength(1)
    expect(catalog.issues[0]?.code).toBe(ISSUE_CODES.folderEmpty)
    expect(catalog.issues[0]?.stage).toBe('discovery')
    expect(catalog.issues[0]?.relativePath).toBe('flows')
    expect(catalog.progress.discovered).toBe(0)
  })

  it('有 YAML 但没有 flow 模型时报 NO_FLOW_FILES', async () => {
    const catalog = await load([
      textFile('docs/notes.yaml', 'title: notes\nitems:\n  - a\n'),
      textFile('docs/more.yaml', 'something: else\n'),
    ])

    expect(catalog.status).toBe('invalid')
    expect(catalog.issues[0]?.code).toBe(ISSUE_CODES.noFlowFiles)
    expect(catalog.issues[0]?.relativePath).toBe('flows')
    // Both files were recognised as unrelated YAML, never as errors.
    expect(catalog.progress.ignored).toBe(2)
    expect(catalog.invalidBundles).toEqual([])
  })

  it('无关 YAML 计入 ignored，但不影响同目录下的合法 bundle', async () => {
    const catalog = await load([
      textFile('scenarios/alpha.yaml', modelText('alpha.model.v0_1')),
      textFile('docs/notes.yaml', 'title: notes\n'),
    ])

    expect(catalog.status).toBe('ready')
    expect(catalog.validBundles).toHaveLength(1)
    expect(catalog.progress.ignored).toBe(1)
    expect(catalog.progress.discovered).toBe(2)
    expect(catalog.progress.processed).toBe(1)
    expect(catalog.issues).toEqual([])
  })
})
