import {
  isXNumericId,
  normalizeObservedHandle,
} from '../shared/observed-x-identity'
import type { ActiveXAccountReport } from '../shared/proof-composer'

export function detectActiveAccountHandle(
  doc: Document = document,
): string | undefined {
  const selectors = [
    'a[data-testid="AppTabBar_Profile_Link"]',
    'a[data-testid="AppTabBar_Profile_Link"][href]',
    '[data-testid="SideNav_AccountSwitcher_Button"] a[href^="/"]',
    'a[aria-label][href^="/"][role="link"]',
  ]

  for (const selector of selectors) {
    for (const link of doc.querySelectorAll<HTMLAnchorElement>(selector)) {
      const handle = handleFromProfileHref(link.getAttribute('href'))
      if (handle) return handle
    }
  }

  const switcher = doc.querySelector<HTMLElement>(
    '[data-testid="SideNav_AccountSwitcher_Button"]',
  )
  const labeled =
    switcher?.getAttribute('aria-label') ??
    switcher?.querySelector('[aria-label]')?.getAttribute('aria-label')
  if (labeled) {
    const match = labeled.match(/@([A-Za-z0-9_]{1,15})/)
    if (match) return normalizeObservedHandle(match[1])
  }

  return undefined
}

export function handleFromProfileHref(
  href: string | null | undefined,
): string | undefined {
  if (!href) return undefined
  try {
    const path = href.startsWith('http')
      ? new URL(href).pathname
      : href.split('?')[0] ?? href
    const segment = path.replace(/^\//, '').split('/')[0]
    if (
      !segment ||
      [
        'home',
        'explore',
        'notifications',
        'messages',
        'i',
        'settings',
        'search',
        'compose',
      ].includes(segment.toLowerCase())
    ) {
      return undefined
    }
    return normalizeObservedHandle(segment)
  } catch {
    return undefined
  }
}

/**
 * Logged-in numeric user ID from X's `twid` cookie (`u=<id>` / `u%3D<id>`).
 * Standard approach used by X browser extensions; never returns cookie material.
 */
export function twitterIdFromTwidCookie(
  cookieSource: string =
    typeof document !== 'undefined' ? document.cookie : '',
): string | undefined {
  if (!cookieSource) return undefined
  for (const part of cookieSource.split(';')) {
    const trimmed = part.trim()
    if (!trimmed.toLowerCase().startsWith('twid=')) continue
    const raw = trimmed.slice(trimmed.indexOf('=') + 1)
    let decoded = raw
    try {
      decoded = decodeURIComponent(raw)
    } catch {
      decoded = raw
    }
    const cleaned = decoded.replace(/^"+|"+$/g, '')
    const match = cleaned.match(/(?:^|[?&])u=(\d{1,24})(?:&|$)/) ?? cleaned.match(/^u=(\d{1,24})$/)
    const id = match?.[1]
    if (id && isXNumericId(id)) return id
    // Values are sometimes just `"u=12345"` without query separators after decode.
    const plain = cleaned.match(/u[=:](\d{1,24})/)
    if (plain?.[1] && isXNumericId(plain[1])) return plain[1]
  }
  return undefined
}

export function resolveActiveAccount(
  identitiesByHandle: ReadonlyMap<
    string,
    { twitterId: string; handle: string; observedAt: number }
  >,
  doc: Document = document,
  now = Date.now(),
  cookieSource?: string,
): ActiveXAccountReport | undefined {
  const handle = detectActiveAccountHandle(doc)
  if (!handle) return undefined
  const identity = identitiesByHandle.get(handle)
  const fromTwid = twitterIdFromTwidCookie(
    cookieSource ??
      (typeof document !== 'undefined' ? document.cookie : ''),
  )
  const fromDom = twitterIdFromDocument(doc, handle)
  // Prefer twid: it is the signed-in account on every x.com page, including Home.
  const twitterId =
    fromTwid ??
    (identity && isXNumericId(identity.twitterId)
      ? identity.twitterId
      : fromDom)
  return {
    handle,
    detectedAt: now,
    ...(twitterId && isXNumericId(twitterId) ? { twitterId } : {}),
  }
}

/**
 * Best-effort numeric ID from Schema.org microdata / JSON-LD or /i/user/{id}
 * links on the current page (often present on own profile).
 */
export function twitterIdFromDocument(
  doc: Document,
  expectedHandle?: string,
): string | undefined {
  const person = doc.querySelector(
    '[itemtype="https://schema.org/Person"], [itemType="https://schema.org/Person"]',
  )
  if (person) {
    const nameMeta =
      person.querySelector('meta[itemprop="additionalName"], meta[itemProp="additionalName"]') ??
      person.querySelector('meta[itemprop="name"], meta[itemProp="name"]')
    const name = nameMeta?.getAttribute('content')
    const normalizedName = name
      ? normalizeObservedHandle(name.replace(/^@/, ''))
      : undefined
    if (!expectedHandle || !normalizedName || normalizedName === expectedHandle) {
      const idMeta = person.querySelector(
        'meta[itemprop="identifier"], meta[itemProp="identifier"]',
      )
      const id = idMeta?.getAttribute('content')
      if (id && isXNumericId(id)) return id
    }
  }

  for (const script of doc.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
    const text = script.textContent?.trim()
    if (!text) continue
    try {
      const parsed: unknown = JSON.parse(text)
      const id = twitterIdFromJsonLd(parsed, expectedHandle)
      if (id) return id
    } catch {
      /* ignore bad JSON-LD */
    }
  }

  for (const link of doc.querySelectorAll<HTMLAnchorElement>(
    'a[href*="/i/user/"]',
  )) {
    const match = link.getAttribute('href')?.match(/\/i\/user\/(\d{1,20})/)
    if (!match?.[1] || !isXNumericId(match[1])) continue
    if (!expectedHandle) return match[1]
    if (userLinkAssociatedWithHandle(link, expectedHandle)) return match[1]
  }
  return undefined
}

/** True when an /i/user/{id} link is near a profile link for `expectedHandle`. */
function userLinkAssociatedWithHandle(
  link: HTMLAnchorElement,
  expectedHandle: string,
): boolean {
  const expected = normalizeObservedHandle(expectedHandle)
  let container: Element | null = link.parentElement
  for (let depth = 0; depth < 5 && container; depth += 1) {
    // Stop once the container spans multiple /i/user/ links — too broad.
    if (container.querySelectorAll('a[href*="/i/user/"]').length > 1) {
      return false
    }
    for (const anchor of container.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href')
      if (href?.includes('/i/user/')) continue
      const handle = handleFromProfileHref(href)
      if (handle === expected) return true
    }
    container = container.parentElement
  }
  return false
}

function twitterIdFromJsonLd(
  value: unknown,
  expectedHandle?: string,
): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const entry of value) {
      const id = twitterIdFromJsonLd(entry, expectedHandle)
      if (id) return id
    }
    return undefined
  }
  const record = value as Record<string, unknown>
  if (record['@graph']) {
    return twitterIdFromJsonLd(record['@graph'], expectedHandle)
  }
  const identifier = record.identifier
  if (typeof identifier === 'string' && isXNumericId(identifier)) {
    const name =
      typeof record.additionalName === 'string'
        ? normalizeObservedHandle(record.additionalName)
        : typeof record.name === 'string'
          ? normalizeObservedHandle(record.name.replace(/^@/, ''))
          : undefined
    if (!expectedHandle || !name || name === expectedHandle) return identifier
  }
  if (record.author) {
    const id = twitterIdFromJsonLd(record.author, expectedHandle)
    if (id) return id
  }
  if (record.mainEntity) {
    const id = twitterIdFromJsonLd(record.mainEntity, expectedHandle)
    if (id) return id
  }
  return undefined
}
