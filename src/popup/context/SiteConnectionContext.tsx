import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import browser from '@shared/browser.ts'
import { rpc } from '@shared/rpc.ts'
import { getDomainFromUrl } from '@shared/url.ts'
import { reactivateOrReloadActiveTab } from '@shared/reactivate-active-tab.ts'
import { isXProductHost } from '@shared/x-host-autoconnect.ts'

export type SiteUiState =
  | 'loading'
  | 'empty'
  | 'notConnected'
  | 'connected'
  | 'error'

interface SiteConnectionContextValue {
  domain: string | null
  /** Resolved browsing-tab URL (not the side-panel document). */
  tabUrl: string | null
  siteState: SiteUiState
  /** null while the first resolution is in flight (globe dot stays neutral). */
  connected: boolean | null
  reload: (options?: { soft?: boolean }) => Promise<void>
  connect: () => Promise<void>
  disconnect: (domain?: string) => Promise<void>
}

const SiteConnectionContext = createContext<SiteConnectionContextValue | null>(
  null,
)

function isRestrictedTabUrl(url: string): boolean {
  return (
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('moz-extension://') ||
    url.startsWith('chrome-extension://')
  )
}

/**
 * Prefer the focused browsing tab. When the side panel HTML is opened as its
 * own tab (inspect), active may be restricted — fall back to an X tab in this
 * window, else the first http(s) tab.
 */
async function resolveSiteTab(): Promise<
  { url?: string } | undefined
> {
  const [active] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  })
  if (active?.url && !isRestrictedTabUrl(active.url)) return active

  const inWindow = await browser.tabs.query({ currentWindow: true })
  const httpTabs = inWindow.filter(
    (tab) => tab.url && !isRestrictedTabUrl(tab.url),
  )
  const xTab = httpTabs.find((tab) => {
    try {
      return isXProductHost(new URL(tab.url!).hostname)
    } catch {
      return false
    }
  })
  return xTab ?? httpTabs[0]
}

interface SiteConnectionProviderProps {
  children: ReactNode
}

export function SiteConnectionProvider({
  children,
}: SiteConnectionProviderProps) {
  const [domain, setDomain] = useState<string | null>(null)
  const [tabUrl, setTabUrl] = useState<string | null>(null)
  const [siteState, setSiteState] = useState<SiteUiState>('loading')

  const reload = useCallback(async (options?: { soft?: boolean }) => {
    if (!options?.soft) setSiteState('loading')
    let resolvedDomain: string | null = null
    try {
      const tab = await resolveSiteTab()
      if (!tab?.url) {
        setDomain(null)
        setTabUrl(null)
        setSiteState('empty')
        return
      }

      const nextDomain = getDomainFromUrl(tab.url)
      if (!nextDomain || isRestrictedTabUrl(tab.url)) {
        setDomain(null)
        setTabUrl(null)
        setSiteState('empty')
        return
      }
      resolvedDomain = nextDomain
      setDomain(nextDomain)
      setTabUrl(tab.url)

      try {
        const autoConnected = await rpc<boolean>('maybeAutoConnectXHost', {
          domain: nextDomain,
        })
        if (autoConnected) {
          void reactivateOrReloadActiveTab()
          setSiteState('connected')
          return
        }
      } catch {
        /* ignore */
      }

      const allowed = await rpc<string[]>('getAllowedDomains').catch(() => null)
      if (allowed === null) {
        setSiteState('error')
        return
      }
      setSiteState(allowed.includes(nextDomain) ? 'connected' : 'notConnected')
    } catch {
      setSiteState(resolvedDomain ? 'error' : 'empty')
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    function onChange(
      changes: Record<string, unknown>,
      area: string,
    ) {
      if (
        area === 'local' &&
        (changes as { allowedDomains?: unknown }).allowedDomains
      ) {
        void reload({ soft: true })
      }
    }
    browser.storage.onChanged.addListener(onChange)
    return () => browser.storage.onChanged.removeListener(onChange)
  }, [reload])

  useEffect(() => {
    const softReload = () => {
      void reload({ soft: true })
    }
    const onActivated = () => softReload()
    const onUpdated = (
      _tabId: number,
      changeInfo: { url?: string; status?: string },
    ) => {
      if (changeInfo.url || changeInfo.status === 'complete') softReload()
    }
    const onFocusChanged = (windowId: number) => {
      if (windowId !== browser.windows.WINDOW_ID_NONE) softReload()
    }

    browser.tabs.onActivated.addListener(onActivated)
    browser.tabs.onUpdated.addListener(onUpdated)
    browser.windows?.onFocusChanged?.addListener?.(onFocusChanged)
    return () => {
      browser.tabs.onActivated.removeListener(onActivated)
      browser.tabs.onUpdated.removeListener(onUpdated)
      browser.windows?.onFocusChanged?.removeListener?.(onFocusChanged)
    }
  }, [reload])

  const connect = useCallback(async () => {
    if (!domain) return
    try {
      const granted = await browser.permissions.request({
        origins: [`*://${domain}/*`],
      })
      if (!granted) return
    } catch {
      return
    }
    await Promise.all([
      rpc('addAllowedDomain', { domain }),
      rpc('setIdentityDisabled', { domain, disabled: false }),
    ])
    setSiteState('connected')
    await reactivateOrReloadActiveTab()
  }, [domain])

  const disconnect = useCallback(
    async (targetDomain?: string) => {
      const d = targetDomain ?? domain
      if (!d) return
      await Promise.all([
        rpc('removeAllowedDomain', { domain: d }),
        rpc('setIdentityDisabled', { domain: d, disabled: true }),
      ])
      await browser.permissions
        .remove({ origins: [`*://${d}/*`] })
        .catch(() => {})
      if (d === domain) setSiteState('notConnected')
    },
    [domain],
  )

  const connected = useMemo(() => {
    if (siteState === 'loading') return null
    if (siteState === 'empty' || siteState === 'error') return false
    return siteState === 'connected'
  }, [siteState])

  const value = useMemo(
    () => ({
      domain,
      tabUrl,
      siteState,
      connected,
      reload,
      connect,
      disconnect,
    }),
    [domain, tabUrl, siteState, connected, reload, connect, disconnect],
  )

  return (
    <SiteConnectionContext.Provider value={value}>
      {children}
    </SiteConnectionContext.Provider>
  )
}

export function useSiteConnection(): SiteConnectionContextValue {
  const ctx = useContext(SiteConnectionContext)
  if (!ctx) {
    throw new Error('useSiteConnection must be used within SiteConnectionProvider')
  }
  return ctx
}
