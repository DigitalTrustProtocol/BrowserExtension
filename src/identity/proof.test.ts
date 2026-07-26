import { describe, expect, it, vi } from 'vitest'
import {
  decideAlreadyProven,
  generateNip39ProofText,
  verifyNip39Proof,
  verifyProofPostResponse,
  type Nip39Event,
  type ProofVerifierDependencies,
} from './proof'

const PUBKEY = 'a'.repeat(64)
const NPUB = `npub1${'q'.repeat(58)}`
const PROOF_POST_ID = '2080659774136291424'

const event: Nip39Event = {
  id: 'b'.repeat(64),
  pubkey: PUBKEY,
  kind: 10011,
  created_at: 1_700_000_000,
  tags: [
    ['i', 'twitter:nasa', PROOF_POST_ID],
    ['i', 'twitter_id:11348282', PROOF_POST_ID],
  ],
  content: '',
  sig: 'c'.repeat(128),
}

function dependencies(): ProofVerifierDependencies {
  return {
    verifyEvent: vi.fn(async () => true),
    toNpub: () => NPUB,
    queryProofPost: vi.fn(async () => ({
      status: 'found' as const,
      post: {
        postId: PROOF_POST_ID,
        authorHandle: 'NASA',
        text: `${generateNip39ProofText(NPUB)} #nostr`,
      },
    })),
    resolveProfile: vi.fn(async () => ({
      state: 'resolved' as const,
      handle: 'nasa',
      twitterId: '11348282',
      provenance: 'profile-jsonld' as const,
      resolvedAt: 1,
      expiresAt: 2,
    })),
  }
}

describe('NIP-39 proof helpers', () => {
  it('generates the required proof text', () => {
    expect(generateNip39ProofText(NPUB)).toBe(
      `Linking my account to Nostr: ${NPUB}`,
    )
  })

  it('validates normalized proof-post responses', () => {
    expect(
      verifyProofPostResponse(
        {
          postId: PROOF_POST_ID,
          authorHandle: 'NASA',
          text: `${generateNip39ProofText(NPUB)} extra`,
        },
        {
          postId: PROOF_POST_ID,
          handle: 'nasa',
          proofText: generateNip39ProofText(NPUB),
        },
      ),
    ).toMatchObject({ valid: true })
  })

  it('verifies signature, paired tags, proof post, and profile identity', async () => {
    await expect(verifyNip39Proof(event, dependencies())).resolves.toEqual({
      state: 'verified',
      handle: 'nasa',
      twitterId: '11348282',
      proofPostId: PROOF_POST_ID,
      nostrPubkey: PUBKEY,
    })
  })

  it('keeps unavailable proof responses pending', async () => {
    const deps = dependencies()
    deps.queryProofPost = vi.fn(async () => ({
      status: 'unavailable' as const,
    }))

    await expect(verifyNip39Proof(event, deps)).resolves.toEqual({
      state: 'pending',
      reason: 'proof-post-unavailable',
    })
  })

  it('returns already_proven only for the same verified key and account', async () => {
    await expect(
      decideAlreadyProven(
        {
          expectedPubkey: PUBKEY,
          expectedTwitterId: '11348282',
          currentEvent: event,
        },
        dependencies(),
      ),
    ).resolves.toMatchObject({ decision: 'already_proven' })

    await expect(
      decideAlreadyProven(
        {
          expectedPubkey: PUBKEY,
          expectedTwitterId: '999',
          currentEvent: event,
        },
        dependencies(),
      ),
    ).resolves.toMatchObject({ decision: 'needs_proof' })
  })
})
