import { describe, expect, it } from 'vitest'
import {
  accountsMatch,
  buildProofIntentUrl,
  buildLinkingProofText,
  extractNpubFromLinkingProofText,
  LINKING_PROOF_PREFIX,
  normalizeProofDestination,
  parseProofPostId,
  postContainsProofForNpub,
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
    const proof = 'Linking my account to Nostr: npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
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
    const npub = `npub1${'q'.repeat(58)}`
    const other = `npub1${'p'.repeat(58)}`
    const proof = buildLinkingProofText(npub)
    expect(proofTextMatches(`Hello\n${proof}\nThanks`, proof)).toBe(true)
    expect(postContainsProofForNpub(`prefix ${proof}`, npub)).toBe(true)
    expect(
      postContainsProofForNpub(
        `Linking my account to Nostr: ${other}`,
        npub,
      ),
    ).toBe(false)
    expect(proofTextMatches('unrelated', proof)).toBe(false)
    expect(proof.startsWith(LINKING_PROOF_PREFIX)).toBe(true)
    expect(extractNpubFromLinkingProofText(proof)).toBe(npub)
    expect(extractNpubFromLinkingProofText('nope')).toBeUndefined()
  })
})
