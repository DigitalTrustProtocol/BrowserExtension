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

export function proofTextMatches(
  postText: string,
  expectedProofText: string,
): boolean {
  return postText.includes(expectedProofText)
}
