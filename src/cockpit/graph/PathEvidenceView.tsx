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
  contextField,
  ratingQueryContextForSubject,
  trustQueryContextForSubject,
} from '../../shared/trust-context'
import ForceGraphCanvas from './ForceGraphCanvas'
import {
  loadGraphSnapshot,
  queryRating,
  queryTrust,
  queryTrustBatch,
} from './graph-rpc'
import {
  isPostSubject,
  mergeTrustAndRatingForPath,
  pathsToGraph,
} from './graph-view-data'
import {
  isPathPageControlId,
  orderPathColumns,
  pagePathColumns,
  parsePathPageControl,
  PATH_COLUMN_PAGE_SIZE,
} from './path-columns'
import type { GraphViewHandle, GraphViewSnapshot } from './graph-view-types'
import { lookupByGraphNodeId, subjectOfGraphNode } from './graph-display'
import { useGraphNodeEnrichment } from './useGraphNodeEnrichment'
import {
  filterGraphData,
  type GraphViewSettings,
  type GraphVizData,
  type GraphVizNode,
} from './types'
import styles from './GraphPage.module.css'

export interface PathEvidenceViewProps {
  active: boolean
  settings: GraphViewSettings
  pathSubject: TrustSubject
  /** Bumped by Refresh Graph so path evidence reloads with the neighborhood. */
  refreshToken?: number
  darkTheme: boolean
  onSnapshotChange: (snapshot: GraphViewSnapshot) => void
  onSelectNode?: (node: GraphVizNode) => void
}

const PathEvidenceView = forwardRef<GraphViewHandle, PathEvidenceViewProps>(
  function PathEvidenceView(
    {
      active,
      settings,
      pathSubject,
      refreshToken = 0,
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
    const [summaries, setSummaries] = useState<Record<string, TrustSummary>>(
      {},
    )
    const [busy, setBusy] = useState(true)
    const [error, setError] = useState<string>()
    const [truncated, setTruncated] = useState(false)
    const [columnPage, setColumnPage] = useState<Record<number, number>>({})
    const rootPubkeyRef = useRef(rootPubkey)
    rootPubkeyRef.current = rootPubkey

    const { clearDisplayRequestCaches } = useGraphNodeEnrichment(
      rawData,
      setRawData,
      selectedId,
      settings.showUserIcons,
    )

    const rootId = rootIndex
    const focusId = rawData.nodes.find((node) => node.isFocus)?.id

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

    const loadPath = useCallback(async () => {
      setBusy(true)
      setError(undefined)
      try {
        const trustContext = trustQueryContextForSubject(pathSubject)
        const ratingContext = ratingQueryContextForSubject(pathSubject)
        const [trustResult, ratingResult, snap] = await Promise.all([
          queryTrust({
            subject: pathSubject,
            ...contextField(trustContext),
            format: 'path',
          }),
          isPostSubject(pathSubject)
            ? queryRating({
                subject: pathSubject,
                ...contextField(ratingContext),
                format: 'path',
              }).catch(() => null)
            : Promise.resolve(null),
          loadGraphSnapshot(),
        ])
        setRootPubkey(snap.rootPubkey)
        setRootIndex(snap.rootIndex)
        rootPubkeyRef.current = snap.rootPubkey
        const result = mergeTrustAndRatingForPath(
          trustResult,
          ratingResult,
          snap.rootPubkey,
        )
        const data = pathsToGraph(result, snap.rootPubkey)
        setRawData(data)
        setColumnPage({})
        setTruncated(result.truncated)
        clearDisplayRequestCaches()
        const focusNode = data.nodes.find((node) => node.isFocus)
        setSummaries(
          focusNode
            ? { [focusNode.id]: summarizeTrust(result) }
            : {},
        )
        void applyResolutions(data.nodes)
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t('graph.pathLoadError'),
        )
      } finally {
        setBusy(false)
      }
    }, [
      applyResolutions,
      clearDisplayRequestCaches,
      pathSubject,
    ])

    useEffect(() => {
      void loadPath()
    }, [loadPath, refreshToken])

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
      if (rootId !== undefined) ids.add(rootId)
      if (focusId !== undefined) ids.add(focusId)
      return ids
    }, [focusId, rootId])

    const viewData = useMemo(() => {
      const ordered = orderPathColumns(rawData)
      const paged = pagePathColumns(ordered, columnPage)
      return filterGraphData(
        paged,
        settings,
        alwaysKeep,
        rootId !== undefined && focusId !== undefined
          ? { fromId: rootId, toId: focusId }
          : undefined,
      )
    }, [alwaysKeep, columnPage, focusId, rawData, rootId, settings])

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

    const onNodePointerDown = useCallback(
      (node: GraphVizNode) => {
        if (isPathPageControlId(node.id)) return
        setSelectedId(node.id)
        onSelectNode?.(node)
      },
      [onSelectNode],
    )

    const onNodeClick = useCallback(
      (node: GraphVizNode, _event: MouseEvent) => {
        if (!isPathPageControlId(node.id)) return
        const control = parsePathPageControl(node.id)
        if (!control) return
        const pageable = rawData.nodes.filter(
          (entry) =>
            entry.depth === control.depth &&
            !entry.isRoot &&
            !entry.isFocus &&
            entry.kind !== 'aggregate',
        )
        const maxPage = Math.max(
          0,
          Math.ceil(pageable.length / PATH_COLUMN_PAGE_SIZE) - 1,
        )
        setColumnPage((current) => {
          const page = current[control.depth] ?? 0
          const nextPage =
            control.direction === 'next'
              ? Math.min(maxPage, page + 1)
              : Math.max(0, page - 1)
          if (nextPage === page) return current
          return { ...current, [control.depth]: nextPage }
        })
      },
      [rawData.nodes],
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
          pathLayout
          darkTheme={darkTheme}
          active={active}
          onNodeClick={onNodeClick}
          onNodePointerDown={onNodePointerDown}
        />
      </div>
    )
  },
)

export default PathEvidenceView
