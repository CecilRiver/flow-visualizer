import { GITHUB_BASE } from '@/app/config'

import { SOURCE_KIND_LABEL, labelFor } from './labels'
import type { Source } from './model'

/**
 * Turning a configured `Source` into something safe to render (DESIGN.md 14.3,
 * 18).
 *
 * Two rules drive everything here:
 *   - a source-code link is *built*, never taken from the configuration: the
 *     base is a build-time constant, and only a validated SHA and an encoded
 *     relative path are appended to it;
 *   - a `url` is used only when it parses as `https:`, so a configuration can
 *     never hand the viewer a `javascript:`, `data:` or `file:` URL.
 *
 * Anything that fails those checks is still shown — as text, with the reason —
 * because a broken reference is a fact about the model, not something to hide.
 */

export interface SourceLink {
  source: Source
  kindLabel: string
  /** Present only when a link could be built safely. */
  href: string | null
  /** Why no link was built; empty when `href` is set. */
  blockedReason: string
  title: string
  /** Relative path as configured; null when absent or absolute. */
  relativePath: string | null
  revision: string | null
  /** `symbol:12-30` style locator, when the configuration supplies one. */
  locator: string | null
  /** `#L12-L30` fragment, kept separate so the UI can show it as text. */
  lineFragment: string | null
}

/**
 * True for paths the viewer must not display: the host machine's layout is not
 * part of the model, and echoing one would read as a real local file.
 */
export function isAbsolutePath(path: string): boolean {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(path)
}

/** A commit SHA, and nothing that could smuggle a path segment into the URL. */
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i

function encodePath(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function safeUrl(url: string | undefined): { href: string | null; reason: string } {
  if (url === undefined || url.trim() === '') {
    return { href: null, reason: '配置中未提供链接' }
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { href: null, reason: '链接格式无法解析' }
  }

  if (parsed.protocol !== 'https:') {
    return { href: null, reason: `仅 HTTPS 链接可点击（当前为 ${parsed.protocol}）` }
  }

  return { href: parsed.toString(), reason: '' }
}

/**
 * Builds `{base}/blob/{sha}/{path}#L{start}-L{end}`.
 *
 * Returns null unless every ingredient is present and well-formed: a link that
 * silently drops the SHA would point at whatever the branch happens to be today,
 * which is exactly what the pinned revision exists to prevent.
 */
function buildCodeLink(
  source: Source,
): { href: string | null; reason: string; relativePath: string | null } {
  const path = source.path
  if (path === undefined || path.trim() === '') {
    return { href: null, reason: '缺少源码路径', relativePath: null }
  }
  if (isAbsolutePath(path)) {
    return { href: null, reason: '路径为绝对路径，已省略', relativePath: null }
  }

  const revision = source.revision
  if (revision === undefined || revision.trim() === '') {
    return { href: null, reason: '缺少固定的 revision', relativePath: path }
  }
  if (!SHA_PATTERN.test(revision)) {
    return { href: null, reason: 'revision 不是提交 SHA', relativePath: path }
  }

  const encoded = encodePath(path)
  if (encoded === '') {
    return { href: null, reason: '源码路径为空', relativePath: null }
  }

  const fragment = lineFragmentOf(source)
  const href = `${GITHUB_BASE}/blob/${revision}/${encoded}${fragment}`
  return { href, reason: '', relativePath: path }
}

function lineFragmentOf(source: Source): string {
  const start = source.line_start
  if (start === undefined) return ''
  const end = source.line_end
  if (end === undefined || end === start) return `#L${String(start)}`
  return `#L${String(start)}-L${String(end)}`
}

function locatorOf(source: Source): string | null {
  const start = source.line_start
  if (source.symbol !== undefined && start !== undefined) {
    const end = source.line_end
    return `${source.symbol}:${String(start)}${end === undefined ? '' : `-${String(end)}`}`
  }
  if (start !== undefined) {
    const end = source.line_end
    return `L${String(start)}${end === undefined ? '' : `-L${String(end)}`}`
  }
  return source.section ?? null
}

export function toSourceLink(source: Source): SourceLink {
  let href: string | null = null
  let reason = ''
  let relativePath: string | null = source.path ?? null

  if (source.kind === 'source_code') {
    const built = buildCodeLink(source)
    href = built.href
    reason = built.reason
    relativePath = built.relativePath
  } else {
    // Wiki and generated content are only ever reachable through a configured
    // HTTPS URL; there is no base to construct one from.
    const safe = safeUrl(source.url)
    href = safe.href
    reason = safe.reason
    if (relativePath !== null && isAbsolutePath(relativePath)) relativePath = null
  }

  const fragment = lineFragmentOf(source)

  return {
    source,
    kindLabel: labelFor(SOURCE_KIND_LABEL, source.kind),
    href,
    blockedReason: reason,
    title: source.title,
    relativePath,
    revision: source.revision ?? null,
    locator: locatorOf(source),
    lineFragment: fragment === '' ? null : fragment,
  }
}

export function toSourceLinks(sources: readonly Source[] | undefined): SourceLink[] {
  return (sources ?? []).map(toSourceLink)
}
