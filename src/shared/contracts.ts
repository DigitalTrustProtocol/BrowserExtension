import type { GraphBounds, TrustSubject as GraphTrustSubject } from '../graph'
import type { ObservedXIdentity } from './observed-x-identity'
import type {
  ActiveXAccountReport,
  ProofComposerPreview,
  ProofComposerSession,
} from './proof-composer'

export const BACKGROUND_API_VERSION = 1 as const
export const NIP39_EVENT_KIND = 10011
export const STORAGE_KEY = 'attentionx-state-v1'

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
] as const

export interface PublicExtensionState {
  hasIdentity: boolean
  npub?: string
  pubkey?: string
  vaultLocked?: boolean
  relays: string[]
  cachedEventCount: number
  activeXAccount?: ActiveXAccountReport
  proofSession?: ProofComposerSession
  syncStatus?: {
    state: 'idle' | 'running' | 'complete' | 'error' | 'stopped'
    startedAt?: number
    finishedAt?: number
    error?: string
  }
}

export type {
  ActiveXAccountReport,
  ProofComposerPreview,
  ProofComposerSession,
}

export interface PublishResult {
  eventId: string
  deliveredTo: number
  attemptedRelays: number
  deliveryStatus?: 'complete' | 'partial' | 'pending' | 'failed'
}

export type SerializableTrustSubject = GraphTrustSubject

interface VersionedRequest {
  version: typeof BACKGROUND_API_VERSION
}

export type ExtensionRequest =
  | { type: 'GET_STATE' }
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
      type: 'RESOLVE_X_IDENTITY'
      handle: string
    })
  | (VersionedRequest & {
      type: 'GET_X_IDENTITY'
      handle?: string
      twitterId?: string
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
  | (VersionedRequest & { type: 'CANCEL_PROOF_COMPOSER' })
  | (VersionedRequest & {
      type: 'PUBLISH_TRUST_STATEMENT'
      subject: SerializableTrustSubject
      value: '1' | '-1'
      context?: string
      content?: string
      activationTime?: number
      expirationTime?: number
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
      bounds?: Partial<GraphBounds>
    })
  | (VersionedRequest & {
      type: 'START_WOT_SYNC'
      overlapSeconds?: number
      limits?: Partial<GraphBounds>
    })
  | (VersionedRequest & { type: 'GET_WOT_SYNC_STATUS' })
  | (VersionedRequest & { type: 'STOP_WOT_SYNC' })

export type ExtensionResponse<T> =
  | { ok: true; version: typeof BACKGROUND_API_VERSION; data: T }
  | {
      ok: false
      version: typeof BACKGROUND_API_VERSION
      error: string
    }
