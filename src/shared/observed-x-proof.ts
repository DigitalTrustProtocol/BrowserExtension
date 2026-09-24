/**
 * Normalized X↔Nostr proof candidates from allowlisted GraphQL tweet bodies.
 * Candidates become identity evidence from the payload already observed.
 * The service worker does not request the post from X.
 */

import {
  coerceXNumericId,
  isXNumericId,
  normalizeObservedHandle,
} from './observed-x-identity'
import { extractLooseNip39ProofCandidate } from './proof-composer'
import { readTweetCreatedAtMs } from './x-proof-time'

export const OBSERVED_X_PROOF_SOURCE = 'attentionx-page-world' as const
export const OBSERVED_X_PROOF_MESSAGE = 'observed-x-proof-candidates' as const
export const OBSERVED_X_PROOF_VERSION = 1 as const

export const MAX_X_PROOF_CANDIDATES_PER_MESSAGE = 20
export const MAX_X_PROOF_FULL_TEXT_CHARS = 2_000

export interface ObservedXProofCandidate {
  twitterId: string
  handle: string
  postId: string
  npub: string
  fullText: string
  /** Proof post creation ms from GraphQL `legacy.created_at`. */
  postedAt?: number
  observedAt: number
}

export interface ObservedXProofMessage {
  source: typeof OBSERVED_X_PROOF_SOURCE
  type: typeof OBSERVED_X_PROOF_MESSAGE
  version: typeof OBSERVED_X_PROOF_VERSION
  candidates: ObservedXProofCandidate[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function createObservedXProofMessage(
  candidates: readonly ObservedXProofCandidate[],
): ObservedXProofMessage {
  return {
    source: OBSERVED_X_PROOF_SOURCE,
    type: OBSERVED_X_PROOF_MESSAGE,
    version: OBSERVED_X_PROOF_VERSION,
    candidates: [...candidates],
  }
}

export function sanitizeObservedXProofCandidate(
  value: unknown,
): ObservedXProofCandidate | undefined {
  if (!isRecord(value)) return undefined
  const handle =
    typeof value.handle === 'string'
      ? normalizeObservedHandle(value.handle)
      : undefined
  const npub =
    typeof value.npub === 'string' ? value.npub.trim().toLowerCase() : undefined
  const fullText =
    typeof value.fullText === 'string' ? value.fullText.trim() : undefined
  const observedAt = value.observedAt
  if (
    !handle ||
    !isXNumericId(value.twitterId) ||
    !isXNumericId(value.postId) ||
    !npub ||
    !/^npub1[023456789ac-hj-np-z]{10,100}$/.test(npub) ||
    !fullText ||
    fullText.length > MAX_X_PROOF_FULL_TEXT_CHARS ||
    typeof observedAt !== 'number' ||
    !Number.isSafeInteger(observedAt) ||
    observedAt <= 0
  ) {
    return undefined
  }

  const loose = extractLooseNip39ProofCandidate(fullText)
  if (!loose || loose.npub !== npub) return undefined

  const postedAt =
    typeof value.postedAt === 'number' &&
    Number.isSafeInteger(value.postedAt) &&
    value.postedAt > 0
      ? value.postedAt
      : undefined

  return {
    twitterId: value.twitterId,
    handle,
    postId: value.postId,
    npub,
    fullText,
    ...(postedAt !== undefined ? { postedAt } : {}),
    observedAt,
  }
}

export function parseObservedXProofMessage(
  value: unknown,
): ObservedXProofMessage | undefined {
  if (!isRecord(value)) return undefined
  if (value.source !== OBSERVED_X_PROOF_SOURCE) return undefined
  if (value.type !== OBSERVED_X_PROOF_MESSAGE) return undefined
  if (value.version !== OBSERVED_X_PROOF_VERSION) return undefined
  if (!Array.isArray(value.candidates) || value.candidates.length === 0) {
    return undefined
  }
  if (value.candidates.length > MAX_X_PROOF_CANDIDATES_PER_MESSAGE) {
    return undefined
  }
  const candidates = value.candidates
    .map(sanitizeObservedXProofCandidate)
    .filter((c): c is ObservedXProofCandidate => Boolean(c))
  if (candidates.length === 0) return undefined
  return {
    source: OBSERVED_X_PROOF_SOURCE,
    type: OBSERVED_X_PROOF_MESSAGE,
    version: OBSERVED_X_PROOF_VERSION,
    candidates,
  }
}

/**
 * Build a candidate from an unwrapped GraphQL tweet when the body looks like
 * a NIP-39-ish X↔npub link post.
 */
export function extractXProofCandidateFromTweet(
  tweet: Record<string, unknown>,
  observedAt: number,
  readTweetText: (tweet: Record<string, unknown>) => string | undefined,
  readAuthor: (tweet: Record<string, unknown>) => {
    twitterId?: string
    handle?: string
  },
): ObservedXProofCandidate | undefined {
  const postId =
    coerceXNumericId(tweet.rest_id) ??
    coerceXNumericId(isRecord(tweet.legacy) ? tweet.legacy.id_str : undefined)
  if (!postId) return undefined

  const text = readTweetText(tweet)
  if (!text) return undefined
  const loose = extractLooseNip39ProofCandidate(text)
  if (!loose) return undefined

  const author = readAuthor(tweet)
  const twitterId = author.twitterId
  const handle = author.handle
    ? normalizeObservedHandle(author.handle)
    : undefined
  if (!twitterId || !handle) return undefined

  const postedAt = readTweetCreatedAtMs(tweet)
  return {
    twitterId,
    handle,
    postId,
    npub: loose.npub,
    fullText: text.slice(0, MAX_X_PROOF_FULL_TEXT_CHARS),
    ...(postedAt !== undefined ? { postedAt } : {}),
    observedAt,
  }
}
