import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import browser from '@shared/browser.ts'
import {
  isNewerRevision,
  panelSessionSnapshotFromUnknown,
  unavailablePanelSnapshot,
  type PanelSessionSnapshot,
} from '../../shared/panel-session.ts'
import { subscribeStateTopic } from '../../shared/state-topics.ts'

interface PanelSessionContextValue {
  snapshot: PanelSessionSnapshot | null
}

const PanelSessionContext = createContext<PanelSessionContextValue | null>(null)

async function fetchPanelSession(): Promise<PanelSessionSnapshot | null> {
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'GET_PANEL_SESSION',
    })) as { ok?: boolean; data?: unknown }
    if (!response?.ok) return null
    return panelSessionSnapshotFromUnknown(response.data)
  } catch {
    return null
  }
}

interface PanelSessionProviderProps {
  children: ReactNode
}

export function PanelSessionProvider({ children }: PanelSessionProviderProps) {
  const [snapshot, setSnapshot] = useState<PanelSessionSnapshot | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchPanelSession().then((next) => {
      if (cancelled) return
      setSnapshot((prev) => {
        const incoming = next ?? unavailablePanelSnapshot()
        if (!prev) return incoming
        return isNewerRevision(incoming.revision, prev.revision) ? incoming : prev
      })
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return subscribeStateTopic('panelSession', (message) => {
      const incoming = message.snapshot
      setSnapshot((prev) => {
        if (!prev) return incoming
        return isNewerRevision(incoming.revision, prev.revision)
          ? incoming
          : prev
      })
    })
  }, [])

  const value = useMemo(() => ({ snapshot }), [snapshot])

  return (
    <PanelSessionContext.Provider value={value}>
      {children}
    </PanelSessionContext.Provider>
  )
}

export function usePanelSession(): PanelSessionContextValue {
  const ctx = useContext(PanelSessionContext)
  if (!ctx) {
    throw new Error('usePanelSession must be used within PanelSessionProvider')
  }
  return ctx
}
