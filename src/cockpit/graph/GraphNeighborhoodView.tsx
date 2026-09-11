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
import type { GraphVisId, TrustQueryResult, TrustSubject } from '../../graph'
import { visIdRecordKey } from '../../graph'
import {
  IDENTITY_TRUST_CONTEXT,
  trustQueryContextForSubject,
} from '../../shared/trust-context'
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
  collapseExpansion,
  graphNodeClickIntent,
  mergeNeighborhood,
  neighborhoodToGraph,
  omitPostNeighborsUnlessCenterIsPost,
} from './graph-view-data'
import type { GraphViewHandle, GraphViewSnapshot } from './graph-view-types'
import {
  findGraphVizNode,
  lookupByGraphNodeId,
  subjectOfGraphNode,
} from './graph-display'
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

/** Same-node clicks within this window count as a double-click. */
const DBL_CLICK_MS = 400

export interface GraphNeighborhoodViewProps {
  active: boolean
  refreshToken: number
  settings: GraphViewSettings
  /** Stable seed focus from deep link (does not change on mode toggle). */
  focusId?: string
  /** Resolved chrome theme for the canvas. */
  darkTheme: boolean
  onSnapshotChange: (snapshot: GraphViewSnapshot) => void
  onSelectNode?: (node: GraphVizNode) => void
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
    darkTheme,
    onSnapshotChange,
    onSelectNode,
  },
  ref,
) {
  const [rootPubkey, setRootPubkey] = useState<string>()
  const [rootIndex, setRootIndex] = useState<number>()
  const [rawData, setRawData] = useState<GraphVizData>({
    nodes: [],
    links: [],
  })
  const [selectedId, setSelectedId] = useState<GraphVisId>()
  const [seedCenterId, setSeedCenterId] = useState<GraphVisId>()
  const [summaries, setSummaries] = useState<Record<string, TrustSummary>>({})
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()
  const [truncated, setTruncated] = useState(false)
  const pendingByParent = useRef(new Map<GraphVisId, PendingNeighborhood>())
  const rootPubkeyRef = useRef(rootPubkey)
  rootPubkeyRef.current = rootPubkey
  const rawDataRef = useRef(rawData)
  rawDataRef.current = rawData
  const lastClickRef = useRef<{
    nodeId: GraphVisId
    time: number
  } | null>(null)
  const expandingIdsRef = useRef(new Set<GraphVisId>())
  const seedRunRef = useRef(0)

  const clearPendingQueues = useCallback(() => {
    pendingByParent.current.clear()
  }, [])

  const {
    clearDisplayRequestCaches,
    hydrateFromCache,
    ingestNeighborhoodChromePayload,
  } = useGraphNodeEnrichment(
      rawData,
      setRawData,
      selectedId,
      settings.showUserIcons,
    )

  const rootId = rootIndex

  const applyResolutions = useCallback(
    async (nodes: GraphVizNode[]) => {
      const root = rootPubkeyRef.current
      const items = nodes
        .map((node) => {
          const subject = subjectOfGraphNode(node)
          if (!subject || subject.type === 'e') return undefined
          if (subject.type === 'p' && subject.value === root) {
            return undefined
          }
          const context = trustQueryContextForSubject(subject)
          return { key: visIdRecordKey(node.id), subject, context }
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
              resolution:
                lookupByGraphNodeId(n, next)?.resolution ?? n.resolution,
            })),
          }))
      } catch {
        // Non-fatal for display.
      }
    },
    [],
  )

  const seedGraph = useCallback(async () => {
    const run = ++seedRunRef.current
    setBusy(true)
    setError(undefined)
    setRawData({ nodes: [], links: [] })
    rawDataRef.current = { nodes: [], links: [] }
    let seedId: GraphVisId | undefined
    try {
      const snap = await loadGraphSnapshot()
      if (run !== seedRunRef.current) return
      setRootPubkey(snap.rootPubkey)
      setRootIndex(snap.rootIndex)
      rootPubkeyRef.current = snap.rootPubkey
      const centerId = focusId ?? snap.rootIndex
      if (centerId === undefined) {
        setSelectedId(undefined)
        setSeedCenterId(undefined)
        setTruncated(false)
        clearDisplayRequestCaches()
        clearPendingQueues()
        expandingIdsRef.current.clear()
        return
      }
      const neighborhood = await loadNeighborhood({
        centerId,
        direction: settings.direction,
        valueFilter: 'both',
        context: IDENTITY_TRUST_CONTEXT,
      })
      if (run !== seedRunRef.current) return
      clearDisplayRequestCaches()
      ingestNeighborhoodChromePayload(neighborhood)
      const data = hydrateFromCache(
        neighborhoodToGraph(neighborhood, snap.rootPubkey),
      )
      seedId =
        neighborhood.centerId ??
        data.nodes.find((node) => node.isFocus)?.id
      rawDataRef.current = data
      setRawData(data)
      setSelectedId(seedId)
      setSeedCenterId(seedId)
      setTruncated(neighborhood.truncated)
      clearPendingQueues()
      expandingIdsRef.current.clear()
      void applyResolutions(data.nodes)
    } catch (err) {
      if (run !== seedRunRef.current) return
      setError(err instanceof Error ? err.message : t('graph.loadError'))
      seedId = undefined
    } finally {
      if (run === seedRunRef.current) setBusy(false)
    }
  }, [
    applyResolutions,
    clearDisplayRequestCaches,
    clearPendingQueues,
    focusId,
    hydrateFromCache,
    ingestNeighborhoodChromePayload,
    settings.direction,
  ])

  useEffect(() => {
    void seedGraph()
  }, [seedGraph, refreshToken, settings.direction])

  useImperativeHandle(
    ref,
    () => ({
      applySelectedResult(subject: TrustSubject, result: TrustQueryResult) {
        const summary = summarizeTrust(result)
        setRawData((current) => {
          const match = current.nodes.find((node) => {
            const nodeSubject = subjectOfGraphNode(node)
            return (
              nodeSubject?.type === subject.type &&
              nodeSubject.value.toLowerCase() === subject.value.toLowerCase()
            )
          })
          if (match) {
            setSummaries((previous) => ({
              ...previous,
              [match.id]: summary,
            }))
          }
          return {
            ...current,
            nodes: current.nodes.map((node) => {
              const nodeSubject = subjectOfGraphNode(node)
              return nodeSubject?.type === subject.type &&
                nodeSubject.value.toLowerCase() === subject.value.toLowerCase()
                ? { ...node, resolution: summary.resolution }
                : node
            }),
          }
        })
      },
    }),
    [],
  )

  const alwaysKeep = useMemo(() => {
    const ids = new Set<GraphVisId>()
    if (seedCenterId !== undefined) ids.add(seedCenterId)
    if (rootId !== undefined && seedCenterId === rootId) ids.add(rootId)
    if (selectedId !== undefined) ids.add(selectedId)
    return ids
  }, [rootId, seedCenterId, selectedId])

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

  const revealAggregate = useCallback(
    (node: GraphVizNode) => {
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
        return hydrateFromCache(withAgg)
      })
    },
    [applyResolutions, hydrateFromCache],
  )

  const collapseNode = useCallback(
    (nodeId: GraphVisId) => {
      if (rootId === undefined) return
      const node = findGraphVizNode(rawDataRef.current.nodes, nodeId)
      if (!node?.expanded) return
      const centerId = node.id
      pendingByParent.current.delete(centerId)
      for (const [parentId] of pendingByParent.current) {
        const owner = findGraphVizNode(rawDataRef.current.nodes, parentId)
        if (owner?.expandedFrom?.includes(centerId)) {
          pendingByParent.current.delete(parentId)
        }
      }
      setRawData((prev) => collapseExpansion(prev, centerId, rootId))
    },
    [rootId],
  )

  const expandNode = useCallback(
    async (nodeId: GraphVisId) => {
      const node = findGraphVizNode(rawDataRef.current.nodes, nodeId)
      if (!node || node.kind === 'aggregate') return
      if (expandingIdsRef.current.has(node.id)) return
      const hasChildren = rawDataRef.current.nodes.some((entry) =>
        entry.expandedFrom?.includes(node.id),
      )
      // Empty expand (graph not ready yet) stays clickable so a later
      // double-click can retry once statements exist.
      if (node.expanded && hasChildren) return
      expandingIdsRef.current.add(node.id)

      setBusy(true)
      try {
        const neighborhood = await loadNeighborhood({
          centerId: node.id,
          direction: settings.direction,
          valueFilter: 'both',
          context: IDENTITY_TRUST_CONTEXT,
        })
        ingestNeighborhoodChromePayload(neighborhood)
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
        const filtered = omitPostNeighborsUnlessCenterIsPost(
          node,
          neighborNodes,
          neighborLinks,
        )
        const { reveal, pending } = partitionNeighborhoodReveal(
          filtered.nodes,
          filtered.links,
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
          return hydrateFromCache(withAgg)
        })
        if (neighborhood.truncated) setTruncated(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('graph.expandError'))
      } finally {
        expandingIdsRef.current.delete(node.id)
        setBusy(false)
      }
    },
    [
      applyResolutions,
      hydrateFromCache,
      ingestNeighborhoodChromePayload,
      settings.direction,
    ],
  )

  const onNodePointerDown = useCallback(
    (node: GraphVizNode) => {
      if (isAggregateNodeId(node.id)) return
      const current = findGraphVizNode(rawDataRef.current.nodes, node.id)
      const id = current?.id ?? node.id
      setSelectedId(id)
      onSelectNode?.(current ?? node)
    },
    [onSelectNode],
  )

  const onNodeClick = useCallback(
    (node: GraphVizNode, _event: MouseEvent) => {
      if (isAggregateNodeId(node.id)) {
        lastClickRef.current = null
        revealAggregate(node)
        return
      }

      const current = findGraphVizNode(rawDataRef.current.nodes, node.id)
      const id = current?.id ?? node.id

      // force-graph does not set event.detail reliably — detect double-click by timing.
      const now = Date.now()
      const prev = lastClickRef.current
      const isDouble =
        Boolean(prev) &&
        prev!.nodeId === id &&
        now - prev!.time < DBL_CLICK_MS
      const hasChildren = rawDataRef.current.nodes.some((entry) =>
        entry.expandedFrom?.includes(id),
      )
      const expandedNow = Boolean(current?.expanded && hasChildren)
      const intent = graphNodeClickIntent({
        isDouble,
        expandedNow,
      })

      if (!isDouble) {
        lastClickRef.current = {
          nodeId: id,
          time: now,
        }
      } else {
        lastClickRef.current = null
      }

      switch (intent) {
        case 'expand':
          void expandNode(id)
          return
        case 'collapse':
          collapseNode(id)
          return
        case 'select':
          return
        default: {
          const _exhaustive: never = intent
          return _exhaustive
        }
      }
    },
    [collapseNode, expandNode, revealAggregate],
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
        darkTheme={darkTheme}
        active={active}
        onNodeClick={onNodeClick}
        onNodePointerDown={onNodePointerDown}
      />
    </div>
  )
})

export default GraphNeighborhoodView
