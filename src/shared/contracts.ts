import type {
  GraphBounds,
  RatingQueryResult,
  ResolveBounds,
  TrustSubject as GraphTrustSubject,
  TrustQueryResult,
} from '../graph'
import type { AppMode } from './app-mode'
import type { ObservedXBioCandidate } from './observed-x-bio'
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
  /** Set when signed-in X has no vault binding yet. */
  needsNostrForX?: string
  /** Vault account id bound to active X (when known). */
  xBoundAccountId?: string
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

export type XIdentityProofSource =
  | 'bio'
  | 'post'
  | 'nip39'
  | 'trust32009'

/**
 * Broadcast when an xIdentities row changes.
 * `statusChanged` is true only when derived `state` / `proofSource` changed —
 * content-script trust overlays invalidate on that flag alone so Me-profile
 * chrome / lastSeen updates do not flash chip spinners.
 */
export interface XIdentityUpdatedMessage {
  type: 'X_IDENTITY_UPDATED'
  twitterId: string
  state: XIdentityProofState
  proofSource?: XIdentityProofSource
  handle: string
  /** True when proof status (or proofSource) changed; false for chrome-only. */
  statusChanged: boolean
}

/** Result of an explicit status re-derive for one xIdentities row. */
export interface XIdentityStatusSyncResult {
  twitterId: string
  previousState: XIdentityProofState
  previousProofSource?: XIdentityProofSource
  state: XIdentityProofState
  proofSource?: XIdentityProofSource
  changed: boolean
  identity: XIdentityListRow
}

export interface XIdentityListRow {
  twitterId: string
  handle: string
  displayName?: string
  iconPath?: string
  xNpub?: string
  xDate?: number
  xObservedAt?: number
  postNpub?: string
  postId?: string
  postHandle?: string
  postDate?: number
  postObservedAt?: number
  nip39Npub?: string
  nip39XId?: string
  nip39Handle?: string
  nip39PostId?: string
  nip39Date?: number
  eventNpub?: string
  eventDate?: number
  eventId?: string
  eventIssuer?: string
  state: XIdentityProofState
  proofSource?: XIdentityProofSource
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
  /** Kind 32014 canonical score when parseable (`""` = cancel). */
  ratingScore?: string
  /** Kind 32014 labels. */
  ratingLabels?: string[]
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

/** Compact xPosts chrome for Graph node enrichment. */
export interface XPostDisplay {
  headline?: string
  authorHandle?: string
  authorTwitterId?: string
  role?: 'root' | 'reply' | 'quote' | 'repost'
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
  /** Kind 32014 canonical score when parseable (`""` = cancel). */
  ratingScore?: string
  /** Kind 32014 labels. */
  ratingLabels?: string[]
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
  XBindingPublishResult,
  XIdentityClearPreview,
  XIdentityClearResult,
  XIdentityPublishChange,
  XIdentityPublishEventPreview,
  XIdentityPublishPreview,
  XIdentityPublishResult,
  XIdentityPublishTwitterClaim,
  XProofCheckResult,
  XProofCheckSource,
} from './proof-composer'

export type { XIdentitySuggestFlags } from './x-identity-suggest'

export type {
  SuggestedXBio,
  XBioEditMode,
  XBioEditPreview,
  XBioSuffixUsed,
} from './x-bio-edit'

export { X_BIO_MAX_CHARS, X_EDIT_PROFILE_URL } from './x-bio-edit'

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

/** Cap for artifacts resolved in one QUERY_RATING_BATCH request. */
export const MAX_RATING_BATCH_ITEMS = 200

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

export interface QueryRatingBatchItem {
  key: string
  subject: SerializableTrustSubject
  context?: string
  labels?: string[]
}

export interface QueryRatingBatchResult {
  graphVersion: number
  results: Record<string, RatingQueryResult>
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
      type: 'GET_X_POST_DISPLAYS'
      postIds: string[]
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
      /** Passive GraphQL proof candidates — SW revalidates before identity/xPosts writes. */
      type: 'REPORT_X_PROOF_CANDIDATES'
      candidates: Array<{
        twitterId: string
        handle: string
        postId: string
        npub: string
        fullText: string
        postedAt?: number
        observedAt: number
      }>
    })
  | (VersionedRequest & {
      /**
       * Passive Bio (primary X) npub candidates from `legacy.description`.
       * Never carries raw bio text — only the extracted npub and carrier-post
       * evidence. Backend `#ingestXBioCandidates` → `#recordBioSide` writes
       * `xIdentities.xNpub` / `xDate` / `xObservedAt` and re-runs status sync
       * (see `x-identity.mdc` / `evaluateXIdentityRow` precedence).
       */
      type: 'REPORT_X_BIO_CANDIDATES'
      candidates: ObservedXBioCandidate[]
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
      /** Re-derive state/proofSource from current xIdentities columns. */
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
      type: 'PREPARE_X_BIO_EDIT'
      handle: string
      twitterId: string
      /** When true, produce the replace suggestion for a conflicting bio npub. */
      confirmReplace?: boolean
      /** When true, produce a bio with the active npub stripped (Unlink). */
      removeNpub?: boolean
    })
  | (VersionedRequest & {
      type: 'GET_X_IDENTITY_SUGGEST_FLAGS'
      /** Optional when `xIdentities` already has a handle for this twitterId. */
      handle?: string
      twitterId: string
    })
  | (VersionedRequest & {
      type: 'PUBLISH_X_BINDING'
      /** Optional when `xIdentities` already has a handle for this twitterId. */
      handle?: string
      twitterId: string
      /** When true, publish again even if a matching local 10011 already exists. */
      force?: boolean
    })
  | (VersionedRequest & {
      type: 'MARK_X_BINDING_SETUP'
      handle: string
      twitterId: string
      /** Persist that the X bio embeds the active npub (no further bio probes). */
      bioUpdated?: boolean
      /** Persist that kind 10011 binding is published for this pair. */
      publishedBinding?: boolean
    })
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
  | (VersionedRequest & {
      type: 'PREPARE_X_IDENTITY_CLEAR'
      handle: string
      twitterId: string
    })
  | (VersionedRequest & {
      type: 'CONFIRM_X_IDENTITY_CLEAR'
      handle: string
      twitterId: string
      /** Must match the previewed existing event id (or null). */
      existingEventId: string | null
    })
  | (VersionedRequest & {
      type: 'CLEAR_X_IDENTITY_SIDES'
      twitterId: string
      /** Clear Bio side columns (xNpub/xDate/xObservedAt). */
      bio?: boolean
      /** Clear Post side columns. */
      post?: boolean
      /** Clear nip39* columns for rows bound to the active npub. */
      nip39?: boolean
    })
  | (VersionedRequest & { type: 'CANCEL_PROOF_COMPOSER' })
  | (VersionedRequest & {
      type: 'PUBLISH_TRUST_STATEMENT'
      subject: SerializableTrustSubject
      value: '1' | '0' | '-1'
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
      type: 'PUBLISH_RATING_STATEMENT'
      subject: SerializableTrustSubject
      score: string
      labels?: string[]
      context?: string
      content?: string
      activationTime?: number
      expirationTime?: number
    })
  | (VersionedRequest & {
      type: 'CANCEL_RATING_STATEMENT'
      subject: SerializableTrustSubject
      context?: string
      content?: string
    })
  | (VersionedRequest & {
      type: 'QUERY_RATING'
      subject: SerializableTrustSubject
      context?: string
      labels?: string[]
      rootPubkey?: string
      now?: number
      bounds?: Partial<ResolveBounds>
    })
  | (VersionedRequest & {
      type: 'QUERY_RATING_BATCH'
      items: QueryRatingBatchItem[]
      rootPubkey?: string
      now?: number
      bounds?: Partial<ResolveBounds>
    })
  | (VersionedRequest & {
      type: 'OPEN_SIDE_PANEL'
      subject: SerializableTrustSubject
      context?: string
    })
  | (VersionedRequest & { type: 'GET_SELECTED_SUBJECT' })
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
