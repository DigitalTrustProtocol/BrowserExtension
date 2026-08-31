/**
 * In-memory + session-backed focused product tab for panel routing.
 *
 * @module background/focused-tab-cache
 */

import {
  FOCUSED_PRODUCT_TAB_SESSION_KEY,
  selectFocusedProductTab,
  type BrowsingTab,
  type FocusedProductTab,
} from '../shared/focused-product-tab.ts'

let cached: FocusedProductTab | null = null

export function getCachedFocusedProductTab(): FocusedProductTab | null {
  return cached
}

export function setCachedFocusedProductTab(next: FocusedProductTab): void {
  cached = next
}

export function clearCachedFocusedProductTab(): void {
  cached = null
}

function tabFromChrome(
  tab: chrome.tabs.Tab | undefined,
): BrowsingTab | null {
  if (typeof tab?.id !== 'number') return null
  if (typeof tab.url !== 'string' || !tab.url) return null
  return {
    id: tab.id,
    windowId: typeof tab.windowId === 'number' ? tab.windowId : 0,
    url: tab.url,
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
  const next = selectFocusedProductTab({
    currentWindowActive: tabFromChrome(current),
    lastFocusedWindowActive: tabFromChrome(lastFocused),
  })
  if (next.kind === 'ok') {
    cached = next
    try {
      await chrome.storage.session.set({
        [FOCUSED_PRODUCT_TAB_SESSION_KEY]: next,
      })
    } catch {
      /* session unavailable */
    }
    return next
  }
  const previous = await restoreFocusedProductTabFromSession()
  if (previous?.kind === 'ok') return previous
  cached = next
  try {
    await chrome.storage.session.set({
      [FOCUSED_PRODUCT_TAB_SESSION_KEY]: next,
    })
  } catch {
    /* session unavailable */
  }
  return next
}

export async function restoreFocusedProductTabFromSession(): Promise<FocusedProductTab | null> {
  if (cached) return cached
  try {
    const stored = await chrome.storage.session.get(
      FOCUSED_PRODUCT_TAB_SESSION_KEY,
    )
    const raw = stored[FOCUSED_PRODUCT_TAB_SESSION_KEY]
    if (!raw || typeof raw !== 'object') return null
    const row = raw as Record<string, unknown>
    if (row.kind === 'none') {
      cached = { kind: 'none' }
      return cached
    }
    if (
      row.kind === 'ok' &&
      typeof row.tabId === 'number' &&
      typeof row.windowId === 'number' &&
      typeof row.url === 'string' &&
      typeof row.domain === 'string'
    ) {
      cached = {
        kind: 'ok',
        tabId: row.tabId,
        windowId: row.windowId,
        url: row.url,
        domain: row.domain,
        isX: row.isX === true,
      }
      return cached
    }
  } catch {
    /* ignore */
  }
  return null
}
