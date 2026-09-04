export type TrustValue = -1 | 0 | 1

/** Active graph evidence, including Neutral (`0`). Tombstones never enter the graph. */
export type ActiveTrustValue = TrustValue

export type TrustSubject =
  | { type: 'p'; value: string }
  | { type: 'e'; value: string }
  | { type: 'i'; value: string }

export type ContextMatch = 'exact' | 'parent' | 'general'

export interface ResolvedStatement {
  eventId: string
  /** Storage addressKey (kind:pubkey:d). Page UI key for this connection. */
  connectionKey?: string
  author: string
  subject: TrustSubject
  context: string
  requestedContext: string
  contextMatch: ContextMatch
  value: ActiveTrustValue
  createdAt: number
  activeFrom?: number
  activeUntil?: number
  content?: string
  labels?: string[]
  /** Display-only sanitized descriptions keyed by label token. Not a WoT input. */
  labelHints?: Record<string, string>
  /** Number of positive pubkey hops from the query root to the evidence author. */
  distance: number
}

export interface TrustPath {
  /** Ordered pubkeys from the root through the statement author. */
  authors: string[]
  subject: TrustSubject
  /** Traversal event IDs followed by the terminal evidence event ID. */
  sourceEventIds: string[]
}

export type GraphNodeKind = 'pubkey' | 'twitter_id' | 'post' | 'other'

/**
 * Canvas / RPC vis id: heap `node.index` / `edgesList` index as a number,
 * or a synthetic string (`agg:…`, rating `eventId`, ego-snapshot wire ids).
 */
export type GraphVisId = number | string

/** Serializable Graph/Path vis node. Heap Path/neighborhood `id` is `node.index`. */
export interface GraphPathViewNode {
  id: GraphVisId
  kind: GraphNodeKind
  depth: number
  label: string
  subject?: TrustSubject
}

/** Serializable Graph/Path vis edge. Heap kind 32009 `id` is the edgesList index. */
export interface GraphPathViewEdge {
  id: GraphVisId
  from: GraphVisId
  to: GraphVisId
  value: 1 | 0 | -1
  context: string
  eventId: string
  depth: number
}

export interface GraphPathView {
  nodes: GraphPathViewNode[]
  edges: GraphPathViewEdge[]
}

export type TrustResolution = 'trusted' | 'distrusted' | 'mixed' | 'none'

export type TrustQueryFormat = 'default' | 'path'

export interface TrustQueryResult {
  subject: TrustSubject
  context: string
  resolution: TrustResolution
  /** Count of +1 edges at the hitting degree. */
  trust: number
  /** Count of -1 edges at the hitting degree. */
  distrust: number
  /** Sum of edge values (trust − distrust). */
  trustValue: number
  /** Hitting degree (Me=0, direct trust in subject = 1). */
  degree: number
  connected: boolean
  direct?: ResolvedStatement
  statements: ResolvedStatement[]
  /** @deprecated Path UI uses `pathView`. Kept empty for RPC compat. */
  paths: TrustPath[]
  /** Heap-index vis for Path (`format: 'path'`). */
  pathView?: GraphPathView
  sourceEventIds: string[]
  computedAt: number
  graphVersion: number
  truncated: boolean
}

/**
 * Bounds for IndexResolver / QUERY_TRUST.
 * Fan-out caps are not applied on the heap resolve path.
 */
export interface ResolveBounds {
  /** Maximum hops from root to target (IndexResolver hard-caps at 5). */
  maxDepth: number
}

/**
 * Bounds for WoT relay sync expansion (START_WOT_SYNC).
 * Not used by IndexResolver.
 */
export interface GraphBounds {
  maxDepth: number
  /** Maximum newly reached pubkey authors at any depth after the root. */
  maxAuthorsPerLevel: number
  /** Maximum distinct authors, including the root. */
  maxTotalAuthors: number
  /** Maximum distinct source events retained by one sync. */
  maxEvents: number
}

export interface TrustQuery {
  rootPubkey: string
  subject: TrustSubject
  context?: string
  now?: number
  bounds?: Partial<ResolveBounds>
  /** default = score only; path = reconstruct paths for graph UI. */
  format?: TrustQueryFormat
}

export interface GraphUpdateResult {
  accepted: number
  ignored: number
  graphVersion: number
}

export interface RatingClaimEvidence {
  eventId: string
  author: string
  subject: TrustSubject
  context: string
  /** Active numeric score in [0, 100]. Cancels are not stored as claims. */
  score: number
  labels: string[]
  /** Display-only sanitized descriptions keyed by label token. Not a WoT or rating-filter input. */
  labelHints?: Record<string, string>
  content: string
  createdAt: number
  activeFrom?: number
  activeUntil?: number
  /** Positive-p hops from the query root to the claim author (root = 0). */
  distance: number
}

export interface RatingQuery {
  rootPubkey: string
  subject: TrustSubject
  context?: string
  /** When non-empty, keep claims that have at least one matching label. */
  labels?: string[]
  now?: number
  bounds?: Partial<ResolveBounds>
  /** default = score only; path = reconstruct issuer hop chains for graph UI. */
  format?: TrustQueryFormat
}

export interface RatingQueryResult {
  subject: TrustSubject
  context: string
  claims: RatingClaimEvidence[]
  averageScore: number | null
  claimCount: number
  /** Hitting degree (none = 0, own rating = 1, people you trust = 2). */
  degree: number
  own?: RatingClaimEvidence
  sourceEventIds: string[]
  /** @deprecated Path UI uses `pathView` / `ratingEdges`. */
  paths: TrustPath[]
  /** Issuer hop vis (`format: 'path'`). */
  pathView?: GraphPathView
  /** Terminal kind 32014 strokes (not heap edges). */
  ratingEdges?: GraphPathViewEdge[]
  computedAt: number
  graphVersion: number
}

/** % = trust / (trust + distrust); map to categorical resolution for UI compat. */
export function resolutionFromCounts(
  trust: number,
  distrust: number,
  connected: boolean,
): TrustResolution {
  if (!connected || trust + distrust === 0) return 'none'
  const ratio = trust / (trust + distrust)
  if (ratio >= 0.8) return 'trusted'
  if (ratio >= 0.3) return 'mixed'
  return 'distrusted'
}
