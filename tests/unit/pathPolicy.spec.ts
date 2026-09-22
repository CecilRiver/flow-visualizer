import { describe, expect, it } from 'vitest'

import {
  FOLDER_LIMITS,
  compareRelativePaths,
  exceedsDepthLimit,
  isHiddenName,
  isStrongFlowCandidate,
  isYamlFile,
  normalizeRelativePath,
  pathDepth,
  shouldSkipDirectory,
} from '@/filesystem/pathPolicy'

/**
 * Path rules are shared by both folder adapters (DESIGN.md 6.3), so they are
 * tested as pure functions: no browser, no DOM, no filesystem.
 */
describe('normalizeRelativePath / 路径规范化', () => {
  it('把反斜杠统一成 /，并丢掉空段与 . 段', () => {
    expect(normalizeRelativePath('scenarios\\auto\\takeoff.yaml')).toBe(
      'scenarios/auto/takeoff.yaml',
    )
    expect(normalizeRelativePath('./scenarios//auto.yaml')).toBe('scenarios/auto.yaml')
    expect(normalizeRelativePath('scenarios/auto.yaml/')).toBe('scenarios/auto.yaml')
  })

  it('任何 .. 段都返回 null，即使它并没有真正逃出所选目录', () => {
    expect(normalizeRelativePath('../secret.yaml')).toBeNull()
    expect(normalizeRelativePath('scenarios/../../secret.yaml')).toBeNull()
    // `scenarios/../auto.yaml` 解析后仍在目录内部，但策略选择一律拒绝：
    // 这样就不必依赖浏览器是否已经替查看器解析过路径。
    expect(normalizeRelativePath('scenarios/../auto.yaml')).toBeNull()
  })

  it('没有剩余分段的输入返回 null', () => {
    expect(normalizeRelativePath('')).toBeNull()
    expect(normalizeRelativePath('.')).toBeNull()
    expect(normalizeRelativePath('/')).toBeNull()
    expect(normalizeRelativePath('//')).toBeNull()
    expect(normalizeRelativePath('./')).toBeNull()
  })
})

describe('shouldSkipDirectory / 跳过目录', () => {
  it('跳过 DESIGN 6.3 点名的噪音目录', () => {
    for (const name of ['.git', 'node_modules', 'dist', 'coverage']) {
      expect(shouldSkipDirectory(name)).toBe(true)
    }
  })

  it('跳过所有隐藏目录，但不误伤名字相近的普通目录', () => {
    expect(shouldSkipDirectory('.vscode')).toBe(true)
    expect(shouldSkipDirectory('.')).toBe(true)
    expect(shouldSkipDirectory('scenarios')).toBe(false)
    // 只按名字精确匹配：`distance` 里含有 `dist`，但它不是构建产物目录。
    expect(shouldSkipDirectory('distance')).toBe(false)
    expect(shouldSkipDirectory('node_modules_backup')).toBe(false)
    // 大小写敏感，避免在大小写不敏感的文件系统上产生歧义。
    expect(shouldSkipDirectory('Dist')).toBe(false)
  })

  it('isHiddenName 只判断点前缀', () => {
    expect(isHiddenName('.git')).toBe(true)
    expect(isHiddenName('git')).toBe(false)
    expect(isHiddenName('')).toBe(false)
  })
})

describe('isYamlFile / 扩展名', () => {
  it('接受 .yaml 与 .yml，且大小写不敏感', () => {
    expect(isYamlFile('stabilize.yaml')).toBe(true)
    expect(isYamlFile('scenarios/auto-waypoint.yml')).toBe(true)
    expect(isYamlFile('SCENARIOS/AUTO.YAML')).toBe(true)
    expect(isYamlFile('radio-ekf-failsafe.Flow.Yml')).toBe(true)
  })

  it('只认真正的后缀，不把含 yaml 字样的其他文件当作 YAML', () => {
    expect(isYamlFile('notes.yaml.txt')).toBe(false)
    expect(isYamlFile('flow.yaml.bak')).toBe(false)
    expect(isYamlFile('package.json')).toBe(false)
    expect(isYamlFile('flow')).toBe(false)
    expect(isYamlFile('flowyml')).toBe(false)
  })
})

describe('pathDepth / exceedsDepthLimit 深度限制', () => {
  it('深度按 / 分段计数，文件名也算一段', () => {
    expect(pathDepth('stabilize.yaml')).toBe(1)
    expect(pathDepth('scenarios/stabilize.yaml')).toBe(2)
  })

  it('恰好 8 层允许，第 9 层超限', () => {
    const atLimit = 'a/b/c/d/e/f/g/flow.yaml'
    const overLimit = 'a/b/c/d/e/f/g/h/flow.yaml'

    expect(pathDepth(atLimit)).toBe(FOLDER_LIMITS.maxDepth)
    expect(exceedsDepthLimit(atLimit)).toBe(false)
    expect(exceedsDepthLimit(overLimit)).toBe(true)
  })

  it('资源限制常量与 DESIGN 6.3 表格一致', () => {
    expect(FOLDER_LIMITS.maxDepth).toBe(8)
    expect(FOLDER_LIMITS.maxFiles).toBe(500)
    expect(FOLDER_LIMITS.maxFileBytes).toBe(5 * 1024 * 1024)
    expect(FOLDER_LIMITS.maxTotalBytes).toBe(50 * 1024 * 1024)
  })
})

describe('isStrongFlowCandidate / 强候选', () => {
  it('所选目录的直接子级、scenarios/ 下、*.flow.yaml 都是强候选', () => {
    expect(isStrongFlowCandidate('stabilize.yaml')).toBe(true)
    expect(isStrongFlowCandidate('scenarios/auto-waypoint.yaml')).toBe(true)
    expect(isStrongFlowCandidate('flows/mission.flow.yaml')).toBe(true)
    expect(isStrongFlowCandidate('flows/mission.flow.yml')).toBe(true)
  })

  it('scenarios/ 的嵌套子目录仍然算强候选', () => {
    expect(isStrongFlowCandidate('scenarios/stabilize/takeoff.yaml')).toBe(true)
  })

  it('.flow.yaml 后缀大小写不敏感', () => {
    expect(isStrongFlowCandidate('Flows/Mission.Flow.Yaml')).toBe(true)
  })

  it('其他目录下的普通 YAML 不算强候选，必须先通过签名探测', () => {
    expect(isStrongFlowCandidate('docs/readme.yaml')).toBe(false)
    expect(isStrongFlowCandidate('flows/mission.yaml')).toBe(false)
    // 只有顶层 scenarios/ 目录享受免检；嵌在更深处的同名目录不享受。
    expect(isStrongFlowCandidate('packages/demo/scenarios/auto.yaml')).toBe(false)
  })

  it('名字里带 flow 但不是 .flow.yaml 后缀的名字不算强候选', () => {
    expect(isStrongFlowCandidate('flows/myflow.yaml')).toBe(false)
    expect(isStrongFlowCandidate('flows/flow.yaml.txt')).toBe(false)
  })
})

describe('compareRelativePaths / 稳定排序', () => {
  it('相同路径返回 0', () => {
    expect(compareRelativePaths('scenarios/auto.yaml', 'scenarios/auto.yaml')).toBe(0)
  })

  it('按码点顺序比较，而不是本地化顺序', () => {
    // localeCompare 认为 'a' 排在 'B' 之前；码点顺序恰好相反（'B' = 0x42 < 'a' = 0x61）。
    // 排序必须与运行环境的 locale 无关，否则同一目录在不同机器上顺序不同。
    expect(compareRelativePaths('a', 'B')).toBe(1)
    expect(compareRelativePaths('B', 'a')).toBe(-1)
  })

  it('排序结果确定且与输入顺序无关', () => {
    const paths = ['b.yaml', 'scenarios/z.yaml', 'A.yaml', 'scenarios/a.yaml']
    const expected = ['A.yaml', 'b.yaml', 'scenarios/a.yaml', 'scenarios/z.yaml']

    expect([...paths].sort(compareRelativePaths)).toEqual(expected)
    expect([...paths].reverse().sort(compareRelativePaths)).toEqual(expected)
  })
})
