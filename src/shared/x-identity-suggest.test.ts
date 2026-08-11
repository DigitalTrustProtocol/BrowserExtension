import { describe, expect, it } from 'vitest'
import { resolveIdentitySuggestFlags } from './x-identity-suggest'

const NPUB_A = `npub1${'q'.repeat(58)}`
const NPUB_B = `npub1${'z'.repeat(58)}`

describe('resolveIdentitySuggestFlags', () => {
  it('hides Update Bio only when bioUpdatedAt is persisted', () => {
    expect(
      resolveIdentitySuggestFlags({
        activeNpub: NPUB_A,
        twitterId: '1',
      }).hasBioNpubForActive,
    ).toBe(false)
    expect(
      resolveIdentitySuggestFlags({
        activeNpub: NPUB_A,
        twitterId: '1',
        bioUpdatedPersisted: true,
      }).hasBioNpubForActive,
    ).toBe(true)
  })

  it('exposes mismatch warning from persisted other npub', () => {
    const flags = resolveIdentitySuggestFlags({
      activeNpub: NPUB_A,
      twitterId: '1',
      bioMismatchNpub: NPUB_B,
    })
    expect(flags.hasBioNpubForActive).toBe(false)
    expect(flags.bioNpubMismatch).toBe(true)
    expect(flags.otherBioNpub).toBe(NPUB_B)
  })

  it('detects matching kind 10011 claim by twitterId', () => {
    const tags = [
      ['i', 'twitter:nasa', '99', 'post:id:99'],
      ['i', 'twitter_id:11348282', '99', 'post:id:99'],
    ]
    expect(
      resolveIdentitySuggestFlags({
        activeNpub: NPUB_A,
        twitterId: '11348282',
        current10011Tags: tags,
      }).hasMatching10011ForActive,
    ).toBe(true)
    expect(
      resolveIdentitySuggestFlags({
        activeNpub: NPUB_A,
        twitterId: '1',
        current10011Tags: tags,
      }).hasMatching10011ForActive,
    ).toBe(false)
    expect(
      resolveIdentitySuggestFlags({
        activeNpub: NPUB_A,
        twitterId: '1',
        publishedBindingPersisted: true,
      }).hasMatching10011ForActive,
    ).toBe(true)
  })
})
