import { describe, expect, it } from 'vitest'
import {
  accountsMatch,
  buildProofIntentUrl,
  normalizeProofDestination,
  parseProofPostId,
  proofTextMatches,
} from './proof-composer'

describe('proof composer helpers', () => {
  it('normalizes destination accounts and rejects invalid IDs', () => {
    expect(normalizeProofDestination('@NASA', '11348282')).toEqual({
      handle: 'nasa',
      twitterId: '11348282',
    })
    expect(() => normalizeProofDestination('bad handle!', '1')).toThrow()
    expect(() => normalizeProofDestination('nasa', 'abc')).toThrow()
  })

  it('requires active account handle and numeric ID to match destination', () => {
    const destination = { handle: 'nasa', twitterId: '11348282' }
    expect(
      accountsMatch({ handle: 'NASA', twitterId: '11348282' }, destination),
    ).toBe(true)
    expect(
      accountsMatch({ handle: 'nasa', twitterId: '999' }, destination),
    ).toBe(false)
    expect(accountsMatch({ handle: 'nasa' }, destination)).toBe(false)
  })

  it('builds an intent URL and parses proof post IDs from URLs', () => {
    const proof = 'Verifying my account on nostr My Public Key: "npub1abc"'
    const intent = buildProofIntentUrl(proof)
    expect(intent).toContain('https://x.com/intent/post')
    expect(decodeURIComponent(new URL(intent).searchParams.get('text')!)).toBe(
      proof,
    )

    expect(parseProofPostId('2080659774136291424')).toBe('2080659774136291424')
    expect(
      parseProofPostId('https://x.com/nasa/status/2080659774136291424'),
    ).toBe('2080659774136291424')
    expect(parseProofPostId('https://example.com/status/1')).toBeUndefined()
  })

  it('matches exact NIP-39 proof text inside post bodies', () => {
    const proof = 'Verifying my account on nostr My Public Key: "npub1abc"'
    expect(proofTextMatches(`Hello\n${proof}\nThanks`, proof)).toBe(true)
    expect(proofTextMatches('unrelated', proof)).toBe(false)
  })
})
