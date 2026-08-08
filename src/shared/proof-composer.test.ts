import { describe, expect, it } from 'vitest'
import {
  accountsMatch,
  buildProofIntentUrl,
  buildLinkingProofText,
  extractLooseNip39ProofCandidate,
  extractNpubFromLinkingProofText,
  extractNpubFromProofPostText,
  LINKING_PROOF_PREFIX,
  normalizeProofDestination,
  parseProofPostId,
  postContainsProofForNpub,
  postTextAcceptsNpub,
  proofTextMatches,
} from './proof-composer'

const NPUB =
  'npub1aten0ysxqss2647qfte24kvy69s8zszweljf59te3kwcpv997nyqxrq4tx'
const OTHER =
  'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'

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
    const proof = buildLinkingProofText(NPUB)
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
    const proof = buildLinkingProofText(NPUB)
    expect(proofTextMatches(`Hello\n${proof}\nThanks`, proof)).toBe(true)
    expect(postContainsProofForNpub(`prefix ${proof}`, NPUB)).toBe(true)
    expect(
      postContainsProofForNpub(
        `Linking my account to Nostr: ${OTHER}`,
        NPUB,
      ),
    ).toBe(false)
    expect(proofTextMatches('unrelated', proof)).toBe(false)
    expect(proof.startsWith(LINKING_PROOF_PREFIX)).toBe(true)
    expect(extractNpubFromLinkingProofText(proof)).toBe(NPUB)
    expect(extractNpubFromLinkingProofText('nope')).toBeUndefined()
  })

  it('accepts loose verifying wording with a single npub', () => {
    const verifying = `Verifying my account on nostr My Public Key: ${NPUB}`
    expect(extractLooseNip39ProofCandidate(verifying)).toEqual({ npub: NPUB })
    expect(postTextAcceptsNpub(verifying, NPUB)).toBe(true)
    expect(extractNpubFromProofPostText(verifying)).toBe(NPUB)
  })

  it('rejects bare npub spam and multi-npub posts', () => {
    expect(
      extractLooseNip39ProofCandidate(`check out ${NPUB}`),
    ).toBeUndefined()
    expect(
      extractLooseNip39ProofCandidate(
        `Linking my account to Nostr: ${NPUB} also ${OTHER}`,
      ),
    ).toBeUndefined()
  })
})
