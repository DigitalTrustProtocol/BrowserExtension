import type {
  GraphBounds,
  ResolveBounds,
  TrustSubject as GraphTrustSubject,
  TrustQueryResult,
} from '../graph'
import type { AppMode } from './app-mode'
import type { ObservedXIdentity } from './observed-x-identity'
import type {
  ActiveXAccountReport,
  ProofComposerSession,
} from './proof-composer'
import type { ResolveTimingSnapshot } from './resolve-timing'

export const BACKGROUND_API_VERSION = 1 as const
export const NIP39_EVENT_KIND = 10011
export const STORAGE_KEY = 'attentionx-state-v1'

export const DEFAULT_RELAYS = [
  'wss://nos.lol',
  'wss://nostr-01.yakihonne.com',
] as const

export interface PublicExtensionState {
  hasIdentity: boolean
  npub?: string
  pubkey?: string
  vaultLocked?: boolean
  relays: string[]
  cachedEventCount: number
  /** Sync and Resolve max degree (1–5). */
  wotMaxDegree: number
  /** Resolve timing summary for popup soft hint. */
  resolveTimingHint?: {
    heaviestDegree: number
    avgMs: number
    samples: number
  }
  activeXAccount?: ActiveXAccountReport
  proofSession?: ProofComposerSession
  syncStatus?: {
    state: 'idle' | 'running' | 'complete' | 'error' | 'stopped'
    startedAt?: number
    finishedAt?: number
    error?: string
  }
}

export interface CockpitStorageStats {
  databaseName: string
  databaseVersion: number
  stores: Record<string, number>
  eventsByKind: Record<string, number>
  outboxByStatus: Record<string, number>
}

export interface CockpitChromeStorageSummary {
  localKeys: string[]
  syncKeys: string[]
  localBytesEstimate: number
  syncBytesEstimate: number
  accountCount: number
  allowedDomainCount: number
  activityLogCount: number
  vaultExists: boolean
  autoLockMs: number | null
}

export interface CockpitState {
  generatedAt: number
  extension: PublicExtensionState
  storage: CockpitStorageStats
  chromeStorage: CockpitChromeStorageSummary
  syncStatus: PublicExtensionState['syncStatus']
  resolveTiming: ResolveTimingSnapshot
}

export interface GraphSnapshotNode {
  id: string
  kind: 'pubkey' | 'twitter_id' | 'post' | 'other'
  depth: number
  label: string
}

export interface GraphSnapshotEdge {
  from: string
  to: string
  value: 1 | -1
  context: string
  eventId: string
  depth: number
}

export interface GraphSnapshot {
  generatedAt: number
  graphVersion: number
  rootPubkey: string
  rootNpub?: string
  statementCount: number
  nodeCount: number
  edgeCount: number
  truncated: boolean
  maxDepth: number
  nodes: GraphSnapshotNode[]
  edges: GraphSnapshotEdge[]
}

export type GraphNeighborhoodDirection = 'out' | 'in' | 'both'
export type GraphNeighborhoodValueFilter = 'trust' | 'distrust' | 'both'

export interface GraphNeighborhood {
  generatedAt: number
  graphVersion: number
  centerId: string
  truncated: boolean
  nodes: GraphSnapshotNode[]
  edges: GraphSnapshotEdge[]
}

export interface AppRelayHealthRow {
  relayUrl: string
  status: 'up' | 'down' | 'unknown'
  lastError?: string
  lastCheckedAt: number
  lastSuccessAt?: number
  consecutiveFailures: number
}

export interface AppRelayErrorRow {
  id: string
  relayUrl: string
  at: number
  kind: string
  message: string
}

export interface AppLogsState {
  generatedAt: number
  relayHealth: AppRelayHealthRow[]
  relayErrors: AppRelayErrorRow[]
  activityLog: Array<Record<string, unknown>>
}

export type XIdentityProofState =
  | 'unverified'
  | 'pending'
  | 'verified'
  | 'expired'
  | 'revoked'

export type XIdentityBlockedBy =
  | 'missing-nip39'
  | 'missing-x-proof'
  | 'proof-unavailable'
  | 'mismatch'

/** Broadcast when an xIdentities row's derived status changes. */
export interface XIdentityUpdatedMessage {
  type: 'X_IDENTITY_UPDATED'
  twitterId: string
  state: XIdentityProofState
  blockedBy?: XIdentityBlockedBy
  handle: string
}

/** Result of an explicit status re-derive for one xIdentities row. */
export interface XIdentityStatusSyncResult {
  twitterId: string
  previousState: XIdentityProofState
  previousBlockedBy?: XIdentityBlockedBy
  state: XIdentityProofState
  blockedBy?: XIdentityBlockedBy
  changed: boolean
  identity: XIdentityListRow
}

export interface XIdentityListRow {
  twitterId: string
  handle: string
  displayName?: string
  iconPath?: string
  xProofNpub?: string
  xProofPostId?: string
  xProofHandle?: string
  xProofObservedAt?: number
  nip39Npub?: string
  nip39XId?: string
  nip39Handle?: string
  nip39PostId?: string
  nip39EventId?: string
  nip39ObservedAt?: number
  state: XIdentityProofState
  blockedBy?: XIdentityBlockedBy
  verifiedAt?: number
  createdAt: number
  updatedAt: number
  lastSeen: number
}

export type XIdentitySortField =
  | 'username'
  | 'twitterId'
  | 'proofState'
  | 'npub'
  | 'updatedAt'
  | 'lastSeen'

export type XIdentitySortDir = 'asc' | 'desc'

export interface XIdentitiesState {
  generatedAt: number
  total: number
  offset: number
  limit: number
  query: string
  sortBy: XIdentitySortField
  sortDir: XIdentitySortDir
  identities: XIdentityListRow[]
}

/** Cached IndexedDB event row for the Application Events list. */
export interface EventListRow {
  id: string
  pubkey: string
  npub: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
  firstSeenAt: number
  /** Addressable slot key: `kind:pubkey:d`. */
  addressKey: string
  /** Local system marker (e.g. `demo`); omitted when unset. */
  state?: string
  /** Kind 32009 `v` when parseable. */
  trustValue?: string
  /** Parsed subject wire id (e.g. `i:post:id:…`). */
  subjectId?: string
  /** Human subject summary (raw `i` / `p` / `e` value). */
  subjectSummary?: string
  /** Enriched subject label from xIdentities / xPosts when known. */
  subjectLabel?: string
  subjectKind?: 'pubkey' | 'twitter_id' | 'post' | 'other'
  subjectHandle?: string
  subjectHeadline?: string
  subjectRole?: 'root' | 'reply' | 'quote' | 'repost'
  subjectPicturePath?: string
}

export type EventSortField =
  | 'kind'
  | 'id'
  | 'pubkey'
  | 'created_at'
  | 'firstSeenAt'
  | 'addressKey'
  | 'state'

export type EventSortDir = 'asc' | 'desc'

export interface EventsState {
  generatedAt: number
  total: number
  offset: number
  limit: number
  query: string
  sortBy: EventSortField
  sortDir: EventSortDir
  events: EventListRow[]
  /** When filtered by Users drill-down. */
  filterTwitterId?: string
  filterPubkeys?: string[]
}

/** Trust-gated X post chrome row for Application Posts list. */
export interface XPostListRow {
  postId: string
  authorTwitterId?: string
  authorHandle?: string
  headline?: string
  role?: 'root' | 'reply' | 'quote' | 'repost'
  parentPostId?: string
  createdAt: number
  updatedAt: number
  lastSeen: number
}

export type XPostSortField = 'postId' | 'lastSeen' | 'updatedAt' | 'authorHandle'
export type XPostSortDir = 'asc' | 'desc'

export interface XPostsState {
  generatedAt: number
  total: number
  offset: number
  limit: number
  query: string
  sortBy: XPostSortField
  sortDir: XPostSortDir
  posts: XPostListRow[]
}

/** Per-relay delivery snapshot for Outbox Manager. */
export interface OutboxRelayRow {
  relayUrl: string
  status: 'pending' | 'published' | 'failed' | 'exhausted'
  attempts: number
  nextAttemptAt?: number
  lastAttemptAt?: number
  publishedAt?: number
  lastError?: string
}

/** One outbox row joined with a short event preview. */
export interface OutboxListRow {
  eventId: string
  createdAt: number
  updatedAt: number
  /** Earliest pending/failed nextAttemptAt (hold / retry). */
  heldUntil?: number
  kind?: number
  pubkey?: string
  created_at?: number
  content?: string
  /** Kind 32009 subject summary when parseable. */
  subjectSummary?: string
  /** Kind 32009 `v` when parseable. */
  trustValue?: string
  relays: OutboxRelayRow[]
  /** True when any relay already has status published. */
  anyPublished: boolean
}

export interface OutboxState {
  generatedAt: number
  items: OutboxListRow[]
}

/** Minimal xIdentities profile fields for graph / UI display. */
export interface XIdentityDisplay {
  displayName?: string
  handle?: string
  iconPath?: string
}

export type {
  ActiveXAccountReport,
  ProofComposerPreview,
  ProofComposerSession,
  XIdentityPublishChange,
  XIdentityPublishEventPreview,
  XIdentityPublishPreview,
  XIdentityPublishResult,
  XIdentityPublishTwitterClaim,
  XProofCheckResult,
  XProofCheckSource,
} from './proof-composer'

export {
  APP_MODE_CHANGED_MESSAGE,
  APP_MODE_STORAGE_KEY,
  DEFAULT_APP_MODE,
  isAppMode,
  parseAppMode,
  type AppMode,
} from './app-mode'

export interface PublishResult {
  eventId: string
  deliveredTo: number
  attemptedRelays: number
  deliveryStatus?: 'complete' | 'partial' | 'pending' | 'failed'
  /** True when the statement was stored locally only (demo mode). */
  localOnly?: boolean
  /** Unix ms when the regret hold ends (relay publish not attempted yet). */
  heldUntil?: number
}

export type SerializableTrustSubject = GraphTrustSubject

/** Cap for subjects resolved in one QUERY_TRUST_BATCH request. */
export const MAX_TRUST_BATCH_ITEMS = 200

export interface QueryTrustBatchItem {
  key: string
  subject: SerializableTrustSubject
  context?: string
}

export interface QueryTrustBatchResult {
  graphVersion: number
  results: Record<string, TrustQueryResult>
  errors?: Record<string, string>
}

interface VersionedRequest {
  version: typeof BACKGROUND_API_VERSION
}

export type ExtensionRequest =
  | { type: 'GET_STATE' }
  | { type: 'GET_COCKPIT_STATE' }
  | (VersionedRequest & {
      type: 'GET_GRAPH_SNAPSHOT'
      maxDepth?: number
      maxNodes?: number
      context?: string
    })
  | (VersionedRequest & {
      type: 'GET_GRAPH_NEIGHBORHOOD'
      centerId: string
      direction?: GraphNeighborhoodDirection
      valueFilter?: GraphNeighborhoodValueFilter
      context?: string
      limit?: number
    })
  | (VersionedRequest & {
      type: 'OPEN_GRAPH_PAGE'
      /** Full extension URL or search string built by graph-deeplink. */
      url: string
    })
  | (VersionedRequest & { type: 'CLOSE_GRAPH_PAGE' })
  | (VersionedRequest & { type: 'OPEN_OUTBOX_PAGE' })
  | (VersionedRequest & { type: 'GET_OUTBOX' })
  | (VersionedRequest & {
      type: 'DELETE_OUTBOX_EVENT'
      eventId: string
    })
  | (VersionedRequest & {
      type: 'PUBLISH_OUTBOX_NOW'
      eventId: string
    })
  | (VersionedRequest & { type: 'PUBLISH_OUTBOX_ALL_NOW' })
  | (VersionedRequest & {
      type: 'GET_APP_LOGS'
      errorLimit?: number
      activityLimit?: number
    })
  | (VersionedRequest & {
      type: 'GET_X_IDENTITIES'
      query?: string
      offset?: number
      limit?: number
      sortBy?: XIdentitySortField
      sortDir?: XIdentitySortDir
    })
  | (VersionedRequest & {
      type: 'GET_EVENTS'
      query?: string
      offset?: number
      limit?: number
      sortBy?: EventSortField
      sortDir?: EventSortDir
      /** Users drill-down: events authored by linked pubkeys for this X user. */
      twitterId?: string
    })
  | (VersionedRequest & {
      type: 'GET_X_POSTS'
      query?: string
      offset?: number
      limit?: number
      sortBy?: XPostSortField
      sortDir?: XPostSortDir
    })
  | (VersionedRequest & {
      type: 'UPSERT_X_POST_CHROME'
      posts: Array<{
        postId: string
        authorTwitterId?: string
        authorHandle?: string
        headline?: string
        role?: 'root' | 'reply' | 'quote' | 'repost'
        parentPostId?: string
        observedAt?: number
      }>
    })
  | { type: 'GENERATE_IDENTITY' }
  | { type: 'IMPORT_IDENTITY'; nsec: string }
  | { type: 'CLEAR_IDENTITY' }
  | { type: 'SAVE_RELAYS'; relays: string[] }
  | {
      type: 'PUBLISH_X_IDENTITY'
      version?: typeof BACKGROUND_API_VERSION
      handle: string
      twitterId: string
      proofTweetId: string
    }
  | (VersionedRequest & {
      type: 'INGEST_X_IDENTITIES'
      observations: ObservedXIdentity[]
    })
  | (VersionedRequest & {
      type: 'GET_X_IDENTITY'
      twitterId: string
    })
  | (VersionedRequest & {
      type: 'GET_X_IDENTITY_DISPLAYS'
      twitterIds: string[]
    })
  | (VersionedRequest & {
      /** Re-derive state/blockedBy from current xIdentities columns. */
      type: 'SYNC_X_IDENTITY_STATUS'
      twitterId: string
    })
  | (VersionedRequest & {
      type: 'CHECK_X_PROOF'
      handle: string
      twitterId: string
      queryRelays?: boolean
      scanPage?: boolean
      /** Re-run GraphQL even when a local (unverified) X-proof row exists. */
      forceRescan?: boolean
    })
  | (VersionedRequest & {
      /** Explicit proof discovery for the active user or any other X account. */
      type: 'SEARCH_X_PROOF'
      handle: string
      twitterId: string
      /** Default true — refresh incomplete xIdentities via GraphQL search. */
      forceRescan?: boolean
    })
  | (VersionedRequest & {
      type: 'GENERATE_X_PROOF'
      handle?: string
      twitterId?: string
    })
  | (VersionedRequest & {
      type: 'VERIFY_X_PROOF'
      event: {
        id: string
        pubkey: string
        kind: number
        created_at: number
        tags: string[][]
        content: string
        sig: string
      }
    })
  | (VersionedRequest & {
      type: 'REPORT_ACTIVE_X_ACCOUNT'
      account: ActiveXAccountReport | null
    })
  | (VersionedRequest & { type: 'GET_ACTIVE_X_ACCOUNT' })
  | (VersionedRequest & { type: 'ENSURE_ACTIVE_X_ACCOUNT' })
  | (VersionedRequest & {
      type: 'PREPARE_X_PROOF_COMPOSER'
      handle: string
      twitterId: string
    })
  | (VersionedRequest & {
      type: 'CONFIRM_X_PROOF_COMPOSER'
      handle: string
      twitterId: string
    })
  | (VersionedRequest & { type: 'GET_PROOF_COMPOSER_SESSION' })
  | (VersionedRequest & {
      type: 'CAPTURE_X_PROOF_POST'
      proofTweetId: string
    })
  | (VersionedRequest & {
      type: 'PUBLISH_STAGED_X_PROOF'
      handle: string
      twitterId: string
      proofTweetId: string
    })
  | (VersionedRequest & {
      type: 'PREPARE_X_IDENTITY_PUBLISH'
      handle: string
      twitterId: string
      proofTweetId: string
    })
  | (VersionedRequest & {
      type: 'CONFIRM_X_IDENTITY_PUBLISH'
      handle: string
      twitterId: string
      proofTweetId: string
      /** Must match the previewed existing event id (or null). */
      existingEventId: string | null
      /** Required when preview.change === 'replace'. */
      confirmReplacement?: boolean
    })
  | (VersionedRequest & { type: 'CANCEL_PROOF_COMPOSER' })
  | (VersionedRequest & {
      type: 'PUBLISH_TRUST_STATEMENT'
      subject: SerializableTrustSubject
      value: '1' | '-1'
      context?: string
      content?: string
      activationTime?: number
      expirationTime?: number
      /** Optional X handle hint for one-shot proof discovery on trust. */
      hintHandle?: string
    })
  | (VersionedRequest & {
      type: 'CANCEL_TRUST_STATEMENT'
      subject: SerializableTrustSubject
      context?: string
      content?: string
    })
  | (VersionedRequest & {
      type: 'QUERY_TRUST'
      subject: SerializableTrustSubject
      context?: string
      rootPubkey?: string
      now?: number
      bounds?: Partial<ResolveBounds>
      /** default = score only; path = reconstruct paths for graph UI */
      format?: 'default' | 'path'
    })
  | (VersionedRequest & {
      type: 'QUERY_TRUST_BATCH'
      items: QueryTrustBatchItem[]
      rootPubkey?: string
      now?: number
      bounds?: Partial<ResolveBounds>
      format?: 'default' | 'path'
    })
  | (VersionedRequest & {
      type: 'START_WOT_SYNC'
      overlapSeconds?: number
      limits?: Partial<GraphBounds>
    })
  | (VersionedRequest & { type: 'GET_WOT_SYNC_STATUS' })
  | (VersionedRequest & { type: 'STOP_WOT_SYNC' })
  /** Local-only demo WoT seed (IndexedDB ingest; never enqueued to relays). */
  | (VersionedRequest & { type: 'SEED_DEMO_WOT' })
  | (VersionedRequest & { type: 'CLEAR_DEMO_WOT' })
  | (VersionedRequest & { type: 'GET_DEMO_WOT_STATUS' })
  | (VersionedRequest & { type: 'GET_APP_MODE' })
  | (VersionedRequest & {
      type: 'SET_APP_MODE'
      mode: AppMode
    })
  | (VersionedRequest & { type: 'GET_WOT_MAX_DEGREE' })
  | (VersionedRequest & {
      type: 'SET_WOT_MAX_DEGREE'
      degree: number
    })
  /** Danger-zone wipe from Security settings. */
  | (VersionedRequest & {
      type: 'DELETE_USER_DATA'
      mode: DeleteUserDataMode
    })

export type DeleteUserDataMode = 'all' | 'keys' | 'cache'

export interface DeleteUserDataResult {
  mode: DeleteUserDataMode
}

export interface DemoWotStatus {
  eventCount: number
}

export interface DemoWotSeedResult extends DemoWotStatus {
  fakeAuthors: number
  maxDepth: number
  statements: number
  identitySubjects: number
  postSubjects: number
  clearedBeforeSeed: number
}

export interface DemoWotClearResult extends DemoWotStatus {
  deleted: number
}

export type ExtensionResponse<T> =
  | { ok: true; version: typeof BACKGROUND_API_VERSION; data: T }
  | {
      ok: false
      version: typeof BACKGROUND_API_VERSION
      error: string
    }
