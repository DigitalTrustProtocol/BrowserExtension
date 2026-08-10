/**
 * Bio (primary X) npub discovery: extract a single `npub1…` from a GraphQL
 * user's `legacy.description` (profile bio) on allowlisted timeline payloads.
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

export interface ObservedXBioCandidate {
  twitterId: string
  handle: string
  npub: string
  /** Tweet id that carried this author's bio when observed, if any. */
  postId?: string
  /** Carrier post `legacy.created_at` (ms) — becomes `xDate` on the identity row. */
  postCreatedAt?: number
  observedAt: number
}

/**
 * Prefer the candidate that should win for Bio identity writes.
 * `postCreatedAt` becomes `xDate` — never let an older carrier post replace a
 * newer one. Fall back to `observedAt` when post times are missing/tied.
 */
export function isPreferredBioCandidate(
  candidate: ObservedXBioCandidate,
  previous: ObservedXBioCandidate,
): boolean {
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

/**
 * Single-npub bio discovery. Unlike post-proof discovery this accepts a bare
 * npub with no linking-intent cue — a bio is inherently self-descriptive —
 * but still rejects multi-npub bios as ambiguous.
 */
export function extractBioNpubCandidate(bioText: string): string | undefined {
  const text = bioText.trim()
  if (!text || text.length > MAX_BIO_TEXT_CHARS) return undefined
  const npubs = collectNpubsInText(text)
  if (npubs.length !== 1) return undefined
  return npubs[0]
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
  const npub =
    typeof value.npub === 'string' ? value.npub.trim().toLowerCase() : undefined
  const observedAt = value.observedAt
  if (
    !handle ||
    !isXNumericId(value.twitterId) ||
    !npub ||
    !NPUB_PATTERN.test(npub) ||
    typeof observedAt !== 'number' ||
    !Number.isSafeInteger(observedAt) ||
    observedAt <= 0
  ) {
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
    npub,
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
  const description =
    typeof legacy?.description === 'string' ? legacy.description : undefined

  return {
    twitterId: coerceXNumericId(user.rest_id),
    ...(handle ? { handle } : {}),
    ...(description ? { description } : {}),
  }
}

/**
 * Build a bio candidate from an unwrapped GraphQL tweet when its author's
 * `legacy.description` contains exactly one npub. The carrier post id and
 * `created_at` are attached as evidence context; the description text
 * itself is discarded once the npub is extracted.
 */
export function extractXBioCandidateFromTweet(
  tweet: Record<string, unknown>,
  observedAt: number,
): ObservedXBioCandidate | undefined {
  const author = readTweetAuthorBio(tweet)
  if (!author.description) return undefined
  const npub = extractBioNpubCandidate(author.description)
  if (!npub) return undefined

  const twitterId = author.twitterId
  const handle = author.handle
    ? normalizeObservedHandle(author.handle)
    : undefined
  if (!twitterId || !handle) return undefined

  const postId =
    coerceXNumericId(tweet.rest_id) ??
    coerceXNumericId(isRecord(tweet.legacy) ? tweet.legacy.id_str : undefined)
  const postCreatedAt = readTweetCreatedAtMs(tweet)

  return {
    twitterId,
    handle,
    npub,
    ...(postId ? { postId } : {}),
    ...(postCreatedAt !== undefined ? { postCreatedAt } : {}),
    observedAt,
  }
}
