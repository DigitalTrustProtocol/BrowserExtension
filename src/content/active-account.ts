import {
  isXNumericId,
  normalizeObservedHandle,
} from '../shared/observed-x-identity'
import type { ActiveXAccountReport } from '../shared/proof-composer'
import {
  normalizeXDisplayName,
  normalizeXProfileIconPath,
} from '../shared/x-profile-display'
import { twitterIdFromTwidCookie as parseTwidCookie } from '../shared/x-twid'

/** Content-script wrapper: defaults to `document.cookie`. */
export function twitterIdFromTwidCookie(
  cookieSource: string =
    typeof document !== 'undefined' ? document.cookie : '',
): string | undefined {
  return parseTwidCookie(cookieSource)
}

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
 * Public display name + avatar path from signed-in SideNav / profile chrome only.
 */
export function readActiveAccountProfile(
  doc: Document = document,
  expectedHandle?: string,
): { displayName?: string; iconPath?: string } {
  const roots = collectActiveAccountChromeRoots(doc)
  let displayName: string | undefined
  let iconPath: string | undefined

  for (const root of roots) {
    if (!iconPath) {
      for (const img of root.querySelectorAll<HTMLImageElement>(
        'img[src*="pbs.twimg.com/profile_images/"]',
      )) {
        const src = img.getAttribute('src') ?? img.src
        const path = src ? normalizeXProfileIconPath(src) : undefined
        if (path) {
          iconPath = path
          break
        }
      }
    }

    if (!displayName) {
      displayName = readDisplayNameFromChromeRoot(root, expectedHandle)
    }

    if (displayName && iconPath) break
  }

  return {
    ...(displayName ? { displayName } : {}),
    ...(iconPath ? { iconPath } : {}),
  }
}

/**
 * SideNav root aria-label is often the generic "Account menu"; the public
 * display name lives on nested labels, avatar alt, or visible Name/@handle text.
 */
function readDisplayNameFromChromeRoot(
  root: HTMLElement,
  expectedHandle?: string,
): string | undefined {
  const candidates: string[] = []
  const push = (value: string | null | undefined) => {
    const trimmed = value?.trim()
    if (trimmed) candidates.push(trimmed)
  }

  push(root.getAttribute('aria-label'))
  for (const el of root.querySelectorAll('[aria-label]')) {
    push(el.getAttribute('aria-label'))
  }
  for (const img of root.querySelectorAll<HTMLImageElement>(
    'img[src*="pbs.twimg.com/profile_images/"]',
  )) {
    push(img.getAttribute('alt'))
  }
  push(root.innerText)

  for (const candidate of candidates) {
    const fromLabel = displayNameFromAriaLabel(candidate, expectedHandle)
    if (fromLabel) return fromLabel
    const fromVisible = displayNameFromVisibleText(candidate, expectedHandle)
    if (fromVisible) return fromVisible
  }
  return undefined
}

/** "Digital Trust Protocol\\n@TrustProtocol" / "Name @handle" lines. */
function displayNameFromVisibleText(
  text: string,
  expectedHandle?: string,
): string | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length >= 2) {
    const handleLine = lines.find((line) =>
      /^@?[A-Za-z0-9_]{1,15}$/.test(line),
    )
    const nameLine = lines.find((line) => line !== handleLine)
    if (nameLine && handleLine) {
      const handle = normalizeObservedHandle(handleLine.replace(/^@/, ''))
      if (expectedHandle && handle && handle !== expectedHandle) {
        return undefined
      }
      if (!/^(account menu|profile|accounts?)$/i.test(nameLine)) {
        return normalizeXDisplayName(nameLine)
      }
    }
  }
  return undefined
}

function collectActiveAccountChromeRoots(doc: Document): HTMLElement[] {
  const roots: HTMLElement[] = []
  const push = (el: Element | null | undefined) => {
    if (el instanceof HTMLElement && !roots.includes(el)) roots.push(el)
  }
  push(doc.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]'))
  push(doc.querySelector('a[data-testid="AppTabBar_Profile_Link"]'))
  return roots
}

function displayNameFromAriaLabel(
  labeled: string | null | undefined,
  expectedHandle?: string,
): string | undefined {
  if (!labeled) return undefined
  const trimmed = labeled.trim()
  if (!trimmed) return undefined

  // Common patterns: "Account menu" / "Profile" — not a display name.
  if (/^(account menu|profile|accounts?)$/i.test(trimmed)) return undefined

  // "NASA @NASA" / "Display Name (@handle)"
  const withAt = trimmed.match(
    /^(.+?)\s+\(?@([A-Za-z0-9_]{1,15})\)?\s*$/,
  )
  if (withAt?.[1] && withAt[2]) {
    const handle = normalizeObservedHandle(withAt[2])
    if (expectedHandle && handle && handle !== expectedHandle) return undefined
    return normalizeXDisplayName(withAt[1])
  }

  // Bare @handle — not a display name.
  if (/^@?[A-Za-z0-9_]{1,15}$/.test(trimmed)) return undefined

  if (expectedHandle) {
    const handleToken = `@${expectedHandle}`
    if (trimmed.toLowerCase() === handleToken) return undefined
  }

  return normalizeXDisplayName(trimmed)
}

export function resolveActiveAccount(
  _identitiesByHandle: ReadonlyMap<
    string,
    { twitterId: string; handle: string; observedAt: number }
  >,
  doc: Document = document,
  now = Date.now(),
  cookieSource?: string,
): ActiveXAccountReport | undefined {
  const handle = detectActiveAccountHandle(doc)
  if (!handle) return undefined
  const fromTwid = twitterIdFromTwidCookie(
    cookieSource ??
      (typeof document !== 'undefined' ? document.cookie : ''),
  )
  const fromDom = twitterIdFromDocument(doc, handle)
  // Prefer twid (signed-in cookie). Fall back to DOM/Schema.org only — never
  // observation-map IDs, which can be forged via page-world messages.
  const twitterId = fromTwid ?? fromDom
  const profile = readActiveAccountProfile(doc, handle)
  return {
    handle,
    detectedAt: now,
    ...(twitterId && isXNumericId(twitterId) ? { twitterId } : {}),
    ...profile,
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

/** Stable key for content-script report dedupe (handle + id + profile). */
export function activeAccountReportKey(
  account: Pick<
    ActiveXAccountReport,
    'handle' | 'twitterId' | 'displayName' | 'iconPath'
  >,
): string {
  return [
    account.handle,
    account.twitterId ?? '',
    account.displayName ?? '',
    account.iconPath ?? '',
  ].join('\0')
}

/** True when a prior report for this handle already included a numeric id. */
export function previousReportHadTwitterId(
  previousKey: string,
  handle: string,
): boolean {
  if (!previousKey.startsWith(`${handle}\0`)) return false
  const rest = previousKey.slice(handle.length + 1)
  const id = rest.split('\0')[0] ?? ''
  return isXNumericId(id)
}
