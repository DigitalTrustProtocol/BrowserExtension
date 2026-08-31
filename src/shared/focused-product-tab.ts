/**
 * Canonical focused browsing-tab selector for panel routing.
 * Does not pick an arbitrary X tab in the window.
 *
 * @module shared/focused-product-tab
 */

import { getDomainFromUrl } from './url.ts'
import { isXProductHost } from './x-host-autoconnect.ts'

export const FOCUSED_PRODUCT_TAB_SESSION_KEY = 'attentionxFocusedProductTab'

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

function fromTab(tab: BrowsingTab): FocusedProductTab | null {
  if (!tab.url || isRestrictedTabUrl(tab.url)) return null
  const domain = getDomainFromUrl(tab.url)
  if (!domain) return null
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
 * Restricted / extension tabs fall back to lastFocusedWindow's active tab.
 */
export function selectFocusedProductTab(input: {
  currentWindowActive?: BrowsingTab | null
  lastFocusedWindowActive?: BrowsingTab | null
}): FocusedProductTab {
  const current = input.currentWindowActive
  if (current?.url) {
    const resolved = fromTab(current)
    if (resolved) return resolved
  }
  const last = input.lastFocusedWindowActive
  if (last?.url) {
    const resolved = fromTab(last)
    if (resolved) return resolved
  }
  return { kind: 'none' }
}
