import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../../lib/i18n'
import type { TrustSubject } from '../../graph'
import {
  buildGraphPageUrl,
  isGraphFocusMessage,
  isGraphViewMessage,
  parseNodeId,
  subjectNodeId,
  type GraphDeepLink,
  type GraphViewMessage,
} from '../../shared/graph-deeplink'
import {
  isPageColorScheme,
  resolveGraphColorScheme,
  systemColorScheme,
  X_PAGE_COLOR_SCHEME_KEY,
  type PageColorScheme,
} from '../../shared/page-color-scheme'
import GraphNeighborhoodView from '../graph/GraphNeighborhoodView'
import GraphSettingsOverlay from '../graph/GraphSettingsOverlay'
import PathEvidenceView from '../graph/PathEvidenceView'
import {
  labelFromXIdentityDisplay,
  pictureFromXIdentityDisplay,
} from '../graph/graph-display'
import {
  closeGraphPage,
  loadActiveXAccount,
  openSidePanel,
} from '../graph/graph-rpc'
import {
  EMPTY_GRAPH_VIEW_SNAPSHOT,
  type GraphViewHandle,
  type GraphViewSnapshot,
} from '../graph/graph-view-types'
import {
  graphViewRefreshToken,
  isTrustGraphUpdatedMessage,
} from '../graph/graph-stale'
import {
  DEFAULT_GRAPH_VIEW_SETTINGS,
  GRAPH_VIEW_SETTINGS_KEY,
  normalizeGraphViewSettings,
  type GraphViewSettings,
  type GraphVizNode,
} from '../graph/types'
import { IconChevronRight, IconMoon, IconSun } from '../../assets'
import styles from '../graph/GraphPage.module.css'

export interface GraphPageProps {
  refreshToken: number
  deepLink?: GraphDeepLink
  fullscreen?: boolean
}

function initialFocusId(deepLink?: GraphDeepLink): string | undefined {
  return (
    deepLink?.focus ??
    (deepLink?.subject ? subjectNodeId(deepLink.subject) : undefined)
  )
}

export default function GraphPage({
  refreshToken,
  deepLink,
  fullscreen = false,
}: GraphPageProps) {
  const [settings, setSettings] = useState<GraphViewSettings>(
    DEFAULT_GRAPH_VIEW_SETTINGS,
  )
  const [settingsOpen, setSettingsOpen] = useState(true)
  const [mode, setMode] = useState<'graph' | 'path'>(
    deepLink?.mode ?? 'graph',
  )
  const [pathSubject, setPathSubject] = useState<TrustSubject | undefined>(
    deepLink?.subject,
  )
  const [graphSnapshot, setGraphSnapshot] = useState<GraphViewSnapshot>(
    EMPTY_GRAPH_VIEW_SNAPSHOT,
  )
  const [pathSnapshot, setPathSnapshot] = useState<GraphViewSnapshot>(
    EMPTY_GRAPH_VIEW_SNAPSHOT,
  )
  const [focusId, setFocusId] = useState<string | undefined>(() =>
    initialFocusId(deepLink),
  )
  const [graphStale, setGraphStale] = useState(false)
  const [localRefreshToken, setLocalRefreshToken] = useState(0)
  const [xColorScheme, setXColorScheme] = useState<PageColorScheme>()
  const [systemScheme, setSystemScheme] = useState<PageColorScheme>(() =>
    typeof window !== 'undefined' ? systemColorScheme() : 'light',
  )
  const [meName, setMeName] = useState(() => t('graph.you'))
  const [mePicture, setMePicture] = useState<string | undefined>()

  const graphRef = useRef<GraphViewHandle>(null)
  const pathRef = useRef<GraphViewHandle>(null)

  useEffect(() => {
    void chrome.storage.local
      .get([GRAPH_VIEW_SETTINGS_KEY, X_PAGE_COLOR_SCHEME_KEY])
      .then((stored) => {
        setSettings(
          normalizeGraphViewSettings(stored[GRAPH_VIEW_SETTINGS_KEY]),
        )
        const x = stored[X_PAGE_COLOR_SCHEME_KEY]
        if (isPageColorScheme(x)) setXColorScheme(x)
      })
    const onStorage = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== 'local') return
      const next = changes[X_PAGE_COLOR_SCHEME_KEY]?.newValue
      if (isPageColorScheme(next)) setXColorScheme(next)
    }
    chrome.storage.onChanged.addListener(onStorage)
    return () => chrome.storage.onChanged.removeListener(onStorage)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemScheme(systemColorScheme())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadActiveXAccount()
      .then((active) => {
        if (cancelled || !active) return
        const display = {
          ...(active.displayName ? { displayName: active.displayName } : {}),
          ...(active.handle ? { handle: active.handle } : {}),
          ...(active.iconPath ? { iconPath: active.iconPath } : {}),
        }
        const name = labelFromXIdentityDisplay(display)
        const picture = pictureFromXIdentityDisplay(display)
        if (name) setMeName(name)
        if (picture) setMePicture(picture)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const viewRefreshToken = graphViewRefreshToken(
    refreshToken,
    localRefreshToken,
  )

  const persistSettings = useCallback((next: GraphViewSettings) => {
    setSettings(next)
    void chrome.storage.local.set({ [GRAPH_VIEW_SETTINGS_KEY]: next })
  }, [])

  const resolvedScheme = resolveGraphColorScheme(
    settings.colorScheme,
    xColorScheme,
    systemScheme,
  )
  const darkTheme = resolvedScheme === 'dark'

  const toggleColorScheme = useCallback(() => {
    const next: PageColorScheme = resolvedScheme === 'dark' ? 'light' : 'dark'
    persistSettings({ ...settings, colorScheme: next })
  }, [persistSettings, resolvedScheme, settings])

  const activeSnapshot = mode === 'path' ? pathSnapshot : graphSnapshot
  const selectedSubject = activeSnapshot.selectedId
    ? parseNodeId(activeSnapshot.selectedId)
    : undefined
  const canPath = Boolean(selectedSubject || pathSubject)

  const selectNodeForPanel = useCallback(
    (node: GraphVizNode) => {
      if (node.kind === 'aggregate') return
      const subject = parseNodeId(node.id)
      if (!subject || subject.type === 'e') return
      void openSidePanel({
        subject,
      }).catch(() => undefined)
    },
    [],
  )

  const resetFocusToMe = useCallback(() => {
    setFocusId(undefined)
    setMode('graph')
  }, [])

  const syncGraphUrl = useCallback((link: GraphDeepLink) => {
    const search = buildGraphPageUrl({
      mode: link.mode,
      ...(link.focus ? { focus: link.focus } : {}),
      ...(link.subject ? { subject: link.subject } : {}),
      ...(link.context ? { context: link.context } : {}),
    })
    const next = `${window.location.pathname}${search}`
    const current = `${window.location.pathname}${window.location.search}`
    if (current !== next) {
      window.history.replaceState(null, '', next)
    }
  }, [])

  const applyGraphView = useCallback(
    (message: GraphViewMessage) => {
      if (message.mode === 'path') {
        const subject =
          message.subject ??
          (message.focus ? parseNodeId(message.focus) : undefined)
        if (!subject) return
        setPathSubject(subject)
        setMode('path')
        setLocalRefreshToken((current) => current + 1)
        syncGraphUrl({
          mode: 'path',
          linked: true,
          ...(message.focus ? { focus: message.focus } : {}),
          subject,
          ...(message.context ? { context: message.context } : {}),
        })
        return
      }
      if (message.mode === 'graph') {
        const nextFocus =
          message.focus ??
          (message.subject ? subjectNodeId(message.subject) : undefined)
        setFocusId(nextFocus)
        setMode('graph')
        setLocalRefreshToken((current) => current + 1)
        syncGraphUrl({
          mode: 'graph',
          linked: true,
          ...(nextFocus ? { focus: nextFocus } : {}),
          ...(message.subject ? { subject: message.subject } : {}),
          ...(message.context ? { context: message.context } : {}),
        })
        return
      }
      const _exhaustive: never = message.mode
      return _exhaustive
    },
    [syncGraphUrl],
  )

  useEffect(() => {
    const onMessage = (message: unknown) => {
      if (isGraphViewMessage(message)) {
        if (typeof message.tabId !== 'number') {
          applyGraphView(message)
          return
        }
        void (async () => {
          try {
            const tab = await chrome.tabs.getCurrent?.()
            if (tab?.id !== undefined && tab.id !== message.tabId) return
          } catch {
            // Apply when the current tab id is unavailable.
          }
          applyGraphView(message)
        })()
        return
      }
      if (isGraphFocusMessage(message)) {
        setFocusId(message.focus)
        setMode('graph')
        return
      }
      if (!isTrustGraphUpdatedMessage(message)) return
      setGraphStale(true)
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [applyGraphView])

  const refreshGraph = useCallback(() => {
    setLocalRefreshToken((current) => current + 1)
    setGraphStale(false)
  }, [])

  const onGraphSnapshot = useCallback((snapshot: GraphViewSnapshot) => {
    setGraphSnapshot(snapshot)
  }, [])

  const onPathSnapshot = useCallback((snapshot: GraphViewSnapshot) => {
    setPathSnapshot(snapshot)
  }, [])

  return (
    <div
      className={`${styles.shell} ${fullscreen ? styles.shellFullscreen : ''}`}
      data-color-scheme={resolvedScheme}
      style={{ colorScheme: resolvedScheme }}
    >
      <div className={styles.status}>
        <span className={styles.badge}>
          {mode === 'path' ? t('graph.mode.path') : t('graph.mode.graph')} ·{' '}
          {t('graph.counts', {
            nodes: activeSnapshot.nodeCount,
            edges: activeSnapshot.linkCount,
          })}
        </span>
        {activeSnapshot.truncated ? (
          <span className={`${styles.badge} ${styles.badgeWarn}`}>
            {t('graph.truncated')}
          </span>
        ) : null}
        {graphStale ? (
          <div className={styles.staleBanner} role="status" data-graph-stale="">
            <span>{t('graph.staleHint')}</span>
            <button
              type="button"
              className={styles.refreshGraphBtn}
              onClick={refreshGraph}
            >
              {t('graph.refresh')}
            </button>
          </div>
        ) : null}
      </div>

      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.themeBtn}
          aria-label={
            darkTheme ? t('graph.themeToLight') : t('graph.themeToDark')
          }
          title={darkTheme ? t('graph.themeToLight') : t('graph.themeToDark')}
          onClick={toggleColorScheme}
        >
          {darkTheme ? (
            <IconSun size={18} aria-hidden="true" />
          ) : (
            <IconMoon size={18} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={() => {
            void closeGraphPage().catch(() => {
              window.close()
            })
          }}
        >
          {t('graph.close')}
        </button>
      </div>

      {!settingsOpen ? (
        <button
          type="button"
          className={styles.settingsTab}
          aria-label={t('graph.settings')}
          onClick={() => setSettingsOpen(true)}
        >
          <IconChevronRight size={18} aria-hidden="true" />
        </button>
      ) : null}

      <div className={styles.canvas}>
        <GraphNeighborhoodView
          ref={graphRef}
          active={mode === 'graph'}
          refreshToken={viewRefreshToken}
          settings={settings}
          focusId={focusId}
          darkTheme={darkTheme}
          onSnapshotChange={onGraphSnapshot}
          onSelectNode={selectNodeForPanel}
        />
        {pathSubject ? (
          <PathEvidenceView
            ref={pathRef}
            active={mode === 'path'}
            settings={settings}
            pathSubject={pathSubject}
            refreshToken={viewRefreshToken}
            darkTheme={darkTheme}
            onSnapshotChange={onPathSnapshot}
            onSelectNode={selectNodeForPanel}
          />
        ) : null}
      </div>

      {activeSnapshot.busy ? (
        <div className={styles.busy}>{t('graph.loading')}</div>
      ) : null}
      {activeSnapshot.error ? (
        <p className={styles.error}>{activeSnapshot.error}</p>
      ) : null}

      <GraphSettingsOverlay
        open={settingsOpen}
        settings={settings}
        mode={mode}
        canPath={canPath}
        meName={meName}
        {...(mePicture ? { mePicture } : {})}
        onClose={() => setSettingsOpen(false)}
        onChange={persistSettings}
        onFocusMe={resetFocusToMe}
        onModeChange={(next) => {
          if (next === 'path') {
            const subject = selectedSubject ?? pathSubject
            if (!subject) return
            setPathSubject(subject)
            setMode('path')
            return
          }
          if (
            pathSubject?.type === 'i' &&
            pathSubject.value.startsWith('post:id:')
          ) {
            setFocusId(subjectNodeId(pathSubject))
          }
          setMode('graph')
        }}
      />
    </div>
  )
}
