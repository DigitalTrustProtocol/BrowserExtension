import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../../lib/i18n'
import type { TrustSubject } from '../../graph'
import type { GraphDeepLink } from '../../shared/graph-deeplink'
import {
  isGraphFocusMessage,
  parseNodeId,
  subjectNodeId,
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
  closeGraphPage,
  openSidePanel,
  queryTrust,
} from '../graph/graph-rpc'
import { defaultContextForSubject } from '../graph/graph-view-data'
import {
  EMPTY_GRAPH_VIEW_SNAPSHOT,
  type GraphViewHandle,
  type GraphViewSnapshot,
} from '../graph/graph-view-types'
import { TRUST_GRAPH_UPDATED_MESSAGE } from '../../shared/demo-wot'
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
  const [pathContext, setPathContext] = useState(
    deepLink?.context ??
      defaultContextForSubject(deepLink?.subject) ??
      '',
  )
  const [graphSnapshot, setGraphSnapshot] = useState<GraphViewSnapshot>(
    EMPTY_GRAPH_VIEW_SNAPSHOT,
  )
  const [pathSnapshot, setPathSnapshot] = useState<GraphViewSnapshot>(
    EMPTY_GRAPH_VIEW_SNAPSHOT,
  )
  const [actionMessage, setActionMessage] = useState<string>()
  const [focusId, setFocusId] = useState<string | undefined>(() =>
    initialFocusId(deepLink),
  )
  const [xColorScheme, setXColorScheme] = useState<PageColorScheme>()
  const [systemScheme, setSystemScheme] = useState<PageColorScheme>(() =>
    typeof window !== 'undefined' ? systemColorScheme() : 'light',
  )

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
  const rootPubkey = activeSnapshot.rootPubkey
  const rootId = rootPubkey ? `p:${rootPubkey}` : undefined
  const canPath = Boolean(selectedSubject || pathSubject)
  const canResetFocus = Boolean(focusId && rootId && focusId !== rootId)

  const selectNodeForPanel = useCallback(
    (node: GraphVizNode) => {
      if (node.kind === 'aggregate') return
      const subject = parseNodeId(node.id)
      if (!subject || subject.type === 'e') return
      const context = settings.context
      void openSidePanel({
        subject,
        ...(context ? { context } : {}),
      }).catch(() => undefined)
    },
    [settings.context],
  )

  useEffect(() => {
    const onMessage = (message: unknown) => {
      if (isGraphFocusMessage(message)) {
        setFocusId(message.focus)
        setMode('graph')
        return
      }
      if (
        !message ||
        typeof message !== 'object' ||
        (message as { type?: unknown }).type !== TRUST_GRAPH_UPDATED_MESSAGE
      ) {
        return
      }
      const subject = selectedSubject
      if (!subject) return
      void queryTrust({
        subject,
        context: pathContext || settings.context || '',
      })
        .then((result) => {
          graphRef.current?.applySelectedResult(subject, result)
          pathRef.current?.applySelectedResult(subject, result)
        })
        .catch(() => undefined)
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [pathContext, selectedSubject, settings.context])

  const resetFocusToMe = useCallback(() => {
    setFocusId(undefined)
    setMode('graph')
  }, [])

  const clearActionMessage = useCallback(() => {
    setActionMessage(undefined)
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
          refreshToken={refreshToken}
          settings={settings}
          focusId={focusId}
          darkTheme={darkTheme}
          onSnapshotChange={onGraphSnapshot}
          onInteract={clearActionMessage}
          onActionMessage={setActionMessage}
          onSelectNode={selectNodeForPanel}
        />
        {pathSubject ? (
          <PathEvidenceView
            ref={pathRef}
            active={mode === 'path'}
            settings={settings}
            pathSubject={pathSubject}
            pathContext={pathContext}
            darkTheme={darkTheme}
            onSnapshotChange={onPathSnapshot}
            onInteract={clearActionMessage}
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
      {actionMessage ? (
        <p className={styles.notice}>{actionMessage}</p>
      ) : null}

      <GraphSettingsOverlay
        open={settingsOpen}
        settings={settings}
        mode={mode}
        canPath={canPath}
        canResetFocus={canResetFocus}
        onClose={() => setSettingsOpen(false)}
        onChange={persistSettings}
        onResetFocus={resetFocusToMe}
        onModeChange={(next) => {
          if (next === 'path') {
            const subject = selectedSubject ?? pathSubject
            if (!subject) return
            setPathSubject(subject)
            setPathContext(defaultContextForSubject(subject))
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
