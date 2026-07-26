export interface SignedNostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

export interface EventRecord extends SignedNostrEvent {
  firstSeenAt: number
}

export interface AddressRecord {
  address: string
  eventId: string
  updatedAt: number
}

export interface TagIndexRecord {
  key: [number, string, string, string]
  eventId: string
  kind: number
  tagName: string
  tagValue: string
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
 * X proof side and kind-10011 side are recorded independently; `state` is
 * derived when both sides align and cryptographic checks pass.
 */
export interface XIdentityRecord {
  twitterId: string
  handles: string[]
  /** X proof side — npub found in the account's own linking post. */
  xProofNpub?: string
  xProofPostId?: string
  xProofHandle?: string
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
  updatedAt: number
}

export type HandleAliasSource =
  | 'dom'
  | 'page-response'
  | 'profile-jsonld'
  | 'nip39'
  | 'import'

export interface HandleAliasRecord {
  handle: string
  twitterId: string
  source: HandleAliasSource
  observedAt: number
  expiresAt?: number
}

export type IdentityObservationKey = [
  string,
  number,
  string,
  number,
  string,
]

export interface IdentityObservationRecord {
  key: IdentityObservationKey
  handle: string
  twitterId: string
  observedAt: number
  receivedAt: number
  sourceOperation: string
  postIds?: string[]
}

export type IdentityObservationInput = Omit<
  IdentityObservationRecord,
  'key' | 'handle' | 'receivedAt'
> & {
  handle: string
  receivedAt?: number
}

export interface IdentityResolutionCandidateRecord {
  twitterId: string
  source: HandleAliasSource
  observedAt: number
  nostrPubkey?: string
}

interface IdentityResolutionCacheBase {
  handle: string
  resolvedAt: number
  expiresAt: number
}

export type IdentityResolutionCacheRecord =
  | (IdentityResolutionCacheBase & {
      state: 'resolved'
      twitterId: string
      source: HandleAliasSource
      nostrPubkeys?: string[]
    })
  | (IdentityResolutionCacheBase & {
      state: 'unresolved'
      retryAt: number
    })
  | (IdentityResolutionCacheBase & {
      state: 'pending'
      retryAt: number
      reasons: string[]
    })
  | (IdentityResolutionCacheBase & {
      state: 'conflict'
      candidates: IdentityResolutionCandidateRecord[]
    })

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
  address?: string
  indexTags?: boolean
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
  address?: string
  addressUpdatedAt?: number
  addressWinner?: {
    address: string
    updatedAt?: number
  }
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
