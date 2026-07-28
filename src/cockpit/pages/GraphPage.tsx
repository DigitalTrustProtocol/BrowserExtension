import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../../lib/i18n'
import {
  summarizeTrust,
  type TrustSummary,
} from '../../content/trust-summary'
import type { TrustQueryResult, TrustSubject } from '../../graph'
import type { GraphDeepLink } from '../../shared/graph-deeplink'
import { parseNodeId, subjectNodeId } from '../../shared/graph-deeplink'
import type { GraphSnapshotNode } from '../../shared/contracts'
import ForceGraphCanvas from '../graph/ForceGraphCanvas'
import GraphSelectionPanel from '../graph/GraphSelectionPanel'
import GraphSettingsOverlay from '../graph/GraphSettingsOverlay'
import {
  cancelTrust,
  loadGraphSnapshot,
  loadNeighborhood,
  loadProfileDisplays,
  publishTrust,
  queryTrust,
  queryTrustBatch,
} from '../graph/graph-rpc'
import {
  DEFAULT_GRAPH_VIEW_SETTINGS,
  edgeId,
  filterGraphData,
  GRAPH_VIEW_SETTINGS_KEY,
  normalizeGraphViewSettings,
  type GraphViewSettings,
  type GraphVizData,
  type GraphVizLink,
  type GraphVizNode,
} from '../graph/types'
import styles from '../graph/GraphPage.module.css'

export interface GraphPageProps {
  refreshToken: number
  deepLink?: GraphDeepLink
  fullscreen?: boolean
}

function defaultContextForSubject(subject?: TrustSubject): string {
  if (!subject) return 'identity'
  if (subject.type === 'i' && subject.value.startsWith('ext:twitter_post:')) {
    return 'news:accuracy'
  }
  return 'identity'
}

function mergeNeighborhood(
  current: GraphVizData,
  centerId: string,
  nodes: GraphSnapshotNode[],
  links: GraphVizLink[],
): GraphVizData {
  const nodeMap = new Map(current.nodes.map((n) => [n.id, { ...n }]))
  for (const node of nodes) {
    const existing = nodeMap.get(node.id)
    if (existing) {
      if (node.depth < existing.depth) existing.depth = node.depth
      if (
        node.id !== centerId &&
        !existing.isRoot &&
        !existing.expandedFrom?.includes(centerId)
      ) {
        existing.expandedFrom = [
          ...(existing.expandedFrom ?? []),
          centerId,
        ]
      }
      continue
    }
    nodeMap.set(node.id, {
      ...node,
      depth: node.id === centerId ? 0 : (node.depth || 1),
      expandedFrom: node.id === centerId ? undefined : [centerId],
    })
  }
  const center = nodeMap.get(centerId)
  if (center) center.expanded = true

  const linkMap = new Map(current.links.map((l) => [l.id, l]))
  for (const link of links) {
    const existing = linkMap.get(link.id)
    linkMap.set(
      link.id,
      existing
        ? {
            ...existing,
            expandedFrom: existing.expandedFrom?.includes(centerId)
              ? existing.expandedFrom
              : [...(existing.expandedFrom ?? []), centerId],
          }
        : { ...link, expandedFrom: [centerId] },
    )
  }
  return { nodes: [...nodeMap.values()], links: [...linkMap.values()] }
}

function collapseExpansion(
  current: GraphVizData,
  centerId: string,
  rootId: string,
): GraphVizData {
  const collapsedCenters = new Set<string>([centerId])
  const remove = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const node of current.nodes) {
      if (node.id === rootId || node.id === centerId || remove.has(node.id)) {
        continue
      }
      const owners = node.expandedFrom ?? []
      if (
        owners.length === 0 ||
        !owners.some((owner) => collapsedCenters.has(owner)) ||
        !owners.every((owner) => collapsedCenters.has(owner))
      ) {
        continue
      }
      remove.add(node.id)
      if (node.expanded) collapsedCenters.add(node.id)
      changed = true
    }
  }
  const nodes = current.nodes
    .filter((n) => !remove.has(n.id))
    .map((node) => ({
      ...node,
      ...(node.id === centerId ? { expanded: false } : {}),
      ...(node.expandedFrom
        ? {
            expandedFrom: node.expandedFrom.filter(
              (owner) => !collapsedCenters.has(owner),
            ),
          }
        : {}),
    }))
  const keep = new Set(nodes.map((n) => n.id))
  const links = current.links
    .map((link) => ({
      ...link,
      expandedFrom: link.expandedFrom?.filter(
        (owner) => !collapsedCenters.has(owner),
      ),
    }))
    .filter((link) => {
      const source =
        typeof link.source === 'string' ? link.source : link.source.id
      const target =
        typeof link.target === 'string' ? link.target : link.target.id
      if (!keep.has(source) || !keep.has(target)) return false
      return (
        !link.expandedFrom ||
        link.expandedFrom.length > 0
      )
    })
  return { nodes, links }
}

function pathsToGraph(
  result: TrustQueryResult,
  rootPubkey: string,
): GraphVizData {
  const rootId = `p:${rootPubkey}`
  const nodes = new Map<string, GraphVizNode>()
  const links = new Map<string, GraphVizLink>()

  nodes.set(rootId, {
    id: rootId,
    kind: 'pubkey',
    depth: 0,
    label: t('graph.you'),
    isRoot: true,
  })

  const subjectId = subjectNodeId(result.subject)
  const subjectLabel =
    result.subject.type === 'i' &&
    result.subject.value.startsWith('ext:twitter_id:')
      ? `X · ${result.subject.value.slice('ext:twitter_id:'.length)}`
      : result.subject.type === 'i' &&
          result.subject.value.startsWith('ext:twitter_post:')
        ? `${t('graph.post')} · ${result.subject.value.slice('ext:twitter_post:'.length)}`
        : result.subject.value.slice(0, 14) + '…'

  for (const path of result.paths) {
    let prev = rootId
    path.authors.forEach((author, index) => {
      const id = `p:${author}`
      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          kind: 'pubkey',
          depth: index,
          label:
            author === rootPubkey
              ? t('graph.you')
              : author.slice(0, 12) + '…',
          isRoot: author === rootPubkey,
        })
      }
      if (id !== prev) {
        const lid = `path:${prev}:${id}`
        if (!links.has(lid)) {
          links.set(lid, {
            id: lid,
            source: prev,
            target: id,
            value: 1,
            context: result.context,
            eventId: path.sourceEventIds[Math.max(0, index - 1)] ?? lid,
            depth: index,
          })
        }
        prev = id
      }
    })
    const authorId =
      path.authors.length > 0
        ? `p:${path.authors[path.authors.length - 1]}`
        : rootId
    if (!nodes.has(subjectId)) {
      nodes.set(subjectId, {
        id: subjectId,
        kind: subjectId.startsWith('i:ext:twitter_post:')
          ? 'post'
          : subjectId.startsWith('i:ext:twitter_id:')
            ? 'twitter_id'
            : 'other',
        depth: path.authors.length,
        label: subjectLabel,
        isFocus: true,
      })
    }
    const stmt = result.statements.find(
      (s) =>
        subjectNodeId(s.subject) === subjectId &&
        `p:${s.author}` === authorId,
    )
    const lid = `ev:${authorId}:${subjectId}:${stmt?.eventId ?? 'x'}`
    if (!links.has(lid)) {
      links.set(lid, {
        id: lid,
        source: authorId,
        target: subjectId,
        value: stmt?.value === -1 ? -1 : 1,
        context: result.context,
        eventId: stmt?.eventId ?? lid,
        depth: path.authors.length,
      })
    }
  }

  if (result.paths.length === 0 && result.direct) {
    nodes.set(subjectId, {
      id: subjectId,
      kind: subjectId.startsWith('i:ext:twitter_post:')
        ? 'post'
        : subjectId.startsWith('i:ext:twitter_id:')
          ? 'twitter_id'
          : 'other',
      depth: 1,
      label: subjectLabel,
      isFocus: true,
    })
    links.set(`direct:${subjectId}`, {
      id: `direct:${subjectId}`,
      source: rootId,
      target: subjectId,
      value: result.direct.value === -1 ? -1 : 1,
      context: result.context,
      eventId: result.direct.eventId,
      depth: 1,
    })
  }

  if (!nodes.has(subjectId)) {
    nodes.set(subjectId, {
      id: subjectId,
      kind: subjectId.startsWith('i:ext:twitter_post:')
        ? 'post'
        : subjectId.startsWith('i:ext:twitter_id:')
          ? 'twitter_id'
          : result.subject.type === 'p'
            ? 'pubkey'
            : 'other',
      depth: 1,
      label: subjectLabel,
      isFocus: true,
      resolution: result.resolution,
    })
  }

  return { nodes: [...nodes.values()], links: [...links.values()] }
}

export default function GraphPage({
  refreshToken,
  deepLink,
  fullscreen = false,
}: GraphPageProps) {
  const [settings, setSettings] = useState<GraphViewSettings>(
    DEFAULT_GRAPH_VIEW_SETTINGS,
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mode, setMode] = useState<'graph' | 'path'>(
    deepLink?.mode ?? 'graph',
  )
  const [rootPubkey, setRootPubkey] = useState<string>()
  const [rawData, setRawData] = useState<GraphVizData>({
    nodes: [],
    links: [],
  })
  const [selectedId, setSelectedId] = useState<string>()
  const [summaries, setSummaries] = useState<Record<string, TrustSummary>>({})
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()
  const [actionMessage, setActionMessage] = useState<string>()
  const [actionBusy, setActionBusy] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [pathSubject, setPathSubject] = useState<TrustSubject | undefined>(
    deepLink?.subject,
  )
  const [pathContext, setPathContext] = useState(
    deepLink?.context ??
      defaultContextForSubject(deepLink?.subject) ??
      'identity',
  )
  const avatarRequests = useRef(new Set<string>())

  const rootId = rootPubkey ? `p:${rootPubkey}` : undefined
  const focusId =
    deepLink?.focus ??
    (deepLink?.subject ? subjectNodeId(deepLink.subject) : undefined) ??
    rootId

  useEffect(() => {
    void chrome.storage.local.get(GRAPH_VIEW_SETTINGS_KEY).then((stored) => {
      setSettings(
        normalizeGraphViewSettings(stored[GRAPH_VIEW_SETTINGS_KEY]),
      )
    })
  }, [])

  const persistSettings = useCallback((next: GraphViewSettings) => {
    setSettings(next)
    void chrome.storage.local.set({ [GRAPH_VIEW_SETTINGS_KEY]: next })
  }, [])

  useEffect(() => {
    if (!settings.showUserIcons) return
    const pubkeys = rawData.nodes
      .filter((node) => node.kind === 'pubkey' && !node.picture)
      .map((node) => parseNodeId(node.id))
      .filter(
        (subject): subject is Extract<TrustSubject, { type: 'p' }> =>
          subject?.type === 'p' && !avatarRequests.current.has(subject.value),
      )
      .map((subject) => subject.value)
      .slice(0, 12)
    if (pubkeys.length === 0) return
    for (const pubkey of pubkeys) avatarRequests.current.add(pubkey)
    void loadProfileDisplays(pubkeys)
      .then((profiles) => {
        setRawData((current) => ({
          ...current,
          nodes: current.nodes.map((node) => {
            const subject = parseNodeId(node.id)
            const profile =
              subject?.type === 'p' ? profiles[subject.value] : undefined
            return profile
              ? {
                  ...node,
                  ...(profile.name ? { label: profile.name } : {}),
                  ...(profile.picture ? { picture: profile.picture } : {}),
                }
              : node
          }),
        }))
      })
      .catch(() => {
        // Avatars are an optional display enhancement.
      })
  }, [rawData.nodes, settings.showUserIcons])

  const applyResolutions = useCallback(
    async (nodes: GraphVizNode[]) => {
      const items = nodes
        .map((node) => {
          const subject = parseNodeId(node.id)
          if (!subject || subject.type === 'e') return undefined
          if (subject.type === 'p' && subject.value === rootPubkey) {
            return undefined
          }
          const context =
            subject.type === 'i' &&
            subject.value.startsWith('ext:twitter_post:')
              ? 'news:accuracy'
              : settings.context || 'identity'
          return { key: node.id, subject, context }
        })
        .filter(Boolean) as Array<{
        key: string
        subject: TrustSubject
        context: string
      }>
      if (items.length === 0) return
      try {
        const batch = await queryTrustBatch(items.slice(0, 200))
        const next: Record<string, TrustSummary> = {}
        for (const [key, result] of Object.entries(batch.results)) {
          next[key] = summarizeTrust(result)
        }
        setSummaries((prev) => ({ ...prev, ...next }))
        setRawData((prev) => ({
          ...prev,
          nodes: prev.nodes.map((n) => ({
            ...n,
            resolution: next[n.id]?.resolution ?? n.resolution,
          })),
        }))
      } catch {
        // Non-fatal for display.
      }
    },
    [rootPubkey, settings.context],
  )

  const loadPath = useCallback(async () => {
    const subject = pathSubject
    if (!subject) {
      setError(t('graph.pathSubjectRequired'))
      setBusy(false)
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const result = await queryTrust({
        subject,
        context: pathContext || defaultContextForSubject(subject),
      })
      const snap = await loadGraphSnapshot({ maxDepth: 1, maxNodes: 2 })
      setRootPubkey(snap.rootPubkey)
      const data = pathsToGraph(result, snap.rootPubkey)
      setRawData(data)
      setTruncated(result.truncated)
      setSummaries({
        [subjectNodeId(subject)]: summarizeTrust(result),
      })
      void applyResolutions(data.nodes)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('graph.pathLoadError'))
    } finally {
      setBusy(false)
    }
  }, [applyResolutions, pathContext, pathSubject])

  const seedGraph = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      const snap = await loadGraphSnapshot({
        maxDepth: 1,
        maxNodes: 10,
        ...(settings.context ? { context: settings.context } : {}),
      })
      setRootPubkey(snap.rootPubkey)
      const seedFocus = focusId ?? `p:${snap.rootPubkey}`

      const rootNode: GraphVizNode = {
        id: `p:${snap.rootPubkey}`,
        kind: 'pubkey',
        depth: 0,
        label: t('graph.you'),
        isRoot: true,
      }
      const data: GraphVizData = {
        nodes: [rootNode],
        links: [],
      }
      if (seedFocus !== rootNode.id) {
        const focusSubject = parseNodeId(seedFocus)
        data.nodes.push({
          id: seedFocus,
          kind:
            seedFocus.startsWith('i:ext:twitter_post:')
              ? 'post'
              : seedFocus.startsWith('i:ext:twitter_id:')
                ? 'twitter_id'
                : focusSubject?.type === 'p'
                  ? 'pubkey'
                  : 'other',
          depth: 1,
          label:
            focusSubject?.type === 'i' &&
            focusSubject.value.startsWith('ext:twitter_id:')
              ? `X · ${focusSubject.value.slice('ext:twitter_id:'.length)}`
              : focusSubject?.type === 'i' &&
                  focusSubject.value.startsWith('ext:twitter_post:')
                ? `${t('graph.post')} · ${focusSubject.value.slice('ext:twitter_post:'.length)}`
                : focusSubject
                  ? `${focusSubject.value.slice(0, 12)}…`
                  : seedFocus,
          isFocus: true,
        })
      }
      setRawData(data)
      setTruncated(false)
      void applyResolutions(data.nodes)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('graph.loadError'))
    } finally {
      setBusy(false)
    }
  }, [
    applyResolutions,
    focusId,
    settings.context,
  ])

  useEffect(() => {
    if (mode === 'path') void loadPath()
    else void seedGraph()
  }, [
    mode,
    loadPath,
    seedGraph,
    refreshToken,
    settings.direction,
  ])

  const alwaysKeep = useMemo(() => {
    const ids = new Set<string>()
    if (rootId) ids.add(rootId)
    if (focusId) ids.add(focusId)
    if (selectedId) ids.add(selectedId)
    return ids
  }, [focusId, rootId, selectedId])

  const viewData = useMemo(
    () => filterGraphData(rawData, settings, alwaysKeep),
    [rawData, settings, alwaysKeep],
  )

  const selectedNode = viewData.nodes.find((n) => n.id === selectedId)
  const selectedSubject = selectedId ? parseNodeId(selectedId) : undefined
  const canAct =
    Boolean(selectedSubject) &&
    selectedSubject?.type !== 'e' &&
    !(selectedSubject?.type === 'p' && selectedSubject.value === rootPubkey)

  const onNodeClick = useCallback(
    async (node: GraphVizNode) => {
      setSelectedId(node.id)
      setActionMessage(undefined)

      if (mode === 'path') return

      if (node.expanded) {
        if (!rootId) return
        setRawData((prev) => collapseExpansion(prev, node.id, rootId))
        return
      }

      // Expansion depth cap relative to root.
      if (node.depth >= settings.maxHops) {
        setActionMessage(t('graph.maxHopsReached', { count: settings.maxHops }))
        return
      }

      setBusy(true)
      try {
        const neighborhood = await loadNeighborhood({
          centerId: node.id,
          direction: settings.direction,
          valueFilter: 'both',
          ...(settings.context ? { context: settings.context } : {}),
        })
        setRawData((prev) => {
          const merged = mergeNeighborhood(
            prev,
            node.id,
            neighborhood.nodes.map((n) => ({
              ...n,
              depth: n.id === node.id ? node.depth : node.depth + 1,
            })),
            neighborhood.edges.map((e) => ({
              id: edgeId(e),
              source: e.from,
              target: e.to,
              value: e.value,
              context: e.context,
              eventId: e.eventId,
              depth: node.depth + 1,
            })),
          )
          void applyResolutions(merged.nodes)
          return merged
        })
        if (neighborhood.truncated) setTruncated(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('graph.expandError'))
      } finally {
        setBusy(false)
      }
    },
    [
      applyResolutions,
      mode,
      rootId,
      settings.context,
      settings.direction,
      settings.maxHops,
    ],
  )

  const actContext =
    selectedSubject?.type === 'i' &&
    selectedSubject.value.startsWith('ext:twitter_post:')
      ? 'news:accuracy'
      : pathContext || settings.context || 'identity'

  function applySelectedResult(
    subject: TrustSubject,
    result: TrustQueryResult,
  ): void {
    const id = subjectNodeId(subject)
    const summary = summarizeTrust(result)
    setSummaries((previous) => ({ ...previous, [id]: summary }))
    setRawData((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === id
          ? { ...node, resolution: summary.resolution }
          : node,
      ),
    }))
  }

  async function handlePublish(value: '1' | '-1') {
    if (!selectedSubject) return
    setActionBusy(true)
    setActionMessage(undefined)
    try {
      await publishTrust({
        subject: selectedSubject,
        value,
        context: actContext,
      })
      setActionMessage(t('graph.published'))
      const result = await queryTrust({
        subject: selectedSubject,
        context: actContext,
      })
      applySelectedResult(selectedSubject, result)
    } catch (err) {
      setActionMessage(
        err instanceof Error ? err.message : t('graph.publishError'),
      )
    } finally {
      setActionBusy(false)
    }
  }

  async function handleCancel() {
    if (!selectedSubject) return
    setActionBusy(true)
    setActionMessage(undefined)
    try {
      await cancelTrust({ subject: selectedSubject, context: actContext })
      setActionMessage(t('graph.cancelled'))
      const result = await queryTrust({
        subject: selectedSubject,
        context: actContext,
      })
      applySelectedResult(selectedSubject, result)
    } catch (err) {
      setActionMessage(
        err instanceof Error ? err.message : t('graph.cancelError'),
      )
    } finally {
      setActionBusy(false)
    }
  }

  return (
    <div
      className={`${styles.shell} ${fullscreen ? styles.shellFullscreen : ''}`}
    >
      <div className={styles.status}>
        <span className={styles.badge}>
          {mode === 'path' ? t('graph.mode.path') : t('graph.mode.graph')} ·{' '}
          {t('graph.counts', {
            nodes: viewData.nodes.length,
            edges: viewData.links.length,
          })}
        </span>
        {truncated ? (
          <span className={`${styles.badge} ${styles.badgeWarn}`}>
            {t('graph.truncated')}
          </span>
        ) : null}
      </div>

      <div className={styles.toolbar}>
        {!settingsOpen ? (
          <button
            type="button"
            className={styles.settingsBtn}
            onClick={() => setSettingsOpen(true)}
          >
            {t('graph.settings')}
          </button>
        ) : null}
        <button
          type="button"
          className={styles.closeBtn}
          onClick={() => window.close()}
        >
          {t('graph.close')}
        </button>
      </div>

      <div className={styles.canvas}>
        <ForceGraphCanvas
          data={viewData}
          settings={settings}
          selectedId={selectedId}
          rootId={rootId}
          pathLayout={mode === 'path'}
          onNodeClick={(node) => void onNodeClick(node)}
        />
      </div>

      {busy ? <div className={styles.busy}>{t('graph.loading')}</div> : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      {selectedNode ? (
        <GraphSelectionPanel
          node={selectedNode}
          summary={summaries[selectedNode.id]}
          busy={actionBusy}
          message={actionMessage}
          canAct={canAct}
          onTrust={() => void handlePublish('1')}
          onDistrust={() => void handlePublish('-1')}
          onCancel={() => void handleCancel()}
          onClose={() => setSelectedId(undefined)}
        />
      ) : null}

      <GraphSettingsOverlay
        open={settingsOpen}
        settings={settings}
        mode={mode}
        canPath={Boolean(pathSubject || selectedSubject)}
        onClose={() => setSettingsOpen(false)}
        onChange={persistSettings}
        onModeChange={(next) => {
          if (next === 'path' && selectedSubject) {
            setPathSubject(selectedSubject)
            setPathContext(defaultContextForSubject(selectedSubject))
          }
          setMode(next)
        }}
      />
    </div>
  )
}
