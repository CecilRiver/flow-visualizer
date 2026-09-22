import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'

import {
  FLOW_KIND_VALUES,
  VERIFICATION_VALUES,
  buildSearch,
  parseUrlState,
  replaceUrlState,
} from '@/app/urlState'
import {
  DEFAULT_LEVEL,
  resetUrlState,
  takeIgnoredUrlParams,
  useUrlState,
} from '@/composables/useUrlState'
import { useCatalogStore } from '@/stores/catalog'
import { useExplorerStore } from '@/stores/explorer'

import { buildFixtureBundle } from '../fixtures/buildBundle'

/**
 * The query string as view state (DESIGN.md 8.4, 19.1).
 *
 * Two properties carry the design: the URL is a *convenience*, never a
 * capability — after a reload the app still starts without a folder, and a link
 * can only ever name a bundle/scenario the user's own folder turns out to
 * contain — and an unreadable link must still open the viewer, falling back to
 * defaults rather than failing the boot.
 */

/** Typed as the parameter itself, so `level` stays a GraphLevel and not `number`. */
const DEFAULT_STATE: Parameters<typeof buildSearch>[0] = {
  bundleId: null,
  scenarioId: null,
  level: DEFAULT_LEVEL,
  flowKinds: FLOW_KIND_VALUES,
  verificationStates: VERIFICATION_VALUES,
  defaultLevel: DEFAULT_LEVEL,
}

/** The same call `useUrlState` makes when the view changes. */
function searchFor(overrides: Partial<Parameters<typeof buildSearch>[0]>): string {
  return buildSearch({ ...DEFAULT_STATE, ...overrides })
}

/** jsdom has one location per file, so every case states the link it opens. */
function openWith(search: string): void {
  window.history.replaceState(null, '', search === '' ? '/' : `/${search}`)
}

/** Opens the app on a link: fresh Pinia, fresh URL bootstrap. */
function boot(search: string): void {
  openWith(search)
  setActivePinia(createPinia())
  useUrlState()
}

afterEach(() => {
  // The bootstrap is module-level state, so it has to be torn down by hand.
  resetUrlState()
  openWith('')
})

describe('parseUrlState / buildSearch 往返', () => {
  it('空查询串不产生任何状态覆盖', () => {
    expect(parseUrlState('')).toEqual({ state: {}, ignored: [] })
  })

  it('默认视图不写入 URL，避免干净的目录产生脏链接', () => {
    expect(buildSearch({ ...DEFAULT_STATE })).toBe('')
  })

  it('非默认视图往返一致', () => {
    const search = searchFor({
      bundleId: 'test.model.v0_1',
      scenarioId: 'scenario.test',
      level: 1,
      flowKinds: ['command', 'state'],
      verificationStates: ['conflict'],
    })

    expect(parseUrlState(search)).toEqual({
      state: {
        bundleId: 'test.model.v0_1',
        scenarioId: 'scenario.test',
        level: 1,
        flowKinds: ['command', 'state'],
        verificationStates: ['conflict'],
      },
      ignored: [],
    })
  })

  it('level 0 不会被当成缺省值丢掉', () => {
    expect(searchFor({ level: 0 })).toBe('?level=0')
    expect(parseUrlState(searchFor({ level: 0 })).state.level).toBe(0)
  })

  it('全选时省略 flow/verification，部分选择时写入', () => {
    expect(searchFor({})).toBe('')
    expect(searchFor({ flowKinds: ['command'] })).toBe('?flow=command')
    expect(searchFor({ verificationStates: ['inferred'] })).toBe('?verification=inferred')
  })

  it('清空筛选后写成空参数，往返仍然保留“已清空”', () => {
    // An empty selection is a real user state (DESIGN.md 15.1), so it has to
    // survive a round trip; it is not the same as "no preference".
    const search = searchFor({ flowKinds: [] })

    expect(search).toBe('?flow=')
    expect(parseUrlState(search).state.flowKinds).toEqual([])
  })

  it('URL 只写入第 8.4 节列出的参数名', () => {
    const search = searchFor({
      bundleId: 'test.model.v0_1',
      scenarioId: 'scenario.test',
      level: 1,
      flowKinds: ['command'],
      verificationStates: ['conflict'],
    })

    expect([...new URLSearchParams(search).keys()].sort()).toEqual([
      'bundle',
      'flow',
      'level',
      'scenario',
      'verification',
    ])
  })

  it('bundle/scenario 的空值表示“无偏好”，而不是空字符串 id', () => {
    expect(parseUrlState('?bundle=&scenario=')).toEqual({
      state: { bundleId: null, scenarioId: null },
      ignored: [],
    })
  })

  it('列表去重、容忍空白与空项', () => {
    const { state } = parseUrlState('?flow=command,%20state,,command')

    expect(state.flowKinds).toEqual(['command', 'state'])
  })
})

describe('未知参数被忽略并上报', () => {
  it('无法识别的取值被丢弃，同时进入 ignored 供界面提示', () => {
    const { state, ignored } = parseUrlState('?level=abc&flow=command,bogus&verification=nope')

    // What could be understood is still applied...
    expect(state.level).toBeUndefined()
    expect(state.flowKinds).toEqual(['command'])
    // ...and what could not is named, so a stale bookmark explains itself
    // instead of silently showing something else.
    expect(ignored).toEqual(['level=abc', 'flow=bogus', 'verification=nope'])
  })

  it('未知参数名既不进入状态，也不影响同一链接里的已知参数', () => {
    const { state } = parseUrlState('?folder=C:/Users/me/models&level=1&utm_source=chat')

    expect(state).toEqual({ level: 1 })
  })

  it('被忽略的取值会后落在默认值上，而不是让启动失败', () => {
    expect(() => parseUrlState('?level={}&flow=%%%&verification=')).not.toThrow()
    expect(parseUrlState('?level=-1').state.level).toBeUndefined()
  })
})

describe('useUrlState / 首次加载', () => {
  it('没有查询串时使用默认值，并把地址清理干净', () => {
    boot('')
    const explorer = useExplorerStore()

    expect(explorer.level).toBe(DEFAULT_LEVEL)
    expect(explorer.enabledFlowKinds).toEqual([...FLOW_KIND_VALUES])
    expect(explorer.enabledVerificationStates).toEqual([...VERIFICATION_VALUES])
    expect(window.location.search).toBe('')
  })

  it('链接里的默认值等于没写，地址同样被清理', () => {
    boot('?level=2')

    expect(useExplorerStore().level).toBe(DEFAULT_LEVEL)
    expect(window.location.search).toBe('')
  })

  it('已知参数被应用到视图，并原样写回 URL', () => {
    boot('?level=1&flow=command,state&verification=conflict,inferred')
    const explorer = useExplorerStore()

    expect(explorer.level).toBe(1)
    expect(explorer.enabledFlowKinds).toEqual(['command', 'state'])
    expect(explorer.enabledVerificationStates).toEqual(['conflict', 'inferred'])
    expect(parseUrlState(window.location.search).state).toEqual({
      level: 1,
      flowKinds: ['command', 'state'],
      verificationStates: ['conflict', 'inferred'],
    })
  })

  it('level=0 被当成真实层级，而不是“没有值”', () => {
    boot('?level=0')

    expect(useExplorerStore().level).toBe(0)
  })

  it('无法识别的取值被忽略并上报一次，随后清空', () => {
    boot('?level=9&flow=command,bogus')

    // A level the app cannot show falls back to the default instead of failing.
    expect(useExplorerStore().level).toBe(DEFAULT_LEVEL)
    expect(takeIgnoredUrlParams()).toEqual(['level=9', 'flow=bogus'])
    // Taken, not peeked: the notice shows once per boot.
    expect(takeIgnoredUrlParams()).toEqual([])
  })

  it('flow/verification 的取值全部无法识别时回退默认全选，而不是清空筛选（DESIGN 8.4）', () => {
    boot('?flow=unknown&verification=unknown')
    const explorer = useExplorerStore()

    // DESIGN 8.4: 未知值忽略并回退默认值. The defaults are the full
    // selections (DESIGN 15.1, low-confidence states included), so an
    // unreadable link must not land on an empty graph.
    expect(explorer.enabledFlowKinds).toEqual([...FLOW_KIND_VALUES])
    expect(explorer.enabledVerificationStates).toEqual([...VERIFICATION_VALUES])
  })

  it('显式的空 flow= 仍然表示用户清空过筛选', () => {
    boot('?flow=')

    expect(useExplorerStore().enabledFlowKinds).toEqual([])
  })
})

describe('useUrlState / 待定的 bundle 与 scenario', () => {
  it('目录载入之前链接什么都做不了，载入之后才按 id 激活', async () => {
    boot('?bundle=test.model.v0_1&scenario=scenario.test')
    const catalog = useCatalogStore()
    const explorer = useExplorerStore()

    // The link is not a capability: nothing is loaded yet, so nothing happens.
    expect(catalog.activeBundleId).toBeNull()
    expect(catalog.activeScenarioId).toBeNull()

    catalog.validBundles = [buildFixtureBundle()]
    catalog.status = 'ready'
    catalog.activateFirstAvailable()

    // The pending ids are honoured on the next view change, which is how the
    // real sequence (folder picked -> catalog committed -> watch fires) reads.
    explorer.setLevel(1)
    await nextTick()

    expect(catalog.activeBundleId).toBe('test.model.v0_1')
    expect(catalog.activeScenarioId).toBe('scenario.test')
    expect(window.location.search).toContain('bundle=test.model.v0_1')
  })

  it('链接里的 bundle 不在所选目录中时保留目录自己的选择', async () => {
    boot('?bundle=model.gone')
    const catalog = useCatalogStore()
    catalog.validBundles = [buildFixtureBundle()]
    catalog.activateFirstAvailable()

    useExplorerStore().setLevel(1)
    await nextTick()

    expect(catalog.activeBundleId).toBe('test.model.v0_1')
  })

  it('链接里的 scenario 不存在时静默回退到该 bundle 的第一个场景', async () => {
    boot('?bundle=test.model.v0_1&scenario=scenario.gone')
    const catalog = useCatalogStore()
    catalog.validBundles = [buildFixtureBundle()]
    catalog.activateFirstAvailable()

    useExplorerStore().setLevel(1)
    await nextTick()

    // A stale bookmark must not produce an error page or an inconsistent pair.
    expect(catalog.activeBundleId).toBe('test.model.v0_1')
    expect(catalog.activeScenarioId).toBe('scenario.test')
  })
})

describe('useUrlState / 生命周期', () => {
  it('重复调用不会二次读取链接', () => {
    boot('?level=1')
    expect(useExplorerStore().level).toBe(1)

    openWith('?level=0')
    useUrlState()

    // Already booted: the second call is a no-op, so the address bar cannot
    // pull the view out from under the user.
    expect(useExplorerStore().level).toBe(1)
  })

  it('resetUrlState 之后可以按新的链接重新初始化', () => {
    boot('?level=1')
    resetUrlState()

    openWith('?level=0')
    useUrlState()

    expect(useExplorerStore().level).toBe(0)
  })

  it('视图变化写回 URL，使用 replaceState 而不是新增历史', async () => {
    boot('')
    const explorer = useExplorerStore()
    const before = window.history.length

    explorer.setLevel(1)
    await nextTick()

    expect(window.location.search).toBe('?level=1')
    expect(window.history.length).toBe(before)
  })
})

describe('replaceUrlState', () => {
  it('只改查询串，保留路径与 hash', () => {
    window.history.replaceState(null, '', '/index.html#inspector')

    replaceUrlState('?level=1')

    expect(window.location.pathname).toBe('/index.html')
    expect(window.location.search).toBe('?level=1')
    expect(window.location.hash).toBe('#inspector')
  })
})
