import {
  isXNumericId,
  normalizeObservedHandle,
} from '../shared/observed-x-identity'
import {
  buildLinkingProofText,
  extractLooseNip39ProofCandidate,
  LINKING_PROOF_PREFIX,
  postTextAcceptsNpub,
  proofTextMatches,
} from '../shared/proof-composer'
import { isCanonicalNip39TwitterProofHint } from '../shared/x-identity'
import type { XIdentityResolution } from './types'

export interface Nip39Event {
  id: string
  pubkey: string
  kind: number
  created_at: number
  tags: string[][]
  content: string
  sig: string
}

export interface XProofPost {
  postId: string
  text: string
  authorHandle: string
}

export type ProofPostQueryResult =
  | { status: 'found'; post: XProofPost }
  | { status: 'not-found' }
  | { status: 'unavailable' }

export type ProofVerificationResult =
  | {
      state: 'verified'
      handle: string
      twitterId: string
      proofPostId: string
      nostrPubkey: string
    }
  | { state: 'pending'; reason: string }
  | { state: 'invalid'; reason: string }
  | { state: 'conflict'; reason: string }

export interface ProofVerifierDependencies {
  verifyEvent(event: Nip39Event): boolean | Promise<boolean>
  toNpub(pubkey: string): string
  queryProofPost(postId: string): Promise<ProofPostQueryResult>
  resolveProfile(handle: string): Promise<XIdentityResolution>
}

export interface ParsedNip39TwitterClaim {
  handle: string
  twitterId: string
  proofPostId: string
}

export type AlreadyProvenDecision =
  | { decision: 'already_proven'; verification: ProofVerificationResult }
  | { decision: 'needs_proof'; verification?: ProofVerificationResult }
  | { decision: 'pending'; verification: ProofVerificationResult }
  | { decision: 'conflict'; verification: ProofVerificationResult }

export function generateNip39ProofText(npub: string): string {
  return buildLinkingProofText(npub)
}

export function parseNip39TwitterClaim(
  event: Nip39Event,
):
  | { state: 'valid'; claim: ParsedNip39TwitterClaim }
  | { state: 'invalid'; reason: string }
  | { state: 'conflict'; reason: string } {
  const handleTags = event.tags.filter(
    (tag) => tag[0] === 'i' && tag[1]?.startsWith('twitter:'),
  )
  const idTags = event.tags.filter(
    (tag) => tag[0] === 'i' && tag[1]?.startsWith('twitter_id:'),
  )
  if (handleTags.length === 0 || idTags.length === 0) {
    return { state: 'invalid', reason: 'missing-twitter-tags' }
  }

  const claims = new Map<string, ParsedNip39TwitterClaim>()
  for (const handleTag of handleTags) {
    const handle = normalizeObservedHandle(
      handleTag[1]?.slice('twitter:'.length) ?? '',
    )
    const proofPostId = handleTag[2]
    if (
      !handle ||
      !isXNumericId(proofPostId) ||
      (handleTag.length === 4 &&
        !isCanonicalNip39TwitterProofHint(handleTag[3], proofPostId)) ||
      (handleTag.length !== 3 && handleTag.length !== 4)
    ) {
      continue
    }

    for (const idTag of idTags) {
      const twitterId = idTag[1]?.slice('twitter_id:'.length)
      if (
        !isXNumericId(twitterId) ||
        idTag[2] !== proofPostId ||
        idTag.length !== handleTag.length ||
        (idTag.length === 4 &&
          !isCanonicalNip39TwitterProofHint(idTag[3], proofPostId)) ||
        (idTag.length !== 3 && idTag.length !== 4)
      ) {
        continue
      }
      const claim = { handle, twitterId, proofPostId }
      claims.set(`${handle}:${twitterId}:${proofPostId}`, claim)
    }
  }

  if (claims.size === 0) {
    return { state: 'invalid', reason: 'twitter-tag-proof-mismatch' }
  }
  if (claims.size > 1) {
    return { state: 'conflict', reason: 'multiple-twitter-claims' }
  }
  return { state: 'valid', claim: [...claims.values()][0]! }
}

export function verifyProofPostResponse(
  value: unknown,
  expected: {
    postId: string
    handle: string
    /** Exact substring (canonical Linking text or open prefix). */
    proofText?: string
    /** Prefer when verifying a known npub — accepts Linking or loose wording. */
    npub?: string
  },
): { valid: true; post: XProofPost } | { valid: false; reason: string } {
  if (!isRecord(value)) return { valid: false, reason: 'invalid-proof-response' }
  const postId = value.postId
  const text = value.text
  const authorHandle =
    typeof value.authorHandle === 'string'
      ? normalizeObservedHandle(value.authorHandle)
      : undefined
  if (
    !isXNumericId(postId) ||
    typeof text !== 'string' ||
    text.length > 2_000 ||
    !authorHandle
  ) {
    return { valid: false, reason: 'invalid-proof-response' }
  }
  if (postId !== expected.postId) {
    return { valid: false, reason: 'proof-post-id-mismatch' }
  }
  if (authorHandle !== normalizeObservedHandle(expected.handle)) {
    return { valid: false, reason: 'proof-author-mismatch' }
  }
  const npub = expected.npub?.trim().toLowerCase()
  if (npub) {
    if (!postTextAcceptsNpub(text, npub)) {
      return { valid: false, reason: 'proof-text-mismatch' }
    }
    return { valid: true, post: { postId, text, authorHandle } }
  }
  const proofText = expected.proofText?.trim() ?? ''
  if (!proofText) {
    return { valid: false, reason: 'proof-text-mismatch' }
  }
  if (proofTextMatches(text, proofText)) {
    return { valid: true, post: { postId, text, authorHandle } }
  }
  // Open-ended Linking prefix search: accept loose NIP-39-ish bodies too.
  if (
    proofText === LINKING_PROOF_PREFIX &&
    extractLooseNip39ProofCandidate(text)
  ) {
    return { valid: true, post: { postId, text, authorHandle } }
  }
  return { valid: false, reason: 'proof-text-mismatch' }
}

export async function verifyNip39Proof(
  event: Nip39Event,
  dependencies: ProofVerifierDependencies,
): Promise<ProofVerificationResult> {
  if (
    event.kind !== 10011 ||
    !/^[0-9a-f]{64}$/i.test(event.pubkey) ||
    !(await dependencies.verifyEvent(event))
  ) {
    return { state: 'invalid', reason: 'invalid-nip39-event' }
  }

  const parsed = parseNip39TwitterClaim(event)
  if (parsed.state !== 'valid') return parsed

  let npub: string
  try {
    npub = dependencies.toNpub(event.pubkey).trim().toLowerCase()
    // Ensure the pubkey encodes; keep generate for side-effect validation.
    generateNip39ProofText(npub)
  } catch {
    return { state: 'invalid', reason: 'invalid-event-pubkey' }
  }

  let response: ProofPostQueryResult
  try {
    response = await dependencies.queryProofPost(parsed.claim.proofPostId)
  } catch {
    return { state: 'pending', reason: 'proof-post-unavailable' }
  }
  if (response.status === 'unavailable') {
    return { state: 'pending', reason: 'proof-post-unavailable' }
  }
  if (response.status === 'not-found') {
    return { state: 'invalid', reason: 'proof-post-not-found' }
  }

  const proof = verifyProofPostResponse(response.post, {
    postId: parsed.claim.proofPostId,
    handle: parsed.claim.handle,
    npub,
  })
  if (!proof.valid) return { state: 'invalid', reason: proof.reason }

  let profile: XIdentityResolution
  try {
    profile = await dependencies.resolveProfile(parsed.claim.handle)
  } catch {
    return { state: 'pending', reason: 'profile-resolution-unavailable' }
  }
  if (profile.state === 'pending' || profile.state === 'unresolved') {
    return { state: 'pending', reason: 'profile-resolution-pending' }
  }
  if (profile.state === 'conflict') {
    return { state: 'conflict', reason: 'profile-identity-conflict' }
  }
  if (profile.twitterId !== parsed.claim.twitterId) {
    return { state: 'invalid', reason: 'profile-id-mismatch' }
  }

  return {
    state: 'verified',
    handle: parsed.claim.handle,
    twitterId: parsed.claim.twitterId,
    proofPostId: parsed.claim.proofPostId,
    nostrPubkey: event.pubkey.toLowerCase(),
  }
}

export async function decideAlreadyProven(
  options: {
    expectedPubkey: string
    expectedTwitterId: string
    currentEvent?: Nip39Event
  },
  dependencies: ProofVerifierDependencies,
): Promise<AlreadyProvenDecision> {
  if (
    !options.currentEvent ||
    options.currentEvent.pubkey.toLowerCase() !==
      options.expectedPubkey.toLowerCase()
  ) {
    return { decision: 'needs_proof' }
  }

  const verification = await verifyNip39Proof(
    options.currentEvent,
    dependencies,
  )
  if (
    verification.state === 'verified' &&
    verification.twitterId === options.expectedTwitterId
  ) {
    return { decision: 'already_proven', verification }
  }
  if (verification.state === 'pending') {
    return { decision: 'pending', verification }
  }
  if (verification.state === 'conflict') {
    return { decision: 'conflict', verification }
  }
  return { decision: 'needs_proof', verification }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
