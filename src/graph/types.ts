export type TrustValue = -1 | 0 | 1

export type ActiveTrustValue = Exclude<TrustValue, 0>

export type TrustSubject =
  | { type: 'p'; value: string }
  | { type: 'e'; value: string }
  | { type: 'i'; value: string }

/**
 * The graph consumes protocol events after parsing and signature validation.
 * One value per replacement slot is sufficient, although the graph also
 * applies kind-32009 replacement ordering defensively during updates.
 */
export interface ReducedTrustStatement {
  eventId: string
  author: string
  subject: TrustSubject
  context: string
  value: TrustValue
  createdAt: number
  activeFrom?: number
  activeUntil?: number
  /** Present when this edge was derived from a verified X identity binding. */
  derivedFrom?: { subject: TrustSubject; twitterId: string }
}

export type ContextMatch = 'exact' | 'parent' | 'general'

export interface ResolvedStatement {
  eventId: string
  author: string
  subject: TrustSubject
  context: string
  requestedContext: string
  contextMatch: ContextMatch
  value: ActiveTrustValue
  createdAt: number
  activeFrom?: number
  activeUntil?: number
  /** Number of positive pubkey hops from the query root to the evidence author. */
  distance: number
  derivedFrom?: { subject: TrustSubject; twitterId: string }
}

export interface TrustPath {
  /** Ordered pubkeys from the root through the statement author. */
  authors: string[]
  subject: TrustSubject
  /** Traversal event IDs followed by the terminal evidence event ID. */
  sourceEventIds: string[]
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
  paths: TrustPath[]
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
