import browser from './browser.ts'
import { reloadActiveTabAfterConnect } from './reload-active-tab.ts'

/**
 * After allowlisting / re-enabling a site: prefer waking an already-injected
 * content script instead of reloading the tab. Reload only if the ping fails
 * (script never attached — e.g. brand-new optional host grant).
 */
export async function reactivateOrReloadActiveTab(): Promise<'reactivated' | 'reloaded' | 'skipped'> {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true })
    const tab = tabs[0]
    if (!tab?.id || !tab.url) return 'skipped'
    if (
      tab.url.startsWith('chrome://') ||
      tab.url.startsWith('edge://') ||
      tab.url.startsWith('about:') ||
      tab.url.startsWith('chrome-extension://') ||
      tab.url.startsWith('moz-extension://')
    ) {
      return 'skipped'
    }

    try {
      await browser.tabs.sendMessage(tab.id, { type: 'ATTENTIONX_REACTIVATE' })
      return 'reactivated'
    } catch {
      await reloadActiveTabAfterConnect()
      return 'reloaded'
    }
  } catch {
    return 'skipped'
  }
}
