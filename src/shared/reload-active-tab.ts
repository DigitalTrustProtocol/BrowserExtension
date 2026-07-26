import browser from './browser.ts'

/**
 * Reload the active tab only when content scripts are not reachable.
 * Prefer {@link reactivateOrReloadActiveTab} so reconnects wake an
 * already-injected script instead of wiping the page.
 */
export async function reloadActiveTabAfterConnect(): Promise<void> {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true })
    const tabId = tabs[0]?.id
    if (tabId !== undefined) await browser.tabs.reload(tabId)
  } catch {
    // Ignore chrome:// and other restricted pages.
  }
}
