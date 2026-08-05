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

/** Shared prefix used for exact-npub proofs and open-ended X searches. */
export const LINKING_PROOF_PREFIX = 'Linking my account to Nostr:'

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
  try {
    return proofTextMatches(postText, buildLinkingProofText(npub))
  } catch {
    return false
  }
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
