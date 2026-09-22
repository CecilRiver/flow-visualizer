import { describe, expect, it } from 'vitest'

import { GITHUB_BASE } from '@/app/config'
import type { Source } from '@/domain/model'
import { isAbsolutePath, toSourceLink, toSourceLinks, type SourceLink } from '@/domain/sourceLinks'

/**
 * Turning a configured `Source` into something safe to render (DESIGN.md 14.3,
 * 17.2, 19.1).
 *
 * Most of these cases are about what must *not* happen. A YAML file is
 * untrusted text, so a source may never choose the host its link points at, and
 * may never hand the viewer a `javascript:`, `data:` or `file:` URL. Refusing is
 * not the same as hiding: the row is still rendered, as text, with the reason —
 * so every refusal is asserted on the `href` *and* on the `blockedReason` the
 * component shows in its place.
 */

/** A real-looking (40 hex digit) commit SHA: `revision` is only a SHA or nothing. */
const SHA = 'a1b2c3d4e5f60718f9a0b1c2d3e4f50617283940'

function codeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: 'source.code',
    kind: 'source_code',
    title: '姿态控制器实现',
    path: 'ArduCopter/AP_Arming.cpp',
    revision: SHA,
    ...overrides,
  }
}

function wikiSource(overrides: Partial<Source> = {}): Source {
  return {
    id: 'source.wiki',
    kind: 'wiki',
    title: 'LAND 模式文档',
    url: 'https://ardupilot.org/copter/docs/land-mode.html',
    ...overrides,
  }
}

/** Asserts the row was refused and returns it, so the reason can be pinned too. */
function blocked(source: Source): SourceLink {
  const link = toSourceLink(source)
  expect(link.href).toBeNull()
  expect(link.blockedReason).not.toBe('')
  return link
}

/** The expected build for a path that needs no encoding, so tests can focus. */
function expectedCodeHref(path: string, fragment = ''): string {
  return `${GITHUB_BASE}/blob/${SHA}/${path}${fragment}`
}

describe('isAbsolutePath', () => {
  it('识别盘符绝对路径、UNC 路径和 POSIX 绝对路径', () => {
    expect(isAbsolutePath('C:\\Users\\me\\models\\stabilize.yaml')).toBe(true)
    expect(isAbsolutePath('C:/Users/me/models/stabilize.yaml')).toBe(true)
    expect(isAbsolutePath('\\\\build-server\\share\\stabilize.yaml')).toBe(true)
    expect(isAbsolutePath('/home/me/models/stabilize.yaml')).toBe(true)
  })

  it('不把配置里的仓库相对路径当成绝对路径', () => {
    expect(isAbsolutePath('ArduCopter/AP_Arming.cpp')).toBe(false)
    expect(isAbsolutePath('./ArduCopter/AP_Arming.cpp')).toBe(false)
    expect(isAbsolutePath('../ArduCopter/AP_Arming.cpp')).toBe(false)
    expect(isAbsolutePath('')).toBe(false)
  })
})

describe('源码链接由受控 base 与固定 SHA 构造', () => {
  it('只有 path + SHA + 行号到位时才生成链接，fragment 带出行号', () => {
    const link = toSourceLink(codeSource({ line_start: 12, line_end: 30 }))

    expect(link.href).toBe(expectedCodeHref('ArduCopter/AP_Arming.cpp', '#L12-L30'))
    expect(link.blockedReason).toBe('')
    expect(link.relativePath).toBe('ArduCopter/AP_Arming.cpp')
    expect(link.lineFragment).toBe('#L12-L30')
  })

  it('单行源码只写一个行号，而不是 start === end 的区间', () => {
    expect(toSourceLink(codeSource({ line_start: 7, line_end: 7 })).href).toBe(
      expectedCodeHref('ArduCopter/AP_Arming.cpp', '#L7'),
    )
    expect(toSourceLink(codeSource({ line_start: 7 })).href).toBe(
      expectedCodeHref('ArduCopter/AP_Arming.cpp', '#L7'),
    )
  })

  it('没有行号时链接仍然可用，不能凭空补一个行号', () => {
    const link = toSourceLink(codeSource())

    expect(link.href).toBe(expectedCodeHref('ArduCopter/AP_Arming.cpp'))
    expect(link.lineFragment).toBeNull()
  })

  it('配置里的 url 不能影响源码链接：host 永远来自 GITHUB_BASE', () => {
    // The dangerous shape: a `source_code` row that also carries a `url`. The
    // code link must be built from the constant, never taken from the field.
    const link = toSourceLink(
      codeSource({ url: 'https://evil.example.com/payload.cpp', revision: SHA }),
    )

    expect(link.href).toBe(expectedCodeHref('ArduCopter/AP_Arming.cpp'))
    expect(link.href).not.toContain('evil.example.com')
  })

  it('看起来像主机的 path 也只能落在 GITHUB_BASE 之内', () => {
    const link = toSourceLink(codeSource({ path: 'evil.example.com/x.cpp' }))

    expect(link.href).toBe(expectedCodeHref('evil.example.com/x.cpp'))
    expect(new URL(link.href ?? '').host).toBe(new URL(GITHUB_BASE).host)
  })

  it('协议相对路径被当作绝对路径拒绝，不会改写到别的主机', () => {
    const link = blocked(codeSource({ path: '//evil.example.com/x.cpp' }))

    expect(link.blockedReason).toBe('路径为绝对路径，已省略')
    expect(link.relativePath).toBeNull()
  })

  it('base 常量本身必须是 HTTPS', () => {
    expect(GITHUB_BASE.startsWith('https://')).toBe(true)
  })
})

describe('非 HTTPS 链接一律降级为文本', () => {
  const refused: readonly { url: string; protocol: string }[] = [
    { url: 'javascript:alert(1)', protocol: 'javascript:' },
    { url: 'data:text/html,<script>alert(1)</script>', protocol: 'data:' },
    { url: 'file:///C:/Users/me/models/stabilize.yaml', protocol: 'file:' },
    { url: 'http://ardupilot.org/copter/docs/land-mode.html', protocol: 'http:' },
  ]

  it('wiki/生成内容的非 HTTPS url 不产生可点击链接', () => {
    for (const { url, protocol } of refused) {
      const link = blocked(wikiSource({ url }))

      expect(link.href).toBeNull()
      // The reason names the offending scheme, so the row explains itself.
      expect(link.blockedReason).toBe(`仅 HTTPS 链接可点击（当前为 ${protocol}）`)
    }
  })

  it('降级后的行仍然保留标题、locator 与来源信息', () => {
    const link = blocked(wikiSource({ url: 'javascript:alert(1)', section: 'Land Mode' }))

    expect(link.title).toBe('LAND 模式文档')
    expect(link.kindLabel).toBe('Wiki')
    expect(link.locator).toBe('Land Mode')
  })

  it('缺少 url、空 url 与无法解析的 url 各有自己的原因', () => {
    expect(blocked(wikiSource({ url: undefined })).blockedReason).toBe('配置中未提供链接')
    expect(blocked(wikiSource({ url: '' })).blockedReason).toBe('配置中未提供链接')
    expect(blocked(wikiSource({ url: '   ' })).blockedReason).toBe('配置中未提供链接')
    // A relative reference has no base to resolve against, and must not be
    // silently turned into a same-origin link.
    expect(blocked(wikiSource({ url: '/copter/docs/land-mode.html' })).blockedReason).toBe(
      '链接格式无法解析',
    )
    expect(blocked(wikiSource({ url: 'not a url' })).blockedReason).toBe('链接格式无法解析')
  })

  it('wiki 使用配置中的 HTTPS URL 原样保留查询与片段', () => {
    const url = 'https://ardupilot.org/copter/docs/land-mode.html?mode=land#anchor'
    const link = toSourceLink(wikiSource({ url }))

    expect(link.href).toBe(url)
    expect(link.blockedReason).toBe('')
    expect(link.kindLabel).toBe('Wiki')
  })

  it('行号进入 wiki 行只是文本，不会被拼进配置好的 URL', () => {
    const link = toSourceLink(wikiSource({ line_start: 5, line_end: 9 }))

    // Only a source-code link is constructed; a wiki URL is used verbatim.
    expect(link.href).toBe('https://ardupilot.org/copter/docs/land-mode.html')
    expect(link.lineFragment).toBe('#L5-L9')
  })
})

describe('源码链接的必需条件', () => {
  it('缺少路径或路径为空时不构造链接', () => {
    expect(blocked(codeSource({ path: undefined })).blockedReason).toBe('缺少源码路径')
    expect(blocked(codeSource({ path: '   ' })).blockedReason).toBe('缺少源码路径')
    expect(blocked(codeSource({ path: undefined })).relativePath).toBeNull()
  })

  it('缺少 revision、revision 不是 SHA 时不构造链接', () => {
    expect(blocked(codeSource({ revision: undefined })).blockedReason).toBe('缺少固定的 revision')
    expect(blocked(codeSource({ revision: '' })).blockedReason).toBe('缺少固定的 revision')
    expect(blocked(codeSource({ revision: 'main' })).blockedReason).toBe('revision 不是提交 SHA')
    // Too short to be a commit: a 6-char prefix is still a moving target.
    expect(blocked(codeSource({ revision: 'a1b2c3' })).blockedReason).toBe('revision 不是提交 SHA')
  })

  it('revision 不能拿来夹带路径片段或其它字符', () => {
    for (const revision of [
      `${SHA}/../../main`,
      `${SHA} main`,
      `${SHA}?x=1`,
      `${SHA}#L1`,
      `refs/heads/${SHA}`,
    ]) {
      const link = blocked(codeSource({ revision }))

      expect(link.blockedReason).toBe('revision 不是提交 SHA')
    }
  })

  it('大写 SHA 也被接受，且后面仍必须是纯十六进制', () => {
    const upper = SHA.toUpperCase()
    expect(toSourceLink(codeSource({ revision: upper })).href).toBe(
      expectedCodeHref('ArduCopter/AP_Arming.cpp').replace(SHA, upper),
    )
    expect(blocked(codeSource({ revision: `${SHA}z` })).blockedReason).toBe('revision 不是提交 SHA')
  })

  it('缺少 revision 时仍然显示相对路径，便于人工核对', () => {
    const link = blocked(codeSource({ revision: undefined }))

    expect(link.relativePath).toBe('ArduCopter/AP_Arming.cpp')
    expect(link.revision).toBeNull()
  })

  it('绝对路径既不显示也不进入链接', () => {
    const link = blocked(codeSource({ path: 'C:\\Users\\me\\models\\stabilize.yaml' }))

    expect(link.blockedReason).toBe('路径为绝对路径，已省略')
    expect(link.relativePath).toBeNull()
    // The host layout is not part of the model, so nothing the component renders
    // may still echo it.
    const rendered = [link.relativePath, link.locator, link.title, link.blockedReason].join('|')
    expect(rendered).not.toContain('C:')
    expect(rendered).not.toContain('Users')
  })

  it('wiki 行的绝对 path 只影响显示，不阻止配置好的链接', () => {
    const link = toSourceLink(wikiSource({ path: 'C:\\Users\\me\\models\\stabilize.yaml' }))

    expect(link.href).toBe('https://ardupilot.org/copter/docs/land-mode.html')
    expect(link.relativePath).toBeNull()
  })

  it('路径只剩已过滤片段时不构造链接', () => {
    expect(blocked(codeSource({ path: '..' })).blockedReason).toBe('源码路径为空')
    expect(blocked(codeSource({ path: '.' })).blockedReason).toBe('源码路径为空')
    expect(blocked(codeSource({ path: './' })).blockedReason).toBe('源码路径为空')
  })

  it('以 / 开头的 path 先按绝对路径处理，而不是当成可编码的相对路径', () => {
    // `////` would otherwise encode down to an empty path, but the absolute
    // check runs first: a path the configuration wrote with a root is not a
    // repository-relative reference, whatever follows it.
    expect(blocked(codeSource({ path: '////' })).blockedReason).toBe('路径为绝对路径，已省略')
    expect(blocked(codeSource({ path: '/ArduCopter/AP_Arming.cpp' })).blockedReason).toBe(
      '路径为绝对路径，已省略',
    )
  })
})

describe('路径编码', () => {
  it('空格编码为 %20，而不是加号或裸空格', () => {
    const link = toSourceLink(codeSource({ path: 'ArduCopter/My File.cpp' }))

    expect(link.href).toBe(expectedCodeHref('ArduCopter/My%20File.cpp'))
    expect(link.relativePath).toBe('ArduCopter/My File.cpp')
  })

  it('UTF-8 文件名按字节百分号编码', () => {
    const link = toSourceLink(codeSource({ path: 'ArduCopter/姿态控制.cpp' }))

    expect(link.href).toBe(expectedCodeHref('ArduCopter/%E5%A7%BF%E6%80%81%E6%8E%A7%E5%88%B6.cpp'))
    // The row still shows the path as the configuration wrote it.
    expect(link.relativePath).toBe('ArduCopter/姿态控制.cpp')
  })

  it('# 与 ? 被编码，不会截断路径或伪造查询串', () => {
    const link = toSourceLink(codeSource({ path: 'ArduCopter/AP#1.cpp', line_start: 3 }))

    expect(link.href).toBe(expectedCodeHref('ArduCopter/AP%231.cpp', '#L3'))
    // The URL must keep the whole path and carry exactly one fragment.
    const parsed = new URL(link.href ?? '')
    expect(parsed.pathname.endsWith('/ArduCopter/AP%231.cpp')).toBe(true)
    expect(parsed.hash).toBe('#L3')
    expect(parsed.search).toBe('')
  })

  it('问号被编码，不会变成查询串', () => {
    const link = toSourceLink(codeSource({ path: 'ArduCopter/What.cpp' }))

    expect(link.href).toBe(expectedCodeHref('ArduCopter/What.cpp'))
    expect(new URL(link.href ?? '').search).toBe('')
    expect(toSourceLink(codeSource({ path: 'ArduCopter/What?.cpp' })).href).toBe(
      expectedCodeHref('ArduCopter/What%3F.cpp'),
    )
  })

  it('已带百分号的路径被再次编码，不做解码', () => {
    // Encoding is applied to the configured text, never to something already
    // decoded first: `%20` in a path is a literal percent sign.
    expect(toSourceLink(codeSource({ path: 'ArduCopter/a%20b.cpp' })).href).toBe(
      expectedCodeHref('ArduCopter/a%2520b.cpp'),
    )
  })

  it('目录穿越片段被丢弃，链接不会指到仓库之外', () => {
    const link = toSourceLink(codeSource({ path: 'ArduCopter/../../etc/passwd' }))

    expect(link.href).toBe(expectedCodeHref('ArduCopter/etc/passwd'))
    expect(link.href).not.toContain('..')
  })

  it('空片段与当前目录片段被折叠掉', () => {
    expect(toSourceLink(codeSource({ path: 'ArduCopter//AP_Arming.cpp' })).href).toBe(
      expectedCodeHref('ArduCopter/AP_Arming.cpp'),
    )
    expect(toSourceLink(codeSource({ path: './ArduCopter/./AP_Arming.cpp' })).href).toBe(
      expectedCodeHref('ArduCopter/AP_Arming.cpp'),
    )
  })
})

describe('locator 与 kindLabel', () => {
  it('有 symbol 时写成 symbol:行号，区间只带一个 L', () => {
    expect(
      toSourceLink(codeSource({ symbol: 'AP_Arming::arm', line_start: 12, line_end: 30 })).locator,
    ).toBe('AP_Arming::arm:12-30')
    expect(toSourceLink(codeSource({ symbol: 'AP_Arming::arm', line_start: 12 })).locator).toBe(
      'AP_Arming::arm:12',
    )
  })

  it('没有 symbol 时回落到 L 前缀的行号，再回落到 section', () => {
    expect(toSourceLink(codeSource({ line_start: 12, line_end: 30 })).locator).toBe('L12-L30')
    expect(toSourceLink(codeSource({ line_start: 12 })).locator).toBe('L12')
    expect(toSourceLink(codeSource({ section: 'Arming checks' })).locator).toBe('Arming checks')
    expect(toSourceLink(codeSource()).locator).toBeNull()
  })

  it('kind 显示为中文标签', () => {
    expect(toSourceLink(codeSource()).kindLabel).toBe('源码')
    expect(toSourceLink(wikiSource()).kindLabel).toBe('Wiki')
    expect(toSourceLink(wikiSource({ kind: 'generated' })).kindLabel).toBe('生成内容')
  })
})

describe('href 与 blockedReason 互斥', () => {
  const cases: readonly Source[] = [
    codeSource({ line_start: 1, line_end: 2 }),
    codeSource(),
    codeSource({ path: undefined }),
    codeSource({ revision: 'main' }),
    codeSource({ path: '/etc/passwd' }),
    wikiSource(),
    wikiSource({ url: 'http://ardupilot.org/x' }),
    wikiSource({ url: 'javascript:alert(1)' }),
    wikiSource({ url: undefined }),
    wikiSource({ kind: 'generated' }),
  ]

  it('有链接时没有阻断原因，没有链接时一定有原因', () => {
    for (const source of cases) {
      const link = toSourceLink(source)
      expect(link.href === null).toBe(link.blockedReason !== '')
    }
  })

  it('toSourceLinks 保持配置顺序，缺省输入得到空数组', () => {
    const links = toSourceLinks([codeSource(), wikiSource({ url: 'http://x/y' })])

    expect(links.map((link) => link.kindLabel)).toEqual(['源码', 'Wiki'])
    expect(links[0]?.href).not.toBeNull()
    expect(links[1]?.href).toBeNull()
    expect(toSourceLinks(undefined)).toEqual([])
    expect(toSourceLinks([])).toEqual([])
  })
})
