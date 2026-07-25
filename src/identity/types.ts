import type { ObservedXIdentity } from '../shared/observed-x-identity'

export type IdentityProvenance =
  | 'observation'
  | 'profile-jsonld'
  | 'verified-nip39'

export interface ResolvedXIdentity {
  state: 'resolved'
  handle: string
  twitterId: string
  provenance: IdentityProvenance
  resolvedAt: number
  expiresAt: number
  cached?: boolean
  nostrPubkeys?: string[]
}

export interface UnresolvedXIdentity {
  state: 'unresolved'
  handle: string
  resolvedAt: number
  expiresAt: number
  retryAt: number
  cached?: boolean
}

export interface PendingXIdentity {
  state: 'pending'
  handle: string
  resolvedAt: number
  expiresAt: number
  retryAt: number
  reasons: string[]
  cached?: boolean
}

export interface IdentityConflictCandidate {
  twitterId: string
  provenance: IdentityProvenance
  observedAt: number
  nostrPubkey?: string
}

export interface ConflictingXIdentity {
  state: 'conflict'
  handle: string
  resolvedAt: number
  expiresAt: number
  candidates: IdentityConflictCandidate[]
  cached?: boolean
}

export type XIdentityResolution =
  | ResolvedXIdentity
  | UnresolvedXIdentity
  | PendingXIdentity
  | ConflictingXIdentity

export interface VerifiedNip39Identity {
  status: 'verified'
  handle: string
  twitterId: string
  nostrPubkey: string
  proofPostId: string
  verifiedAt: number
}

export interface IdentityRepository {
  getResolution(handle: string): Promise<XIdentityResolution | undefined>
  saveResolution(resolution: XIdentityResolution): Promise<void>
  getObservations(handle: string, since: number): Promise<ObservedXIdentity[]>
  saveObservations(observations: readonly ObservedXIdentity[]): Promise<void>
}

export type ProfileFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>

export type Nip39IdentityQuery = (
  handle: string,
  signal?: AbortSignal,
) => Promise<readonly VerifiedNip39Identity[]>
