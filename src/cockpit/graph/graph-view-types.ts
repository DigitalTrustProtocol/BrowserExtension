import type { TrustSummary } from '../../content/trust-summary'
import type { TrustQueryResult, TrustSubject } from '../../graph'
import type { GraphVizNode } from './types'

/** Lifted status from a keep-alive graph/path view for the workspace shell. */
export interface GraphViewSnapshot {
  selectedId?: string
  selectedNode?: GraphVizNode
  rootPubkey?: string
  summaries: Record<string, TrustSummary>
  nodeCount: number
  linkCount: number
  busy: boolean
  error?: string
  truncated: boolean
}

export const EMPTY_GRAPH_VIEW_SNAPSHOT: GraphViewSnapshot = {
  summaries: {},
  nodeCount: 0,
  linkCount: 0,
  busy: true,
  truncated: false,
}

/** Imperative API so the shell can refresh trust after publish/cancel. */
export interface GraphViewHandle {
  applySelectedResult: (
    subject: TrustSubject,
    result: TrustQueryResult,
  ) => void
}
