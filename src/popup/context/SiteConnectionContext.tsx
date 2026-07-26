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

export type SiteUiState =
  | 'loading'
  | 'empty'
  | 'notConnected'
  | 'connected'
  | 'error'

interface SiteConnectionContextValue {
  domain: string | null
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

interface SiteConnectionProviderProps {
  children: ReactNode
}

export function SiteConnectionProvider({
  children,
}: SiteConnectionProviderProps) {
  const [domain, setDomain] = useState<string | null>(null)
  const [siteState, setSiteState] = useState<SiteUiState>('loading')

  const reload = useCallback(async (options?: { soft?: boolean }) => {
    if (!options?.soft) setSiteState('loading')
    let resolvedDomain: string | null = null
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      })
      const tab = tabs[0]
      if (!tab?.url) {
        setDomain(null)
        setSiteState('empty')
        return
      }

      const nextDomain = getDomainFromUrl(tab.url)
      if (!nextDomain || isRestrictedTabUrl(tab.url)) {
        setDomain(null)
        setSiteState('empty')
        return
      }
      resolvedDomain = nextDomain
      setDomain(nextDomain)

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
    // Content scripts on x.com are already injected — wake them instead of reloading.
    await reactivateOrReloadActiveTab()
  }, [domain])

  const disconnect = useCallback(
    async (targetDomain?: string) => {
      const d = targetDomain ?? domain
      if (!d) return
      await Promise.all([
        rpc('removeAllowedDomain', { domain: d }),
        // Hide NIP-07 + page augmentations so the tab feels disconnected.
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
      siteState,
      connected,
      reload,
      connect,
      disconnect,
    }),
    [domain, siteState, connected, reload, connect, disconnect],
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
