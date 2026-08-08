export interface SignedNostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

/** Local-only system marker on an event row (not part of the signed payload). */
export type EventState = 'demo'

export interface EventRecord extends SignedNostrEvent {
  firstSeenAt: number
  /** Addressable slot key: `kind:pubkey:d` (empty d for kind 10011). */
  addressKey: string
  /** Optional local system state (e.g. demo WoT). */
  state?: EventState | string
}

export interface RelayObservationRecord {
  key: string
  relayUrl: string
  eventId: string
  firstSeenAt: number
  lastSeenAt: number
}

export interface RetryState {
  attempts: number
  nextRetryAt?: number
  lastError?: string
}

export interface SyncCursorRecord {
  key: string
  relayUrl: string
  scopeHash: string
  lastSeenCreatedAt: number
  lastEoseAt?: number
  retry: RetryState
  updatedAt: number
}

export type IdentityProofState =
  | 'unverified'
  | 'pending'
  | 'verified'
  | 'expired'
  | 'revoked'

/** Why a row is not yet verified — drives UI copy for the missing side. */
export type XIdentityBlockedBy =
  | 'missing-nip39'
  | 'missing-x-proof'
  | 'proof-unavailable'
  | 'mismatch'

/**
 * Local verification table: one row per X user.
 * X proof side and kind-10011 side are recorded independently and may arrive
 * in either order. Each update re-runs status sync; when both sides align,
 * live `verifyNip39Proof` may promote to `verified` (graph aliases).
 * Lookups are always by `twitterId`. `handle` is the latest mutable username.
 */
export interface XIdentityRecord {
  twitterId: string
  /** Latest observed handle (normalized). Empty when unknown / cleared. */
  handle: string
  /** Public display name observed from X profile metadata. */
  displayName?: string
  /** pbs.twimg.com profile_images path stem (no size suffix). */
  iconPath?: string
  /** X proof side — npub found in the account's own linking post. */
  xProofNpub?: string
  xProofPostId?: string
  xProofHandle?: string
  /** X proof-post creation time (ms), from GraphQL `legacy.created_at`. */
  xProofPostedAt?: number
  /** Local discovery / last oEmbed-accept time for the X proof side. */
  xProofObservedAt?: number
  /** Kind 10011 side — what the Nostr event asserted. */
  nip39Npub?: string
  nip39XId?: string
  nip39Handle?: string
  nip39PostId?: string
  nip39EventId?: string
  nip39ObservedAt?: number
  state: IdentityProofState
  blockedBy?: XIdentityBlockedBy
  verifiedAt?: number
  createdAt: number
  /** Last time row *data* changed (handle, profile, proof, status, …). */
  updatedAt: number
  /** Last time this X user was observed/ingested (touch). */
  lastSeen: number
}

/** GraphQL-derived post role for trust-gated `xPosts` chrome. */
export type XPostRole = 'root' | 'reply' | 'quote' | 'repost'

/**
 * Local display chrome for an X post that was seen on X and has trust evidence.
 * Not a full tweet archive — capped headline + optional role/parent only.
 */
export interface XPostRecord {
  postId: string
  authorTwitterId?: string
  /** Latest observed author handle (normalized). */
  authorHandle?: string
  /** Capped snippet from DOM / timeline (see CARD_TITLE_MAX_CHARS). */
  headline?: string
  /** Omit when classification is unknown (e.g. DOM-only path). */
  role?: XPostRole
  /** Parent / quoted / reposted post id when role is reply|quote|repost. */
  parentPostId?: string
  createdAt: number
  updatedAt: number
  lastSeen: number
}

export type OutboxRelayStatus =
  | 'pending'
  | 'published'
  | 'failed'
  | 'exhausted'

export interface OutboxRelayState {
  status: OutboxRelayStatus
  attempts: number
  lastAttemptAt?: number
  nextAttemptAt?: number
  publishedAt?: number
  lastError?: string
  /**
   * Set while a flush owns this relay. Cleared on complete; stale claims
   * (see OUTBOX_CLAIM_TTL_MS) are reclaimable after a service-worker death.
   */
  claimedAt?: number
}

export interface OutboxRecord {
  eventId: string
  relays: Record<string, OutboxRelayState>
  createdAt: number
  updatedAt: number
}

export interface RawEventExport {
  format: 'attentionx-raw-events'
  version: 1
  exportedAt: number
  events: EventRecord[]
}

export interface RawEventImportResult {
  imported: number
  duplicates: number
  rejected: number
}

export interface EventIngestion {
  event: SignedNostrEvent
  firstSeenAt?: number
  relayUrl?: string
  observedAt?: number
  /** Local system state to persist on the event row (e.g. `'demo'`). */
  state?: EventState | string
}

export interface OutboxAttemptResult {
  ok: boolean
  exhausted?: boolean
  error?: string
  nextAttemptAt?: number
  publishedAt?: number
}

export interface StoreEventAndEnqueueOptions {
  now?: number
  /** Local system state to persist on the event row. */
  state?: EventState | string
}

export type RelayHealthStatus = 'up' | 'down' | 'unknown'

export type RelayFailureKind =
  | 'websocket'
  | 'query'
  | 'publish'
  | 'health'
  | 'handshake'

export interface RelayHealthRecord {
  relayUrl: string
  status: RelayHealthStatus
  lastError?: string
  lastCheckedAt: number
  lastSuccessAt?: number
  consecutiveFailures: number
  updatedAt: number
}

export interface RelayErrorLogRecord {
  id: string
  relayUrl: string
  at: number
  kind: RelayFailureKind
  message: string
}
