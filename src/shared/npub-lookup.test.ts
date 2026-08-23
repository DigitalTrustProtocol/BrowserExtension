import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { npubFromPubkey } from '../identity/x-identity-row'
import type { XIdentityRecord } from '../storage/types'
import {
  normalizeNpubOrHex,
  twitterIdFromWinningNpub,
  winningNpubLookupKeys,
} from './npub-lookup'

function row(
  twitterId: string,
  extra: Partial<XIdentityRecord> = {},
): XIdentityRecord {
  return {
    twitterId,
    handle: 'user',
    state: 'verified',
    createdAt: 1,
    updatedAt: 1,
    lastSeen: 1,
    ...extra,
  }
}

function npubPair() {
  const hex = getPublicKey(generateSecretKey()).toLowerCase()
  const npub = nip19.npubEncode(hex).toLowerCase()
  return { hex, npub }
}

describe('npub lookup', () => {
  it('normalizes hex and bech32 to the same pair', () => {
    const { hex, npub } = npubPair()
    expect(normalizeNpubOrHex(hex)).toEqual({ hex, npub })
    expect(normalizeNpubOrHex(npub)).toEqual({ hex, npub })
  })

  it('matches the winning bio npub, not a stale nip39 column', () => {
    const bio = npubPair()
    const stale = npubPair()
    const identities = [
      row('11348282', {
        xNpub: bio.npub,
        xDate: 200,
        nip39Npub: stale.npub,
        nip39XId: '11348282',
        nip39Date: 100,
      }),
    ]
    expect(twitterIdFromWinningNpub(identities, bio.npub)).toBe('11348282')
    expect(twitterIdFromWinningNpub(identities, bio.hex)).toBe('11348282')
    expect(twitterIdFromWinningNpub(identities, stale.npub)).toBeUndefined()
    expect(winningNpubLookupKeys(identities[0]!)).toEqual(
      expect.arrayContaining([bio.npub, bio.hex]),
    )
  })

  it('matches a 32009 winner when bio/post/nip39 are absent', () => {
    const event = npubPair()
    const identities = [row('99', { eventNpub: event.npub })]
    expect(twitterIdFromWinningNpub(identities, event.hex)).toBe('99')
  })

  it('returns undefined on miss', () => {
    const npub = npubFromPubkey('1'.repeat(64))
    expect(twitterIdFromWinningNpub([], npub ?? 'npub1qq')).toBeUndefined()
    expect(twitterIdFromWinningNpub([row('1')], 'not-an-npub')).toBeUndefined()
  })
})