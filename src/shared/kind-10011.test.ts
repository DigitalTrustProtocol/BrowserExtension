import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  type Event,
} from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import {
  buildKind10011Event,
  buildNip39ProofText,
  containsNip39Proof,
  mergeKind10011TwitterTags,
  parseKind10011TwitterIdentity,
  validateSignedKind10011Event,
  validateKind10011TwitterIdentity,
} from './kind-10011'

const secretKey = generateSecretKey()
const link = {
  handle: 'NASA',
  twitterId: '11348282',
  proofPostId: '2080659774136291424',
}

function signedIdentity(): Event {
  return finalizeEvent(
    buildKind10011Event({ ...link, createdAt: 1_700_000_000 }),
    secretKey,
  )
}

describe('kind 10011 Twitter identity protocol', () => {
  it('builds and validates the paired twitter identity tags', () => {
    const event = signedIdentity()
    expect(event.tags).toEqual([
      ['i', 'twitter:nasa', '2080659774136291424'],
      ['i', 'twitter_id:11348282', '2080659774136291424'],
    ])
    expect(parseKind10011TwitterIdentity(event)).toMatchObject({
      handle: 'nasa',
      twitterId: '11348282',
      proofPostId: '2080659774136291424',
    })
  })

  it('preserves unrelated providers and replaces both Twitter tags together', () => {
    const existing = [
      ['i', 'github:octocat', 'proof-a'],
      ['client', 'attentionx'],
      ['i', 'twitter:old_handle', 'old-proof'],
      ['i', 'twitter_id:999', 'old-proof'],
      ['i', 'mastodon:alex@example.com', 'proof-b'],
    ]

    expect(mergeKind10011TwitterTags(existing, link)).toEqual([
      ['i', 'github:octocat', 'proof-a'],
      ['client', 'attentionx'],
      ['i', 'mastodon:alex@example.com', 'proof-b'],
      ['i', 'twitter:nasa', '2080659774136291424'],
      ['i', 'twitter_id:11348282', '2080659774136291424'],
    ])
    expect(existing[2]).toEqual(['i', 'twitter:old_handle', 'old-proof'])
  })

  it('builds a complete replacement template and preserves prior content', () => {
    expect(
      buildKind10011Event({
        ...link,
        createdAt: 20,
        existingEvent: {
          content: 'provider links',
          tags: [['i', 'github:octocat', 'proof']],
        },
      }),
    ).toEqual({
      kind: 10011,
      created_at: 20,
      content: 'provider links',
      tags: [
        ['i', 'github:octocat', 'proof'],
        ['i', 'twitter:nasa', '2080659774136291424'],
        ['i', 'twitter_id:11348282', '2080659774136291424'],
      ],
    })
  })

  it('rejects absent, duplicate, malformed, or mismatched provider pairs', () => {
    const event = signedIdentity()
    const fixtures: Event[] = [
      { ...event, tags: event.tags.slice(0, 1) },
      { ...event, tags: [...event.tags, [...event.tags[0]]] },
      {
        ...event,
        tags: [
          ['i', 'twitter:NASA', link.proofPostId],
          ['i', `twitter_id:${link.twitterId}`, link.proofPostId],
        ],
      },
      {
        ...event,
        tags: [
          ['i', 'twitter:nasa', '1'],
          ['i', `twitter_id:${link.twitterId}`, '2'],
        ],
      },
      {
        ...event,
        tags: [
          ['i', 'twitter:nasa', link.proofPostId],
          ['i', 'twitter_id:not-numeric', link.proofPostId],
        ],
      },
    ]

    for (const fixture of fixtures) {
      expect(
        validateKind10011TwitterIdentity(fixture, { verifyEvent: false }).valid,
      ).toBe(false)
    }
  })

  it('verifies event IDs and signatures without trusting cached verification', () => {
    const event = signedIdentity()
    const tampered = { ...event, content: 'tampered' }
    const badId = validateKind10011TwitterIdentity(tampered)
    expect(badId.valid).toBe(false)
    if (!badId.valid) {
      expect(badId.errors).toContain(
        'Event id does not match its serialized event hash',
      )
    }

    const badSignature = validateKind10011TwitterIdentity({
      ...event,
      sig: '0'.repeat(128),
    })
    expect(badSignature.valid).toBe(false)
    if (!badSignature.valid) {
      expect(badSignature.errors).toContain('Event signature is invalid')
    }
  })

  it('accepts a signed generic replacement without requiring Twitter tags', () => {
    const generic = finalizeEvent(
      {
        kind: 10011,
        created_at: 1_700_000_001,
        content: 'other identity providers',
        tags: [['i', 'github:octocat', 'proof']],
      },
      secretKey,
    )

    expect(validateSignedKind10011Event(generic)).toEqual({
      valid: true,
      event: generic,
    })
    expect(validateKind10011TwitterIdentity(generic).valid).toBe(false)
  })

  it('generates and recognizes the exact NIP-39 proof text', () => {
    const npub = nip19.npubEncode(getPublicKey(secretKey))
    const proof = `Verifying my account on nostr My Public Key: "${npub}"`
    expect(buildNip39ProofText(npub)).toBe(proof)
    expect(containsNip39Proof(`Before\n${proof}\nAfter`, npub)).toBe(true)
    expect(containsNip39Proof('different text', npub)).toBe(false)
    expect(() => buildNip39ProofText('npub1invalid')).toThrow()
  })
})
