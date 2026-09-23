import type { XVerifiedType } from '../shared/x-verified'

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
  /** Graph / 32009/14 columns. Omitted on kind 10011 and other rows. */
  subject?: string
  subjectType?: 'p' | 'e' | 'i'
  c_tag?: string
  nValue?: number
  addressableId?: string
  activate?: number
  expire?: number
  labels?: string[]
  labelHints?: Record<string, string>
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

/**
 * Which source currently supplies the winning npub for a verified (or
 * candidate) binding. Replaces the old blockedBy enum for overwrite rules.
 */
export type XIdentityProofSource =
  | 'bio'
  | 'post'
  | 'nip39'
  | 'trust32009'

/**
 * Local verification table: one row per X user.
 * Multi-source npub evidence (Bio, post proof, kind 10011, WoT-gated 32009)
 * with per-source dates. Lookups are always by `twitterId`.
 */
export interface XIdentityRecord {
  twitterId: string
  /** Latest observed handle (normalized). Empty when unknown / cleared. */
  handle: string
  /** Public display name observed from X profile metadata. */
  displayName?: string
  /** Canonical HTTPS pbs.twimg.com avatar URL, or a legacy path stem. */
  iconPath?: string
  /** pbs.twimg.com profile_banners path stem (no size suffix). */
  bannerPath?: string
  /**
   * X platform verification badge (blue / business / government).
   * Not NIP-39 `state` / `verifiedAt`.
   */
  verifiedType?: XVerifiedType
  /** One highlighted org-logo URL (same allowlist as `iconPath`). */
  affiliationBadgePath?: string
  /** Short org name for alt text. */
  affiliationLabel?: string
  /** Bio (primary X) — npub found in profile description on a timeline post. */
  xNpub?: string
  /** Timeline post `created_at` (ms) that carried the bio observation. */
  xDate?: number
  xObservedAt?: number
  /** Post-proof (secondary X) — npub found in a linking post body. */
  postNpub?: string
  postId?: string
  postHandle?: string
  /** Proof-post creation time (ms). */
  postDate?: number
  postObservedAt?: number
  /** Kind 10011 side — self-asserted Nostr claim. */
  nip39Npub?: string
  nip39XId?: string
  nip39Handle?: string
  nip39PostId?: string
  /** Signed kind 10011 `created_at` (ms). */
  nip39Date?: number
  /** Selected WoT-gated 32009 attestation projection. */
  eventNpub?: string
  /** Selected 32009 `created_at` (ms). */
  eventDate?: number
  eventId?: string
  eventIssuer?: string
  state: IdentityProofState
  /** Winning source for the current binding npub. */
  proofSource?: XIdentityProofSource
  verifiedAt?: number
  createdAt: number
  /** Last time row *data* changed (handle, profile, proof, status, …). */
  updatedAt: number
  /** Last time this X user was observed/ingested (touch). */
  lastSeen: number
  /** Distinct UTC days this X user was observed (see `nextSeenDays`). */
  seenDays?: number
}

/** GraphQL-derived post role for X-content-first `xPosts` chrome. */
export type XPostRole = 'root' | 'reply' | 'quote' | 'repost'

/**
 * Local display chrome for an X post seen on X with trust evidence or a
 * revalidated NIP-39 proof reference. Not a full tweet archive — capped
 * headline + optional role/parent only.
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
  /** Distinct UTC days this post was observed (see `nextSeenDays`). */
  seenDays?: number
  /**
   * Set when storage pruning removed this post's events. The row stays as a
   * skeleton; ingest drops events for it until the post is seen on X again.
   */
  prunedAt?: number
}

/** Keys of idle `xPosts` / `xIdentities` rows (`lastSeen` below a cutoff). */
export interface IdleSubjectScan {
  ids: string[]
  /** Rows with `seenDays` <= 1; rows written before `seenDays` count as 1. */
  seenOnce: number
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
