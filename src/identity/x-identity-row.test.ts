import { describe, expect, it } from 'vitest'
import {
  buildXIdentityFromObservation,
  evaluateXIdentityRow,
  isNewerSourceDate,
  mergeXIdentityProfileFromObservation,
} from './x-identity-row'
import type { XIdentityRecord } from '../storage/types'

const NPUB_A = 'npub1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const NPUB_B = 'npub1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

describe('evaluateXIdentityRow', () => {
  it('returns unverified when no source npub is present', () => {
    expect(
      evaluateXIdentityRow({
        twitterId: '11348282',
      }),
    ).toEqual({ state: 'unverified' })
  })

  it('prefers bio over post and 32009', () => {
    expect(
      evaluateXIdentityRow({
        twitterId: '11348282',
        xNpub: NPUB_A,
        xDate: 100,
        postNpub: NPUB_B,
        postDate: 200,
        eventNpub: NPUB_B,
        eventDate: 300,
      } as XIdentityRecord),
    ).toEqual({
      state: 'verified',
      proofSource: 'bio',
      winningNpub: NPUB_A,
    })
  })

  it('lets newer 10011 beat bio', () => {
    expect(
      evaluateXIdentityRow({
        twitterId: '11348282',
        xNpub: NPUB_A,
        xDate: 100,
        nip39Npub: NPUB_B,
        nip39XId: '11348282',
        nip39Date: 200,
      }),
    ).toEqual({
      state: 'verified',
      proofSource: 'nip39',
      winningNpub: NPUB_B,
    })
  })

  it('without bio chooses newer of post and 10011; post wins ties', () => {
    expect(
      evaluateXIdentityRow({
        twitterId: '11348282',
        postNpub: NPUB_A,
        postDate: 100,
        nip39Npub: NPUB_B,
        nip39XId: '11348282',
        nip39Date: 100,
      }),
    ).toEqual({
      state: 'verified',
      proofSource: 'post',
      winningNpub: NPUB_A,
    })

    expect(
      evaluateXIdentityRow({
        twitterId: '11348282',
        postNpub: NPUB_A,
        postDate: 50,
        nip39Npub: NPUB_B,
        nip39XId: '11348282',
        nip39Date: 100,
      }),
    ).toEqual({
      state: 'verified',
      proofSource: 'nip39',
      winningNpub: NPUB_B,
    })
  })

  it('uses 32009 only when no higher-source npub exists', () => {
    expect(
      evaluateXIdentityRow({
        twitterId: '11348282',
        eventNpub: NPUB_A,
      }),
    ).toEqual({
      state: 'verified',
      proofSource: 'trust32009',
      winningNpub: NPUB_A,
    })

    expect(
      evaluateXIdentityRow({
        twitterId: '11348282',
        xNpub: NPUB_B,
        xDate: 1,
        eventNpub: NPUB_A,
      }),
    ).toEqual({
      state: 'verified',
      proofSource: 'bio',
      winningNpub: NPUB_B,
    })
  })

  it('ignores nip39 when twitter_id does not match the row', () => {
    expect(
      evaluateXIdentityRow({
        twitterId: '11348282',
        nip39Npub: NPUB_A,
        nip39XId: '999',
        nip39Date: 100,
      }),
    ).toEqual({ state: 'unverified' })
  })
})

describe('isNewerSourceDate', () => {
  it('accepts first date and rejects equal/older', () => {
    expect(isNewerSourceDate(10, undefined)).toBe(true)
    expect(isNewerSourceDate(10, 5)).toBe(true)
    expect(isNewerSourceDate(10, 10)).toBe(false)
    expect(isNewerSourceDate(5, 10)).toBe(false)
  })
})

describe('buildXIdentityFromObservation', () => {
  it('preserves multi-source proof columns while updating chrome', () => {
    const existing: XIdentityRecord = {
      twitterId: '11348282',
      handle: 'nasa',
      xNpub: NPUB_A,
      xDate: 50,
      state: 'verified',
      proofSource: 'bio',
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    }
    const { record, dataChanged } = buildXIdentityFromObservation(existing, {
      twitterId: '11348282',
      handle: 'nasa',
      displayName: 'NASA',
      iconPath: 'profile_images/1/nasa',
      observedAt: 99,
      sourceOperation: 'UserByScreenName',
    })
    expect(dataChanged).toBe(true)
    expect(record.xNpub).toBe(NPUB_A)
    expect(record.displayName).toBe('NASA')
    expect(record.lastSeen).toBe(99)
  })
})

describe('mergeXIdentityProfileFromObservation', () => {
  it('detects profile changes', () => {
    expect(
      mergeXIdentityProfileFromObservation(
        {
          twitterId: '1',
          handle: 'a',
          displayName: 'Old',
          state: 'unverified',
          createdAt: 1,
          updatedAt: 1,
          lastSeen: 1,
        },
        { displayName: 'New', observedAt: 2 },
      ).profileChanged,
    ).toBe(true)
  })
})
