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

export interface ProofComposerSession {
  handle: string
  twitterId: string
  npub: string
  proofText: string
  confirmedAt: number
  intentOpenedAt?: number
  capturedPostId?: string
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

/** Canonical X proof-post body for a specific Nostr npub. */
export function buildLinkingProofText(npub: string): string {
  const normalized = npub.trim().toLowerCase()
  if (!NPUB_PATTERN.test(normalized)) {
    throw new Error('Invalid Nostr npub')
  }
  return `Linking my account to Nostr: ${normalized}`
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
