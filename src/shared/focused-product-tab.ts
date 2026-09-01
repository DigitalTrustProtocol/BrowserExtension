/**
 * Canonical focused browsing-tab selector for panel routing.
 * Does not pick an arbitrary X tab in the window.
 *
 * @module shared/focused-product-tab
 */

import { getDomainFromUrl } from './url.ts'
import { isXProductHost } from './x-host-autoconnect.ts'

export const FOCUSED_PRODUCT_TAB_SESSION_KEY = 'attentionxFocusedProductTab'

/** Last X product tab. Used while Application / Graph / Path / prompt are focused. */
export const LAST_X_PRODUCT_TAB_SESSION_KEY = 'attentionxLastXProductTab'

export function isRestrictedTabUrl(url: string): boolean {
  return (
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('moz-extension://') ||
    url.startsWith('chrome-extension://')
  )
}

export interface BrowsingTab {
  id: number
  windowId: number
  url: string
}

export type FocusedProductTab =
  | { kind: 'none' }
  | {
      kind: 'ok'
      tabId: number
      windowId: number
      url: string
      domain: string
      isX: boolean
    }

/** Restricted URLs are not a browsing tab; empty / http(s) URLs are. */
export function resolveBrowsingTab(tab: BrowsingTab): FocusedProductTab | null {
  if (tab.url && isRestrictedTabUrl(tab.url)) return null
  if (!tab.url) {
    return {
      kind: 'ok',
      tabId: tab.id,
      windowId: tab.windowId,
      url: '',
      domain: '',
      isX: false,
    }
  }
  const domain = getDomainFromUrl(tab.url)
  if (!domain) {
    return {
      kind: 'ok',
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url,
      domain: '',
      isX: false,
    }
  }
  return {
    kind: 'ok',
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    domain,
    isX: isXProductHost(domain),
  }
}

/**
 * Prefer the current-window active tab. A real non-X http(s) page is off-X.
 * Restricted / extension tabs are not browsing tabs (`null`) — the cache
 * restores the last X product tab instead.
 * Tabs whose URL is hidden (no `tabs` permission) are off-X when they are
 * not our own extension page.
 */
export function selectFocusedProductTab(input: {
  currentWindowActive?: BrowsingTab | null
  lastFocusedWindowActive?: BrowsingTab | null
}): FocusedProductTab {
  const current = input.currentWindowActive
  if (current && typeof current.id === 'number') {
    const resolved = resolveBrowsingTab(current)
    if (resolved) return resolved
  }
  const last = input.lastFocusedWindowActive
  if (last && typeof last.id === 'number') {
    const resolved = resolveBrowsingTab(last)
    if (resolved) return resolved
  }
  return { kind: 'none' }
}
