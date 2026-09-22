import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadFolderCatalog } from '@/catalog/loadFolderCatalog'
import type { GraphLevel } from '@/domain/model'
import type { FolderFile, FolderSnapshot } from '@/filesystem/types'
import { computeElkLayout } from '@/layout/elkLayout'
import { buildOrderMaps, projectScenario } from '@/projection/projectScenario'
import { selectScenario } from '@/projection/selectScenario'

/**
 * Loads the real Stabilize model through the full pipeline.
 *
 * The file is read from the sibling model-generation project at test time and
 * is never bundled into the viewer: the production build contains only the
 * viewer and its Schema snapshots (DESIGN.md 20). The suite is skipped when
 * that project is not checked out next to this one.
 */
// Vitest runs with the project root as cwd; the model project sits beside it.
const STABILIZE_PATH = resolve(process.cwd(), '../arducopter-flow-model/scenarios/stabilize.yaml')

const hasRealModel = existsSync(STABILIZE_PATH)

function snapshotFromPaths(paths: readonly string[]): FolderSnapshot {
  const files: FolderFile[] = paths.map((absolutePath) => {
    const relativePath = absolutePath.split(/[\\/]/).slice(-2).join('/')
    return {
      relativePath,
      size: readFileSync(absolutePath).byteLength,
      lastModified: 0,
      readText: async () => readFileSync(absolutePath, 'utf8'),
    }
  })
  return {
    displayName: 'arducopter-flow-model',
    mode: 'directory-input',
    canRefresh: false,
    files,
  }
}

describe.skipIf(!hasRealModel)('real stabilize model', () => {
  it('loads as a single valid bundle with no issues', async () => {
    const catalog = await loadFolderCatalog({
      snapshot: snapshotFromPaths([STABILIZE_PATH]),
      scanId: 1,
    })

    expect(catalog).not.toBeNull()
    expect(catalog?.status).toBe('ready')
    expect(catalog?.invalidBundles).toEqual([])
    expect(catalog?.issues).toEqual([])

    const bundle = catalog?.validBundles[0]
    expect(bundle?.id).toBe('arducopter.stabilize.v0_1')
    expect(bundle?.schemaVersion).toBe('0.1')
    expect(bundle?.bundle.model.review_status).toBe('evidence_checked')
    expect(bundle?.index.componentsById.size).toBe(16)
    expect(bundle?.index.flowsById.size).toBe(12)
    expect(bundle?.index.scenariosById.size).toBe(1)
  })

  it('resolves every scenario endpoint and reports no asymmetry', async () => {
    const catalog = await loadFolderCatalog({
      snapshot: snapshotFromPaths([STABILIZE_PATH]),
      scanId: 1,
    })
    const bundle = catalog?.validBundles[0]
    expect(bundle?.warnings).toEqual([])
  })
})

/** Loads the real model and projects one level of its only scenario. */
async function projectRealModel(level: GraphLevel) {
  const catalog = await loadFolderCatalog({
    snapshot: snapshotFromPaths([STABILIZE_PATH]),
    scanId: 1,
  })
  const bundle = catalog?.validBundles[0]
  if (bundle === undefined) throw new Error('real model did not load')

  const slice = selectScenario({
    scenarioId: bundle.bundle.scenarios[0]?.id ?? '',
    index: bundle.index,
  })
  if (slice === null) throw new Error('real model has no scenario')

  return {
    bundle,
    graph: projectScenario({
      slice,
      index: bundle.index,
      level,
      filters: {
        enabledFlowKinds: ['command', 'measurement', 'state', 'event', 'control', 'actuation', 'feedback'],
        enabledVerificationStates: [
          'conflict',
          'inferred',
          'docs_only',
          'code_confirmed',
          'docs_and_code_confirmed',
          'human_verified',
        ],
      },
      order: buildOrderMaps(bundle.bundle),
    }),
  }
}

describe.skipIf(!hasRealModel)('real stabilize model / projection and layout', () => {
  it('每个层级都投影出一致的节点、边与分组', async () => {
    const l0 = await projectRealModel(0)
    const l1 = await projectRealModel(1)
    const l2 = await projectRealModel(2)

    // L0 collapses every internal component onto the single system node and
    // keeps the three external boundaries.
    expect(l0.graph.nodes).toHaveLength(4)
    expect(l0.graph.groups).toHaveLength(0)
    expect(l0.graph.edges).toHaveLength(3)

    // L1 keeps system + five capability domains + three externals.
    expect(l1.graph.nodes).toHaveLength(9)
    expect(l1.graph.groups).toHaveLength(0)
    // Two flows collapse onto a single domain at L1 and are recorded on it
    // rather than drawn as self-loops: 10 edges + 2 hidden = 12 flows.
    expect(l1.graph.edges).toHaveLength(10)
    expect(
      l1.graph.nodes.reduce((sum, node) => sum + node.hiddenInternalFlowIds.length, 0),
    ).toBe(2)

    // L2 keeps system + all seven L2 components + three externals, and folds
    // the five capability domains into display groups.
    expect(l2.graph.nodes).toHaveLength(11)
    expect(l2.graph.groups).toHaveLength(5)
    expect(l2.graph.edges).toHaveLength(12)

    // No projection may invent a dangling endpoint.
    for (const projected of [l0.graph, l1.graph, l2.graph]) {
      const ids = new Set([
        ...projected.nodes.map((node) => node.id),
        ...projected.groups.map((group) => group.id),
      ])
      for (const edge of projected.edges) {
        expect(ids.has(edge.source), `dangling source ${edge.source}`).toBe(true)
        expect(ids.has(edge.target), `dangling target ${edge.target}`).toBe(true)
      }
    }
  })

  it('折叠掉的内部 flow 记录在节点上，不会凭空消失', async () => {
    const l0 = await projectRealModel(0)
    const system = l0.graph.nodes.find((node) => node.id === 'system.arducopter')
    expect(system?.hiddenInternalFlowIds.length).toBeGreaterThan(0)
  })

  it('ELK 能为真实模型的三层生成不重叠坐标', async () => {
    for (const level of [0, 1, 2] as const) {
      const { graph } = await projectRealModel(level)
      const result = await computeElkLayout(graph)

      const contained = new Set(
        graph.nodes.filter((node) => node.parentGroupId !== undefined).map((node) => node.id),
      )
      const topLevel = result.nodes.filter((node) => !contained.has(node.id))

      for (let a = 0; a < topLevel.length; a += 1) {
        for (let b = a + 1; b < topLevel.length; b += 1) {
          const first = topLevel[a]
          const second = topLevel[b]
          if (first === undefined || second === undefined) continue
          const overlaps =
            first.x < second.x + second.width &&
            second.x < first.x + first.width &&
            first.y < second.y + second.height &&
            second.y < first.y + first.height
          expect(overlaps, `L${level}: ${first.id} overlaps ${second.id}`).toBe(false)
        }
      }

      expect(result.nodes.length).toBe(graph.nodes.length + graph.groups.length)
    }
  })

  it('真实模型的投影是确定性的', async () => {
    const first = await projectRealModel(2)
    const second = await projectRealModel(2)
    expect(first.graph.nodes.map((node) => node.id)).toEqual(
      second.graph.nodes.map((node) => node.id),
    )
    expect(first.graph.edges.map((edge) => edge.id)).toEqual(
      second.graph.edges.map((edge) => edge.id),
    )
  })
})
