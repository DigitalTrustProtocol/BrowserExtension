import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import browser from '@shared/browser.ts'
import { BACKGROUND_API_VERSION } from '../../shared/contracts.ts'
import {
  VIEWER_CHANGED_MESSAGE,
  parseViewerState,
  type ViewerState,
} from '../../shared/session-actor.ts'

interface ViewerContextValue {
  viewer: ViewerState | null
}

const ViewerContext = createContext<ViewerContextValue | null>(null)

async function fetchViewer(): Promise<ViewerState | null> {
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'GET_VIEWER',
      version: BACKGROUND_API_VERSION,
    })) as { ok?: boolean; data?: unknown }
    if (!response?.ok) return null
    return parseViewerState(response.data)
  } catch {
    return null
  }
}

interface ViewerProviderProps {
  children: ReactNode
}

export function ViewerProvider({ children }: ViewerProviderProps) {
  const [viewer, setViewer] = useState<ViewerState | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchViewer().then((next) => {
      if (cancelled) return
      setViewer(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    function onMessage(message: { type?: string }) {
      if (message?.type !== VIEWER_CHANGED_MESSAGE) return
      const next = parseViewerState(message)
      if (!next) return
      setViewer(next)
    }
    browser.runtime.onMessage.addListener(onMessage)
    return () => browser.runtime.onMessage.removeListener(onMessage)
  }, [])

  const value = useMemo(() => ({ viewer }), [viewer])

  return (
    <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>
  )
}

export function useViewer(): ViewerContextValue {
  const ctx = useContext(ViewerContext)
  if (!ctx) {
    throw new Error('useViewer must be used within ViewerProvider')
  }
  return ctx
}
