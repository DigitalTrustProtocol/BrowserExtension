/**
 * In-memory + session-backed focused product tab for panel routing.
 * Extension application pages (Application, Graph, Path, prompt) and tabs
 * whose URL is unreadable (new tab / NTP, chrome://, permission-stripped)
 * keep the last X product tab in focus. Only a readable non-X http(s) page
 * is off-X.
 *
 * @module background/focused-tab-cache
 */

import {
  FOCUSED_PRODUCT_TAB_SESSION_KEY,
  LAST_X_PRODUCT_TAB_SESSION_KEY,
  isRestrictedTabUrl,
  resolveBrowsingTab,
  selectFocusedProductTab,
  type BrowsingTab,
  type FocusedProductTab,
} from '../shared/focused-product-tab.ts'

type XProductTab = Extract<FocusedProductTab, { kind: 'ok' }>

let cached: FocusedProductTab | null = null
let lastXTab: XProductTab | null = null

export function getCachedFocusedProductTab(): FocusedProductTab | null {
  return cached
}

export function setCachedFocusedProductTab(next: FocusedProductTab): void {
  cached = next
  if (next.kind === 'ok' && next.isX) lastXTab = next
}

export function clearCachedFocusedProductTab(): void {
  cached = null
  lastXTab = null
}

function tabFromChrome(
  tab: chrome.tabs.Tab | undefined,
): BrowsingTab | null {
  if (typeof tab?.id !== 'number') return null
  return {
    id: tab.id,
    windowId: typeof tab.windowId === 'number' ? tab.windowId : 0,
    url: typeof tab.url === 'string' ? tab.url : '',
  }
}

function asXProductTab(tab: FocusedProductTab | null): XProductTab | null {
  if (tab?.kind === 'ok' && tab.isX) return tab
  return null
}

/**
 * Extension pages, chrome://, NTP, permission-stripped tabs — an unreadable
 * or restricted URL is not a browsing domain: restore the last X product
 * tab. Only a readable non-X http(s) page is off-X.
 */
function shouldRestoreLastXTab(tab: chrome.tabs.Tab | undefined): boolean {
  if (typeof tab?.id !== 'number') return false
  const url = typeof tab.url === 'string' ? tab.url : ''
  if (!url) return true
  return isRestrictedTabUrl(url)
}

async function persistFocused(next: FocusedProductTab): Promise<FocusedProductTab> {
  cached = next
  const items: Record<string, unknown> = {
    [FOCUSED_PRODUCT_TAB_SESSION_KEY]: next,
  }
  if (next.kind === 'ok' && next.isX) {
    lastXTab = next
    items[LAST_X_PRODUCT_TAB_SESSION_KEY] = next
  }
  try {
    await chrome.storage.session.set(items)
  } catch {
    /* session unavailable */
  }
  return next
}

async function loadLastXProductTab(): Promise<XProductTab | null> {
  const fromMemory = asXProductTab(lastXTab)
  if (fromMemory) return fromMemory
  try {
    const stored = await chrome.storage.session.get([
      LAST_X_PRODUCT_TAB_SESSION_KEY,
      FOCUSED_PRODUCT_TAB_SESSION_KEY,
    ])
    return (
      asXProductTab(parseStoredFocusedTab(stored[LAST_X_PRODUCT_TAB_SESSION_KEY])) ??
      asXProductTab(parseStoredFocusedTab(stored[FOCUSED_PRODUCT_TAB_SESSION_KEY]))
    )
  } catch {
    return null
  }
}

async function findLiveTab(tabId: number): Promise<chrome.tabs.Tab | undefined> {
  const all = await chrome.tabs.query({})
  const fromAll = all.find((tab) => tab.id === tabId)
  if (fromAll) return fromAll
  const xTabs = await chrome.tabs.query({
    url: [
      '*://x.com/*',
      '*://www.x.com/*',
      '*://twitter.com/*',
      '*://www.twitter.com/*',
    ],
  })
  return xTabs.find((tab) => tab.id === tabId)
}

async function restoreLastXProductTab(): Promise<XProductTab | null> {
  const candidate = await loadLastXProductTab()
  if (!candidate) return null
  try {
    const tab = await findLiveTab(candidate.tabId)
    if (!tab) {
      lastXTab = null
      return null
    }
    const browsing = tabFromChrome(tab)
    const resolved = browsing ? resolveBrowsingTab(browsing) : null
    if (resolved?.kind === 'ok' && resolved.isX) {
      lastXTab = resolved
      return resolved
    }
    lastXTab = candidate
    return candidate
  } catch {
    return candidate
  }
}

export async function hydrateFocusedProductTab(): Promise<FocusedProductTab> {
  const [current] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  })
  const [lastFocused] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })
  const active = current ?? lastFocused
  if (shouldRestoreLastXTab(active)) {
    const x = await restoreLastXProductTab()
    if (x) return persistFocused(x)
    return persistFocused({ kind: 'none' })
  }
  const next = selectFocusedProductTab({
    currentWindowActive: tabFromChrome(current),
    lastFocusedWindowActive: tabFromChrome(lastFocused),
  })
  return persistFocused(next)
}

function parseStoredFocusedTab(raw: unknown): FocusedProductTab | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (row.kind === 'none') return { kind: 'none' }
  if (
    row.kind === 'ok' &&
    typeof row.tabId === 'number' &&
    typeof row.windowId === 'number' &&
    typeof row.url === 'string' &&
    typeof row.domain === 'string'
  ) {
    return {
      kind: 'ok',
      tabId: row.tabId,
      windowId: row.windowId,
      url: row.url,
      domain: row.domain,
      isX: row.isX === true,
    }
  }
  return null
}
