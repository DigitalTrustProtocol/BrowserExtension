import {
  isXNumericId,
  normalizeObservedHandle,
  sanitizeObservedXIdentity,
  type ObservedXIdentity,
} from '../shared/observed-x-identity'
import { extractTwitterIdsFromProfileJsonLd } from './profile-jsonld'
import type {
  IdentityConflictCandidate,
  IdentityRepository,
  Nip39IdentityQuery,
  ProfileFetch,
  VerifiedNip39Identity,
  XIdentityResolution,
} from './types'

export interface IdentityResolverTtls {
  aliasMs: number
  observationMaxAgeMs: number
  unresolvedMs: number
  pendingMs: number
  conflictMs: number
}

export interface IdentityResolverDependencies {
  repository: IdentityRepository
  fetch: ProfileFetch
  queryNip39: Nip39IdentityQuery
  now?: () => number
  ttls?: Partial<IdentityResolverTtls>
}

const DEFAULT_TTLS: IdentityResolverTtls = {
  aliasMs: 6 * 60 * 60 * 1_000,
  observationMaxAgeMs: 24 * 60 * 60 * 1_000,
  unresolvedMs: 5 * 60 * 1_000,
  pendingMs: 60 * 1_000,
  conflictMs: 15 * 60 * 1_000,
}

const MAX_PROFILE_BYTES = 1_500_000

export class XIdentityResolver {
  readonly #repository: IdentityRepository
  readonly #fetch: ProfileFetch
  readonly #queryNip39: Nip39IdentityQuery
  readonly #now: () => number
  readonly #ttls: IdentityResolverTtls

  constructor(dependencies: IdentityResolverDependencies) {
    this.#repository = dependencies.repository
    this.#fetch = dependencies.fetch
    this.#queryNip39 = dependencies.queryNip39
    this.#now = dependencies.now ?? Date.now
    this.#ttls = { ...DEFAULT_TTLS, ...dependencies.ttls }
  }

  async ingestObservations(
    observations: readonly ObservedXIdentity[],
  ): Promise<void> {
    const sanitized = observations
      .map(sanitizeObservedXIdentity)
      .filter((value): value is ObservedXIdentity => Boolean(value))
    await this.#repository.saveObservations(sanitized)
  }

  async resolve(
    requestedHandle: string,
    signal?: AbortSignal,
  ): Promise<XIdentityResolution> {
    const handle = normalizeObservedHandle(requestedHandle)
    if (!handle) throw new Error('Invalid X handle')
    const now = this.#now()

    const cached = await this.#repository.getResolution(handle)
    if (cached && cached.expiresAt > now) {
      return { ...cached, cached: true }
    }

    const observations = await this.#repository.getObservations(
      handle,
      now - this.#ttls.observationMaxAgeMs,
    )
    const observedCandidates = observations.map((observation) => ({
      twitterId: observation.twitterId,
      provenance: 'observation' as const,
      observedAt: observation.observedAt,
    }))
    const observed = await this.#resolveCandidates(
      handle,
      observedCandidates,
      now,
    )
    if (observed) return observed

    const pendingReasons: string[] = []
    const profileCandidates = await this.#queryPublicProfile(
      handle,
      pendingReasons,
      signal,
    )
    const fromProfile = await this.#resolveCandidates(
      handle,
      profileCandidates.map((twitterId) => ({
        twitterId,
        provenance: 'profile-jsonld' as const,
        observedAt: now,
      })),
      now,
    )
    if (fromProfile) return fromProfile

    let nip39Claims: readonly VerifiedNip39Identity[] = []
    try {
      nip39Claims = await this.#queryNip39(handle, signal)
    } catch {
      pendingReasons.push('nip39-unavailable')
    }
    const verifiedClaims = nip39Claims.filter(
      (claim) =>
        claim.status === 'verified' &&
        normalizeObservedHandle(claim.handle) === handle &&
        isXNumericId(claim.twitterId) &&
        /^[0-9a-f]{64}$/i.test(claim.nostrPubkey) &&
        isXNumericId(claim.proofPostId) &&
        Number.isSafeInteger(claim.verifiedAt) &&
        claim.verifiedAt > 0,
    )
    const fromNip39 = await this.#resolveNip39Candidates(
      handle,
      verifiedClaims,
      now,
    )
    if (fromNip39) return fromNip39

    const expiresAt =
      now +
      (pendingReasons.length > 0
        ? this.#ttls.pendingMs
        : this.#ttls.unresolvedMs)
    const resolution: XIdentityResolution =
      pendingReasons.length > 0
        ? {
            state: 'pending',
            handle,
            resolvedAt: now,
            expiresAt,
            retryAt: expiresAt,
            reasons: [...new Set(pendingReasons)],
          }
        : {
            state: 'unresolved',
            handle,
            resolvedAt: now,
            expiresAt,
            retryAt: expiresAt,
          }
    await this.#repository.saveResolution(resolution)
    return resolution
  }

  async #queryPublicProfile(
    handle: string,
    pendingReasons: string[],
    signal?: AbortSignal,
  ): Promise<string[]> {
    try {
      const response = await this.#fetch(`https://x.com/${handle}`, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'follow',
        signal,
        headers: { Accept: 'text/html,application/xhtml+xml' },
      })
      if (response.status === 404) return []
      if (!response.ok) {
        pendingReasons.push(`profile-http-${response.status}`)
        return []
      }
      const contentType = response.headers.get('content-type') ?? ''
      if (!/^(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType)) {
        pendingReasons.push('profile-invalid-content')
        return []
      }
      const declaredLength = Number(response.headers.get('content-length'))
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_PROFILE_BYTES
      ) {
        pendingReasons.push('profile-too-large')
        return []
      }
      const html = await response.text()
      if (new TextEncoder().encode(html).byteLength > MAX_PROFILE_BYTES) {
        pendingReasons.push('profile-too-large')
        return []
      }
      return extractTwitterIdsFromProfileJsonLd(html)
    } catch (error) {
      if (signal?.aborted) throw error
      pendingReasons.push('profile-unavailable')
      return []
    }
  }

  async #resolveCandidates(
    handle: string,
    candidates: IdentityConflictCandidate[],
    now: number,
  ): Promise<XIdentityResolution | undefined> {
    const distinct = uniqueCandidates(candidates)
    if (distinct.length === 0) return undefined
    if (new Set(distinct.map((candidate) => candidate.twitterId)).size > 1) {
      return this.#saveConflict(handle, distinct, now)
    }

    const newest = distinct.reduce((left, right) =>
      left.observedAt >= right.observedAt ? left : right,
    )
    const resolution: XIdentityResolution = {
      state: 'resolved',
      handle,
      twitterId: newest.twitterId,
      provenance: newest.provenance,
      resolvedAt: now,
      expiresAt: now + this.#ttls.aliasMs,
    }
    await this.#repository.saveResolution(resolution)
    return resolution
  }

  async #resolveNip39Candidates(
    handle: string,
    claims: readonly VerifiedNip39Identity[],
    now: number,
  ): Promise<XIdentityResolution | undefined> {
    const candidates = uniqueCandidates(
      claims.map((claim) => ({
        twitterId: claim.twitterId,
        provenance: 'verified-nip39' as const,
        observedAt: claim.verifiedAt,
        nostrPubkey: claim.nostrPubkey.toLowerCase(),
      })),
    )
    if (candidates.length === 0) return undefined
    if (new Set(candidates.map((candidate) => candidate.twitterId)).size > 1) {
      return this.#saveConflict(handle, candidates, now)
    }

    const resolution: XIdentityResolution = {
      state: 'resolved',
      handle,
      twitterId: candidates[0]!.twitterId,
      provenance: 'verified-nip39',
      resolvedAt: now,
      expiresAt: now + this.#ttls.aliasMs,
      nostrPubkeys: [
        ...new Set(
          candidates
            .map((candidate) => candidate.nostrPubkey)
            .filter((value): value is string => Boolean(value)),
        ),
      ],
    }
    await this.#repository.saveResolution(resolution)
    return resolution
  }

  async #saveConflict(
    handle: string,
    candidates: IdentityConflictCandidate[],
    now: number,
  ): Promise<XIdentityResolution> {
    const resolution: XIdentityResolution = {
      state: 'conflict',
      handle,
      resolvedAt: now,
      expiresAt: now + this.#ttls.conflictMs,
      candidates,
    }
    await this.#repository.saveResolution(resolution)
    return resolution
  }
}

function uniqueCandidates(
  candidates: readonly IdentityConflictCandidate[],
): IdentityConflictCandidate[] {
  const unique = new Map<string, IdentityConflictCandidate>()
  for (const candidate of candidates) {
    if (!isXNumericId(candidate.twitterId)) continue
    const key = `${candidate.twitterId}:${candidate.provenance}:${candidate.nostrPubkey ?? ''}`
    const previous = unique.get(key)
    if (!previous || candidate.observedAt > previous.observedAt) {
      unique.set(key, candidate)
    }
  }
  return [...unique.values()]
}

export type { IdentityProvenance, XIdentityResolution } from './types'
