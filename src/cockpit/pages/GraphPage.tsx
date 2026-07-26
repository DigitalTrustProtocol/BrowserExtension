import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BACKGROUND_API_VERSION,
  type ExtensionResponse,
  type GraphSnapshot,
} from '../../shared/contracts'
import Card from '@components/Card/Card'
import { SectionLabel } from '@components/SectionLabel/SectionLabel'
import styles from '../CockpitApp.module.css'

async function loadGraph(): Promise<GraphSnapshot> {
  const response = (await chrome.runtime.sendMessage({
    type: 'GET_GRAPH_SNAPSHOT',
    version: BACKGROUND_API_VERSION,
    maxDepth: 4,
    maxNodes: 400,
  })) as ExtensionResponse<GraphSnapshot>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

interface GraphPageProps {
  refreshToken: number
}

export default function GraphPage({ refreshToken }: GraphPageProps) {
  const [graph, setGraph] = useState<GraphSnapshot>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(true)

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      setGraph(await loadGraph())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshToken])

  const byDepth = useMemo(() => {
    if (!graph) return []
    const map = new Map<number, typeof graph.nodes>()
    for (const node of graph.nodes) {
      const list = map.get(node.depth) ?? []
      list.push(node)
      map.set(node.depth, list)
    }
    return [...map.entries()].sort(([a], [b]) => a - b)
  }, [graph])

  return (
    <>
      {error ? <p className={styles.error}>{error}</p> : null}
      {!graph && busy ? (
        <Card className={styles.section}>
          <p className={styles.muted}>Loading in-memory trust graph…</p>
        </Card>
      ) : null}

      {graph ? (
        <>
          <section className={styles.section}>
            <SectionLabel>Your trust graph</SectionLabel>
            <div className={styles.statGrid}>
              <div className={styles.statCard}>
                <span className={styles.statValue}>{graph.nodeCount}</span>
                <span className={styles.statLabel}>Nodes</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statValue}>{graph.edgeCount}</span>
                <span className={styles.statLabel}>Edges</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statValue}>{graph.statementCount}</span>
                <span className={styles.statLabel}>Reduced statements</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statValue}>{graph.maxDepth}</span>
                <span className={styles.statLabel}>Max depth</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statValue}>v{graph.graphVersion}</span>
                <span className={styles.statLabel}>Graph version</span>
              </div>
            </div>
            <Card className={styles.panel}>
              <dl className={styles.detailList}>
                <div>
                  <dt>Root npub</dt>
                  <dd className={styles.mono}>{graph.rootNpub ?? graph.rootPubkey}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    {graph.truncated
                      ? 'Truncated to keep the view bounded'
                      : 'Complete within depth bound'}
                  </dd>
                </div>
              </dl>
            </Card>
          </section>

          <section className={styles.section}>
            <SectionLabel>Nodes by hop</SectionLabel>
            {byDepth.map(([depth, nodes]) => (
              <Card key={depth} className={styles.panel}>
                <h2>
                  Depth {depth}
                  <span className={styles.mutedInline}> · {nodes.length}</span>
                </h2>
                <ul className={styles.chipList}>
                  {nodes.map((node) => (
                    <li
                      key={node.id}
                      className={`${styles.chip} ${styles[`chip_${node.kind}`] ?? ''}`}
                      title={node.id}
                    >
                      <span className={styles.chipKind}>{node.kind}</span>
                      {node.label}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
            {graph.nodes.length === 0 ? (
              <Card className={styles.panel}>
                <p className={styles.muted}>
                  No trust edges in memory yet. Sync relays from the popup to
                  populate your Web of Trust.
                </p>
              </Card>
            ) : null}
          </section>

          <section className={styles.section}>
            <SectionLabel>Edges</SectionLabel>
            <Card className={styles.panel}>
              {graph.edges.length > 0 ? (
                <ul className={styles.list}>
                  {graph.edges.slice(0, 120).map((edge) => (
                    <li key={`${edge.eventId}:${edge.to}`}>
                      <span className={styles.edgeLine}>
                        <span className={styles.mono}>{edge.from.replace(/^p:/, '').slice(0, 10)}…</span>
                        <span className={edge.value === 1 ? styles.trust : styles.distrust}>
                          {edge.value === 1 ? 'trust' : 'distrust'}
                        </span>
                        <span className={styles.mono}>{edge.to}</span>
                      </span>
                      <strong className={styles.mutedInline}>d{edge.depth}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>No edges.</p>
              )}
              {graph.edges.length > 120 ? (
                <p className={styles.muted}>
                  Showing 120 of {graph.edges.length} edges.
                </p>
              ) : null}
            </Card>
          </section>
        </>
      ) : null}
    </>
  )
}
