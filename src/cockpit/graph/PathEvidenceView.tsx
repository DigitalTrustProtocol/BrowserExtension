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
  loadGraphSnapshot,
  queryTrust,
  queryTrustBatch,
} from './graph-rpc'
import {
  defaultContextForSubject,
  pathsToGraph,
} from './graph-view-data'
import type { GraphViewHandle, GraphViewSnapshot } from './graph-view-types'
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
  pathContext: string
  darkTheme: boolean
  onSnapshotChange: (snapshot: GraphViewSnapshot) => void
  onInteract: () => void
}

const PathEvidenceView = forwardRef<GraphViewHandle, PathEvidenceViewProps>(
  function PathEvidenceView(
    {
      active,
      settings,
      pathSubject,
      pathContext,
      darkTheme,
      onSnapshotChange,
      onInteract,
    },
    ref,
  ) {
    const [rootPubkey, setRootPubkey] = useState<string>()
    const [rawData, setRawData] = useState<GraphVizData>({
      nodes: [],
      links: [],
    })
    const [selectedId, setSelectedId] = useState<string>()
    const [summaries, setSummaries] = useState<Record<string, TrustSummary>>(
      {},
    )
    const [busy, setBusy] = useState(true)
    const [error, setError] = useState<string>()
    const [truncated, setTruncated] = useState(false)
    const rootPubkeyRef = useRef(rootPubkey)
    rootPubkeyRef.current = rootPubkey

    const { clearDisplayRequestCaches } = useGraphNodeEnrichment(
      rawData,
      setRawData,
      selectedId,
      settings.showUserIcons,
    )

    const rootId = rootPubkey ? `p:${rootPubkey}` : undefined
    const focusId = subjectNodeId(pathSubject)

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

    const loadPath = useCallback(async () => {
      setBusy(true)
      setError(undefined)
      try {
        const result = await queryTrust({
          subject: pathSubject,
          context: pathContext || defaultContextForSubject(pathSubject),
          format: 'path',
        })
        const snap = await loadGraphSnapshot({ maxDepth: 1, maxNodes: 2 })
        setRootPubkey(snap.rootPubkey)
        rootPubkeyRef.current = snap.rootPubkey
        const data = pathsToGraph(result, snap.rootPubkey)
        setRawData(data)
        setTruncated(result.truncated)
        clearDisplayRequestCaches()
        setSummaries({
          [subjectNodeId(pathSubject)]: summarizeTrust(result),
        })
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
      pathContext,
      pathSubject,
    ])

    useEffect(() => {
      void loadPath()
    }, [loadPath])

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
      ids.add(focusId)
      if (selectedId) ids.add(selectedId)
      return ids
    }, [focusId, rootId, selectedId])

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
      (node: GraphVizNode, _event: MouseEvent) => {
        onInteract()
        setSelectedId(node.id)
      },
      [onInteract],
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
          onNodeClick={onNodeClick}
        />
      </div>
    )
  },
)

export default PathEvidenceView
