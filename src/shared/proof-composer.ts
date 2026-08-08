import {
  isXNumericId,
  normalizeObservedHandle,
} from './observed-x-identity'

export interface ProofDestinationAccount {
  handle: string
  twitterId: string
}

export interface ActiveXAccountReport {
  handle: string
  twitterId?: string
  detectedAt: number
  /** Public display name from SideNav / profile chrome. */
  displayName?: string
  /** pbs.twimg.com profile_images path stem (no size suffix). */
  iconPath?: string
}

export interface ProofComposerPreview {
  npub: string
  proofText: string
  handle: string
  twitterId: string
  alreadyProven: boolean
  existingProofPostId?: string
}

export type XProofCheckSource =
  | 'local-identity'
  | 'local-event'
  | 'relay'
  | 'page-scan'
  | 'explicit-search'

export type XProofCheckResult =
  | {
      status: 'verified'
      handle: string
      twitterId: string
      proofPostId: string
      npub: string
      source: XProofCheckSource
    }
  | {
      /** Proof post found on X; kind 10011 stored locally — user must confirm relay publish. */
      status: 'needs_publish'
      handle: string
      twitterId: string
      proofPostId: string
      npub: string
      proofText: string
      source: 'page-scan' | 'local-identity' | 'explicit-search'
    }
  | {
      status: 'pending'
      handle: string
      twitterId: string
      npub: string
      proofText: string
      reason: string
    }
  | {
      status: 'not_found'
      handle: string
      twitterId: string
      npub: string
      proofText: string
    }
  | {
      status: 'missing_account'
      reason: string
    }
  | {
      status: 'missing_x_account'
      reason: string
      handle?: string
    }

export interface ProofComposerSession {
  handle: string
  twitterId: string
  npub: string
  proofText: string
  confirmedAt: number
  intentOpenedAt?: number
  capturedPostId?: string
}

/** How publishing kind 10011 will change the existing replaceable event. */
export type XIdentityPublishChange = 'add' | 'refresh' | 'replace'

export interface XIdentityPublishTwitterClaim {
  handle: string
  twitterId: string
  proofPostId: string
}

/** Unsigned kind 10011 template shown before the user confirms publish. */
export interface XIdentityPublishEventPreview {
  kind: 10011
  created_at: number
  content: string
  tags: string[][]
}

export interface XIdentityPublishPreview {
  handle: string
  twitterId: string
  proofPostId: string
  npub: string
  /** Latest own kind 10011 id when one exists; null when creating the first. */
  existingEventId: string | null
  change: XIdentityPublishChange
  /** Parsed Twitter claim from the existing event, when available. */
  existingTwitter?: XIdentityPublishTwitterClaim
  /** Raw twitter:/twitter_id: tag values when the existing pair is malformed. */
  existingTwitterTags?: string[]
  preservedTagCount: number
  preservesContent: boolean
  eventPreview: XIdentityPublishEventPreview
}

export type XIdentityPublishResult =
  | {
      status: 'published'
      eventId: string
      deliveredTo: number
      attemptedRelays: number
      deliveryStatus?: 'complete' | 'partial' | 'pending' | 'failed'
      heldUntil?: number
      identityState: 'verified' | 'pending' | 'unverified'
      blockedBy?:
        | 'missing-nip39'
        | 'missing-x-proof'
        | 'proof-unavailable'
        | 'mismatch'
      handle: string
      twitterId: string
      proofPostId: string
      npub: string
    }
  | {
      status: 'stale-preview'
      reason: string
      preview: XIdentityPublishPreview
    }
  | {
      status: 'replacement-required'
      reason: string
      preview: XIdentityPublishPreview
    }

export function normalizeProofDestination(
  handle: string,
  twitterId: string,
): ProofDestinationAccount {
  const normalized = normalizeObservedHandle(handle)
  if (!normalized) throw new Error('Invalid X handle')
  if (!isXNumericId(twitterId)) throw new Error('Invalid X account ID')
  return { handle: normalized, twitterId }
}

export function accountsMatch(
  active: { handle?: string; twitterId?: string } | undefined,
  destination: ProofDestinationAccount,
): active is ProofDestinationAccount {
  if (!active?.handle || !active.twitterId) return false
  const handle = normalizeObservedHandle(active.handle)
  return (
    handle === destination.handle && active.twitterId === destination.twitterId
  )
}

export function buildProofIntentUrl(proofText: string): string {
  const url = new URL('https://x.com/intent/post')
  url.searchParams.set('text', proofText)
  return url.toString()
}

export function parseProofPostId(value: string): string | undefined {
  const trimmed = value.trim()
  if (isXNumericId(trimmed)) return trimmed

  try {
    const url = new URL(trimmed)
    if (
      url.hostname !== 'x.com' &&
      url.hostname !== 'twitter.com' &&
      url.hostname !== 'www.x.com' &&
      url.hostname !== 'www.twitter.com'
    ) {
      return undefined
    }
    const match = url.pathname.match(/\/status\/(\d{1,24})(?:\/|$)/)
    return match && isXNumericId(match[1]) ? match[1] : undefined
  } catch {
    return undefined
  }
}

const NPUB_PATTERN = /^npub1[023456789ac-hj-np-z]{10,100}$/
const NPUB_IN_TEXT_PATTERN = /npub1[023456789ac-hj-np-z]{10,100}/gi

/** Shared prefix used for exact-npub proofs and open-ended X searches. */
export const LINKING_PROOF_PREFIX = 'Linking my account to Nostr:'

/** Common ecosystem wording (NIP-39 examples / other clients). */
export const VERIFYING_PROOF_PREFIX = 'Verifying my account on nostr'

/** Canonical X proof-post body for a specific Nostr npub. */
export function buildLinkingProofText(npub: string): string {
  const normalized = npub.trim().toLowerCase()
  if (!NPUB_PATTERN.test(normalized)) {
    throw new Error('Invalid Nostr npub')
  }
  return `${LINKING_PROOF_PREFIX} ${normalized}`
}

/**
 * True when `postText` contains the proof template for this exact npub.
 * Other keys' proof posts (same X account, different npub) must not match
 * because `expectedProofText` embeds that specific npub.
 */
export function proofTextMatches(
  postText: string,
  expectedProofText: string,
): boolean {
  return expectedProofText.length > 0 && postText.includes(expectedProofText)
}

/** Search helper: match a post body to the active account's npub proof. */
export function postContainsProofForNpub(
  postText: string,
  npub: string,
): boolean {
  return postTextAcceptsNpub(postText, npub)
}

/**
 * Accept a proof post body for a specific npub: exact Linking template or a
 * loose NIP-39-ish claim that embeds that single npub.
 */
export function postTextAcceptsNpub(postText: string, npub: string): boolean {
  const normalized = npub.trim().toLowerCase()
  if (!NPUB_PATTERN.test(normalized)) return false
  try {
    if (proofTextMatches(postText, buildLinkingProofText(normalized))) {
      return true
    }
  } catch {
    // fall through to loose
  }
  const loose = extractLooseNip39ProofCandidate(postText)
  return loose?.npub === normalized
}

/** Pull the npub from a linking proof post body, if present. */
export function extractNpubFromLinkingProofText(
  postText: string,
): string | undefined {
  const match = /Linking my account to Nostr:\s*(npub1[023456789ac-hj-np-z]{10,100})/i.exec(
    postText,
  )
  if (!match?.[1]) return undefined
  const npub = match[1].toLowerCase()
  return NPUB_PATTERN.test(npub) ? npub : undefined
}

/**
 * Collect distinct npub1… tokens from post text (lowercased).
 * Caps at a few matches so multi-npub spam is cheap to detect.
 */
export function collectNpubsInText(postText: string): string[] {
  const found = new Set<string>()
  NPUB_IN_TEXT_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = NPUB_IN_TEXT_PATTERN.exec(postText)) !== null) {
    const npub = match[0].toLowerCase()
    if (NPUB_PATTERN.test(npub)) found.add(npub)
    if (found.size > 4) break
  }
  return [...found]
}

function hasProofIntentCue(postText: string): boolean {
  const lower = postText.toLowerCase()
  if (lower.includes(LINKING_PROOF_PREFIX.toLowerCase())) return true
  if (lower.includes(VERIFYING_PROOF_PREFIX.toLowerCase())) return true
  if (!lower.includes('nostr')) return false
  return (
    /\blink(?:ing|ed)?\b/.test(lower) ||
    /\bverif(?:y|ying|ied|ication)\b/.test(lower) ||
    lower.includes('public key') ||
    lower.includes('my account')
  )
}

/**
 * Loose discovery: a single valid npub plus an intent cue that the post is
 * linking/verifying an X account to Nostr. Rejects bare npub spam and
 * multi-npub posts.
 */
export function extractLooseNip39ProofCandidate(
  postText: string,
): { npub: string } | undefined {
  const text = postText.trim()
  if (!text || text.length > 2_000) return undefined
  if (!hasProofIntentCue(text)) return undefined
  const npubs = collectNpubsInText(text)
  if (npubs.length !== 1) return undefined
  return { npub: npubs[0]! }
}

/** Prefer exact Linking extract; fall back to loose single-npub candidate. */
export function extractNpubFromProofPostText(
  postText: string,
): string | undefined {
  return (
    extractNpubFromLinkingProofText(postText) ??
    extractLooseNip39ProofCandidate(postText)?.npub
  )
}
