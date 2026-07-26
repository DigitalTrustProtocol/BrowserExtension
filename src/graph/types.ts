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
  /** Number of positive pubkey edges from the query root to the author. */
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

export interface TrustQueryResult {
  subject: TrustSubject
  context: string
  resolution: TrustResolution
  direct?: ResolvedStatement
  statements: ResolvedStatement[]
  paths: TrustPath[]
  sourceEventIds: string[]
  computedAt: number
  graphVersion: number
  truncated: boolean
}

export interface GraphBounds {
  /** Maximum number of positive pubkey edges from the root. */
  maxDepth: number
  /** Maximum newly reached pubkey authors at any depth after the root. */
  maxAuthorsPerLevel: number
  /** Maximum distinct authors, including the root. */
  maxTotalAuthors: number
  /** Maximum distinct source events retained by one query. */
  maxEvents: number
}

export interface TrustQuery {
  rootPubkey: string
  subject: TrustSubject
  context?: string
  now?: number
  bounds?: Partial<GraphBounds>
}

export interface GraphUpdateResult {
  accepted: number
  ignored: number
  graphVersion: number
}
