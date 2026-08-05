import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { t } from '../../lib/i18n'
import {
  summarizeTrust,
  type TrustSummary,
} from '../../content/trust-summary'
import type { TrustQueryResult, TrustSubject } from '../../graph'
import { parseNodeId, subjectNodeId } from '../../shared/graph-deeplink'
import ForceGraphCanvas from './ForceGraphCanvas'
import {
  isAggregateNodeId,
  parentIdFromAggregate,
  partitionNeighborhoodReveal,
  takePendingBatch,
  upsertAggregateInData,
  type PendingNeighborhood,
} from './expand-aggregate'
import { loadGraphSnapshot, loadNeighborhood, queryTrustBatch } from './graph-rpc'
import {
  buildSeedGraphData,
  collapseExpansion,
  mergeNeighborhood,
} from './graph-view-data'
import type { GraphViewHandle, GraphViewSnapshot } from './graph-view-types'
import { useGraphNodeEnrichment } from './useGraphNodeEnrichment'
import {
  edgeId,
  filterGraphData,
  type GraphViewSettings,
  type GraphVizData,
  type GraphVizLink,
  type GraphVizNode,
} from './types'
import styles from './GraphPage.module.css'

export interface GraphNeighborhoodViewProps {
  active: boolean
  refreshToken: number
  settings: GraphViewSettings
  /** Stable seed focus from deep link (does not change on mode toggle). */
  focusId?: string
  onSnapshotChange: (snapshot: GraphViewSnapshot) => void
  onInteract: () => void
  onActionMessage: (message: string) => void
}

const GraphNeighborhoodView = forwardRef<
  GraphViewHandle,
  GraphNeighborhoodViewProps
>(function GraphNeighborhoodView(
  {
    active,
    refreshToken,
    settings,
    focusId,
    onSnapshotChange,
    onInteract,
    onActionMessage,
  },
  ref,
) {
  const [rootPubkey, setRootPubkey] = useState<string>()
  const [rawData, setRawData] = useState<GraphVizData>({
    nodes: [],
    links: [],
  })
  const [selectedId, setSelectedId] = useState<string>()
  const [summaries, setSummaries] = useState<Record<string, TrustSummary>>({})
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()
  const [truncated, setTruncated] = useState(false)
  const pendingByParent = useRef(new Map<string, PendingNeighborhood>())
  const rootPubkeyRef = useRef(rootPubkey)
  rootPubkeyRef.current = rootPubkey

  const clearPendingQueues = useCallback(() => {
    pendingByParent.current.clear()
  }, [])

  const { clearDisplayRequestCaches } = useGraphNodeEnrichment(
    rawData,
    setRawData,
    selectedId,
    settings.showUserIcons,
  )

  const rootId = rootPubkey ? `p:${rootPubkey}` : undefined
  const seedFocusId = focusId ?? rootId

  const applyResolutions = useCallback(
    async (nodes: GraphVizNode[]) => {
      const root = rootPubkeyRef.current
      const items = nodes
        .map((node) => {
          const subject = parseNodeId(node.id)
          if (!subject || subject.type === 'e') return undefined
          if (subject.type === 'p' && subject.value === root) {
            return undefined
          }
          const context = settings.context || ''
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
    [settings.context],
  )

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
      rootPubkeyRef.current = snap.rootPubkey
      const data = buildSeedGraphData(
        snap.rootPubkey,
        focusId ?? `p:${snap.rootPubkey}`,
      )
      setRawData(data)
      setTruncated(false)
      clearDisplayRequestCaches()
      clearPendingQueues()
      void applyResolutions(data.nodes)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('graph.loadError'))
    } finally {
      setBusy(false)
    }
  }, [
    applyResolutions,
    clearDisplayRequestCaches,
    clearPendingQueues,
    focusId,
    settings.context,
  ])

  useEffect(() => {
    void seedGraph()
  }, [seedGraph, refreshToken, settings.direction])

  useImperativeHandle(
    ref,
    () => ({
      applySelectedResult(subject: TrustSubject, result: TrustQueryResult) {
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
      },
    }),
    [],
  )

  const alwaysKeep = useMemo(() => {
    const ids = new Set<string>()
    if (rootId) ids.add(rootId)
    if (seedFocusId) ids.add(seedFocusId)
    if (selectedId) ids.add(selectedId)
    return ids
  }, [rootId, seedFocusId, selectedId])

  const viewData = useMemo(
    () => filterGraphData(rawData, settings, alwaysKeep),
    [rawData, settings, alwaysKeep],
  )

  const selectedNode = viewData.nodes.find((n) => n.id === selectedId)

  useEffect(() => {
    onSnapshotChange({
      selectedId,
      selectedNode,
      rootPubkey,
      summaries,
      nodeCount: viewData.nodes.length,
      linkCount: viewData.links.length,
      busy,
      error,
      truncated,
    })
  }, [
    busy,
    error,
    onSnapshotChange,
    rootPubkey,
    selectedId,
    selectedNode,
    summaries,
    truncated,
    viewData.links.length,
    viewData.nodes.length,
  ])

  const onNodeClick = useCallback(
    async (node: GraphVizNode) => {
      onInteract()

      if (isAggregateNodeId(node.id)) {
        const parentId =
          node.aggregateParentId ?? parentIdFromAggregate(node.id)
        if (!parentId) return
        const pending = pendingByParent.current.get(parentId)
        if (!pending || pending.nodes.length === 0) return
        const { reveal, remaining } = takePendingBatch(pending)
        if (remaining.nodes.length > 0) {
          pendingByParent.current.set(parentId, remaining)
        } else {
          pendingByParent.current.delete(parentId)
        }
        setRawData((prev) => {
          const merged = mergeNeighborhood(
            prev,
            parentId,
            reveal.nodes,
            reveal.links,
          )
          const withAgg = upsertAggregateInData(
            merged,
            parentId,
            remaining.nodes.length,
            (prev.nodes.find((n) => n.id === parentId)?.depth ?? 0) + 1,
          )
          void applyResolutions(reveal.nodes as GraphVizNode[])
          return withAgg
        })
        return
      }

      setSelectedId(node.id)

      if (node.expanded) {
        if (!rootId) return
        pendingByParent.current.delete(node.id)
        for (const [parentId] of pendingByParent.current) {
          const owner = rawData.nodes.find((n) => n.id === parentId)
          if (owner?.expandedFrom?.includes(node.id)) {
            pendingByParent.current.delete(parentId)
          }
        }
        setRawData((prev) => collapseExpansion(prev, node.id, rootId))
        return
      }

      if (node.depth >= settings.maxHops) {
        onActionMessage(t('graph.maxHopsReached', { count: settings.maxHops }))
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
        const neighborNodes = neighborhood.nodes
          .filter((n) => n.id !== node.id)
          .map((n) => ({
            ...n,
            depth: node.depth + 1,
          }))
        const neighborLinks: GraphVizLink[] = neighborhood.edges.map((e) => ({
          id: edgeId(e),
          source: e.from,
          target: e.to,
          value: e.value,
          context: e.context,
          eventId: e.eventId,
          depth: node.depth + 1,
        }))
        const { reveal, pending } = partitionNeighborhoodReveal(
          neighborNodes,
          neighborLinks,
        )
        if (pending.nodes.length > 0) {
          pendingByParent.current.set(node.id, pending)
        } else {
          pendingByParent.current.delete(node.id)
        }
        setRawData((prev) => {
          const merged = mergeNeighborhood(
            prev,
            node.id,
            reveal.nodes,
            reveal.links,
          )
          const withAgg = upsertAggregateInData(
            merged,
            node.id,
            pending.nodes.length,
            node.depth + 1,
          )
          void applyResolutions(withAgg.nodes)
          return withAgg
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
      onActionMessage,
      onInteract,
      rawData.nodes,
      rootId,
      settings.context,
      settings.direction,
      settings.maxHops,
    ],
  )

  return (
    <div
      className={`${styles.viewLayer} ${active ? styles.viewVisible : styles.viewHidden}`}
      aria-hidden={!active}
      {...(!active ? ({ inert: '' } as Record<string, string>) : {})}
    >
      <ForceGraphCanvas
        data={viewData}
        settings={settings}
        selectedId={selectedId}
        rootId={rootId}
        pathLayout={false}
        onNodeClick={(node) => void onNodeClick(node)}
      />
    </div>
  )
})

export default GraphNeighborhoodView
