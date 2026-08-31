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
import {
  isRestrictedTabUrl,
  selectFocusedProductTab,
} from '@shared/focused-product-tab.ts'
import { usePanelSession } from './PanelSessionContext'

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

async function resolveSiteTab(): Promise<
  { url?: string } | undefined
> {
  const [active] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  })
  const [lastFocused] = await browser.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })
  const focused = selectFocusedProductTab({
    currentWindowActive:
      typeof active?.id === 'number' &&
      typeof active.windowId === 'number' &&
      typeof active.url === 'string'
        ? { id: active.id, windowId: active.windowId, url: active.url }
        : null,
    lastFocusedWindowActive:
      typeof lastFocused?.id === 'number' &&
      typeof lastFocused.windowId === 'number' &&
      typeof lastFocused.url === 'string'
        ? {
            id: lastFocused.id,
            windowId: lastFocused.windowId,
            url: lastFocused.url,
          }
        : null,
  })
  if (focused.kind !== 'ok') return undefined
  return { url: focused.url }
}

interface SiteConnectionProviderProps {
  children: ReactNode
}

export function SiteConnectionProvider({
  children,
}: SiteConnectionProviderProps) {
  const { snapshot } = usePanelSession()
  const [domain, setDomain] = useState<string | null>(null)
  const [tabUrl, setTabUrl] = useState<string | null>(null)
  const [siteState, setSiteState] = useState<SiteUiState>('loading')

  useEffect(() => {
    if (!snapshot) return
    switch (snapshot.site.kind) {
      case 'unavailable':
        setDomain(null)
        setTabUrl(null)
        setSiteState('empty')
        return
      case 'error':
        setDomain(snapshot.site.domain ?? null)
        setTabUrl(snapshot.site.url ?? null)
        setSiteState('error')
        return
      case 'disconnected':
        setDomain(snapshot.site.domain)
        setTabUrl(snapshot.site.url)
        setSiteState('notConnected')
        return
      case 'connected':
        setDomain(snapshot.site.domain)
        setTabUrl(snapshot.site.url)
        setSiteState('connected')
        return
      default: {
        const _exhaustive: never = snapshot.site
        return _exhaustive
      }
    }
  }, [snapshot])

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
    if (!snapshot) return null
    if (siteState === 'loading') return null
    if (siteState === 'empty' || siteState === 'error') return false
    return siteState === 'connected'
  }, [snapshot, siteState])

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
