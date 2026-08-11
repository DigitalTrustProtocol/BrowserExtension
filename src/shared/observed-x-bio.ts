/**
 * Bio (primary X) npub discovery: extract npubs from a GraphQL user's
 * `legacy.description` (profile bio) on allowlisted timeline payloads.
 * Only the structured candidate below is forwarded — the raw bio text never
 * leaves page-world. Becomes `xIdentities.xNpub` / `xDate` evidence only
 * after service-worker acceptance (see `x-identity.mdc`).
 */

import {
  coerceXNumericId,
  isXNumericId,
  normalizeObservedHandle,
} from './observed-x-identity'
import { collectNpubsInText } from './proof-composer'
import { readTweetCreatedAtMs } from './x-proof-time'

export const OBSERVED_X_BIO_SOURCE = 'attentionx-page-world' as const
export const OBSERVED_X_BIO_MESSAGE = 'observed-x-bio-candidates' as const
export const OBSERVED_X_BIO_VERSION = 1 as const

export const MAX_X_BIO_CANDIDATES_PER_MESSAGE = 20
const MAX_BIO_TEXT_CHARS = 500

/**
 * `0` = no npub, `1` = exactly one, `2` = two or more (ambiguous).
 * Raw bio text is never forwarded.
 */
export type BioNpubCount = 0 | 1 | 2

export interface ObservedXBioCandidate {
  twitterId: string
  handle: string
  /**
   * Present only when `npubCount === 1`. Identity writes require this.
   * Setup re-checks use `npubCount` even when absent (missing / ambiguous).
   */
  npub?: string
  npubCount: BioNpubCount
  /** Tweet id that carried this author's bio when observed, if any. */
  postId?: string
  /** Carrier post `legacy.created_at` (ms) — becomes `xDate` on the identity row. */
  postCreatedAt?: number
  observedAt: number
}

/**
 * Prefer the candidate that should win for Bio identity writes.
 * Prefer a single-npub observation over empty/ambiguous; then newer
 * `postCreatedAt`; then `observedAt`.
 */
export function isPreferredBioCandidate(
  candidate: ObservedXBioCandidate,
  previous: ObservedXBioCandidate,
): boolean {
  if (candidate.npubCount === 1 && previous.npubCount !== 1) return true
  if (candidate.npubCount !== 1 && previous.npubCount === 1) return false

  const candidatePost =
    typeof candidate.postCreatedAt === 'number' &&
    Number.isFinite(candidate.postCreatedAt)
      ? candidate.postCreatedAt
      : undefined
  const previousPost =
    typeof previous.postCreatedAt === 'number' &&
    Number.isFinite(previous.postCreatedAt)
      ? previous.postCreatedAt
      : undefined
  if (candidatePost !== undefined && previousPost !== undefined) {
    if (candidatePost !== previousPost) return candidatePost > previousPost
  } else if (candidatePost !== undefined && previousPost === undefined) {
    return true
  } else if (candidatePost === undefined && previousPost !== undefined) {
    return false
  }
  return candidate.observedAt > previous.observedAt
}

export interface ObservedXBioMessage {
  source: typeof OBSERVED_X_BIO_SOURCE
  type: typeof OBSERVED_X_BIO_MESSAGE
  version: typeof OBSERVED_X_BIO_VERSION
  candidates: ObservedXBioCandidate[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const NPUB_PATTERN = /^npub1[023456789ac-hj-np-z]{10,100}$/

/** Classify bio text without forwarding the text itself. */
export function classifyBioNpubs(bioText: string): {
  npubCount: BioNpubCount
  npub?: string
} {
  const text = bioText.trim()
  if (!text || text.length > MAX_BIO_TEXT_CHARS) return { npubCount: 0 }
  const npubs = collectNpubsInText(text)
  if (npubs.length === 0) return { npubCount: 0 }
  if (npubs.length === 1) return { npubCount: 1, npub: npubs[0] }
  return { npubCount: 2 }
}

/**
 * Single-npub bio discovery. Unlike post-proof discovery this accepts a bare
 * npub with no linking-intent cue — a bio is inherently self-descriptive —
 * but still rejects multi-npub bios as ambiguous.
 */
export function extractBioNpubCandidate(bioText: string): string | undefined {
  const classified = classifyBioNpubs(bioText)
  return classified.npubCount === 1 ? classified.npub : undefined
}

export function createObservedXBioMessage(
  candidates: readonly ObservedXBioCandidate[],
): ObservedXBioMessage {
  return {
    source: OBSERVED_X_BIO_SOURCE,
    type: OBSERVED_X_BIO_MESSAGE,
    version: OBSERVED_X_BIO_VERSION,
    candidates: [...candidates],
  }
}

export function sanitizeObservedXBioCandidate(
  value: unknown,
): ObservedXBioCandidate | undefined {
  if (!isRecord(value)) return undefined
  const handle =
    typeof value.handle === 'string'
      ? normalizeObservedHandle(value.handle)
      : undefined
  const observedAt = value.observedAt
  const npubCountRaw = value.npubCount
  const npubCount: BioNpubCount | undefined =
    npubCountRaw === 0 || npubCountRaw === 1 || npubCountRaw === 2
      ? npubCountRaw
      : undefined
  if (
    !handle ||
    !isXNumericId(value.twitterId) ||
    npubCount === undefined ||
    typeof observedAt !== 'number' ||
    !Number.isSafeInteger(observedAt) ||
    observedAt <= 0
  ) {
    return undefined
  }

  let npub: string | undefined
  if (value.npub !== undefined) {
    if (typeof value.npub !== 'string') return undefined
    npub = value.npub.trim().toLowerCase()
    if (!NPUB_PATTERN.test(npub)) return undefined
  }
  if (npubCount === 1) {
    if (!npub) return undefined
  } else if (npub) {
    return undefined
  }

  let postId: string | undefined
  if (value.postId !== undefined) {
    if (!isXNumericId(value.postId)) return undefined
    postId = value.postId
  }

  const postCreatedAt =
    typeof value.postCreatedAt === 'number' &&
    Number.isSafeInteger(value.postCreatedAt) &&
    value.postCreatedAt > 0
      ? value.postCreatedAt
      : undefined

  return {
    twitterId: value.twitterId,
    handle,
    npubCount,
    ...(npub ? { npub } : {}),
    ...(postId ? { postId } : {}),
    ...(postCreatedAt !== undefined ? { postCreatedAt } : {}),
    observedAt,
  }
}

export function parseObservedXBioMessage(
  value: unknown,
): ObservedXBioMessage | undefined {
  if (!isRecord(value)) return undefined
  if (value.source !== OBSERVED_X_BIO_SOURCE) return undefined
  if (value.type !== OBSERVED_X_BIO_MESSAGE) return undefined
  if (value.version !== OBSERVED_X_BIO_VERSION) return undefined
  if (!Array.isArray(value.candidates) || value.candidates.length === 0) {
    return undefined
  }
  if (value.candidates.length > MAX_X_BIO_CANDIDATES_PER_MESSAGE) {
    return undefined
  }
  const candidates = value.candidates
    .map(sanitizeObservedXBioCandidate)
    .filter((c): c is ObservedXBioCandidate => Boolean(c))
  if (candidates.length === 0) return undefined
  return {
    source: OBSERVED_X_BIO_SOURCE,
    type: OBSERVED_X_BIO_MESSAGE,
    version: OBSERVED_X_BIO_VERSION,
    candidates,
  }
}

function readUserDescriptionText(
  user: Record<string, unknown>,
): string | undefined {
  const legacy = isRecord(user.legacy) ? user.legacy : undefined
  if (typeof legacy?.description === 'string') return legacy.description
  if (typeof user.description === 'string') return user.description
  const profileBio = isRecord(user.profile_bio) ? user.profile_bio : undefined
  if (typeof profileBio?.description === 'string') {
    return profileBio.description
  }
  // Explicit null/empty description on a User node → bio seen, no npub.
  if (legacy && 'description' in legacy) return ''
  if (user.__typename === 'User' && 'legacy' in user) return ''
  return undefined
}

function readTweetAuthorBio(tweet: Record<string, unknown>): {
  twitterId?: string
  handle?: string
  description?: string
} {
  const core = isRecord(tweet.core) ? tweet.core : undefined
  const userResults = isRecord(core?.user_results)
    ? core.user_results
    : isRecord(core?.user_result)
      ? core.user_result
      : undefined
  const user = isRecord(userResults?.result) ? userResults.result : undefined
  if (!user) return {}
  const legacy = isRecord(user.legacy) ? user.legacy : undefined
  const userCore = isRecord(user.core) ? user.core : undefined
  const handle =
    (typeof legacy?.screen_name === 'string' && legacy.screen_name) ||
    (typeof userCore?.screen_name === 'string' && userCore.screen_name) ||
    undefined
  const description = readUserDescriptionText(user)

  return {
    twitterId: coerceXNumericId(user.rest_id),
    ...(handle ? { handle } : {}),
    ...(description !== undefined ? { description } : {}),
  }
}

function buildBioCandidate(input: {
  twitterId: string
  handle: string
  description: string
  observedAt: number
  postId?: string
  postCreatedAt?: number
}): ObservedXBioCandidate | undefined {
  const classified = classifyBioNpubs(input.description)
  return {
    twitterId: input.twitterId,
    handle: input.handle,
    npubCount: classified.npubCount,
    ...(classified.npub ? { npub: classified.npub } : {}),
    ...(input.postId ? { postId: input.postId } : {}),
    ...(input.postCreatedAt !== undefined
      ? { postCreatedAt: input.postCreatedAt }
      : {}),
    observedAt: input.observedAt,
  }
}

/**
 * Build a bio candidate from a bare GraphQL User node (`legacy.description`).
 * Emits even when the bio has zero or multiple npubs (setup re-check).
 * Raw description text is discarded after classification.
 */
export function extractXBioCandidateFromUser(
  user: Record<string, unknown>,
  observedAt: number,
): ObservedXBioCandidate | undefined {
  const legacy = isRecord(user.legacy) ? user.legacy : undefined
  const userCore = isRecord(user.core) ? user.core : undefined
  const description = readUserDescriptionText(user)
  if (description === undefined) return undefined

  const twitterId = coerceXNumericId(user.rest_id)
  const handleRaw =
    (typeof legacy?.screen_name === 'string' && legacy.screen_name) ||
    (typeof userCore?.screen_name === 'string' && userCore.screen_name) ||
    undefined
  const handle = handleRaw ? normalizeObservedHandle(handleRaw) : undefined
  if (!twitterId || !handle) return undefined

  return buildBioCandidate({
    twitterId,
    handle,
    description,
    observedAt,
  })
}

/**
 * Build a bio candidate from an unwrapped GraphQL tweet when its author has
 * a `legacy.description`. Carrier post id / created_at attached when present.
 */
export function extractXBioCandidateFromTweet(
  tweet: Record<string, unknown>,
  observedAt: number,
): ObservedXBioCandidate | undefined {
  const author = readTweetAuthorBio(tweet)
  if (author.description === undefined) return undefined

  const twitterId = author.twitterId
  const handle = author.handle
    ? normalizeObservedHandle(author.handle)
    : undefined
  if (!twitterId || !handle) return undefined

  const postId =
    coerceXNumericId(tweet.rest_id) ??
    coerceXNumericId(isRecord(tweet.legacy) ? tweet.legacy.id_str : undefined)
  const postCreatedAt = readTweetCreatedAtMs(tweet)

  return buildBioCandidate({
    twitterId,
    handle,
    description: author.description,
    observedAt,
    ...(postId ? { postId } : {}),
    ...(postCreatedAt !== undefined ? { postCreatedAt } : {}),
  })
}
