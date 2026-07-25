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

export function resolveActiveAccount(
  identitiesByHandle: ReadonlyMap<
    string,
    { twitterId: string; handle: string; observedAt: number }
  >,
  doc: Document = document,
  now = Date.now(),
): ActiveXAccountReport | undefined {
  const handle = detectActiveAccountHandle(doc)
  if (!handle) return undefined
  const identity = identitiesByHandle.get(handle)
  return {
    handle,
    ...(identity && isXNumericId(identity.twitterId)
      ? { twitterId: identity.twitterId }
      : {}),
    detectedAt: now,
  }
}
