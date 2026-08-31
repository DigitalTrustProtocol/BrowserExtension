import { describe, expect, it } from 'vitest'
import {
  fillXIdentityDisplayGaps,
  overlayLiveXChromeOnIdentity,
  xIdentityDisplayFromLiveChrome,
  xIdentityDisplayFromRow,
  xIdentityDisplayHasChrome,
} from './x-identity-display'
import type { XIdentityRecord } from '../storage/types'

function row(
  partial: Partial<XIdentityRecord> & Pick<XIdentityRecord, 'twitterId'>,
): XIdentityRecord {
  return {
    handle: '',
    state: 'unverified',
    createdAt: 1,
    updatedAt: 1,
    lastSeen: 1,
    ...partial,
  }
}

describe('xIdentityDisplayFromRow', () => {
  it('prefers postHandle and copies profile chrome', () => {
    expect(
      xIdentityDisplayFromRow(
        row({
          twitterId: '1',
          handle: 'old',
          postHandle: 'nasa',
          displayName: 'NASA',
          iconPath: 'profile_images/1/nasa',
          verifiedType: 'government',
        }),
      ),
    ).toEqual({
      twitterId: '1',
      displayName: 'NASA',
      handle: 'nasa',
      iconPath: 'profile_images/1/nasa',
      verifiedType: 'government',
    })
  })
})

describe('xIdentityDisplayFromLiveChrome', () => {
  it('returns undefined without a twitterId', () => {
    expect(
      xIdentityDisplayFromLiveChrome({ handle: 'nasa', displayName: 'NASA' }),
    ).toBeUndefined()
  })

  it('keeps a twitterId-only display so callers can merge a row', () => {
    expect(xIdentityDisplayFromLiveChrome({ twitterId: '1' })).toEqual({
      twitterId: '1',
    })
  })
})

describe('fillXIdentityDisplayGaps', () => {
  it('lets primary win and fills missing fields from fallback', () => {
    expect(
      fillXIdentityDisplayGaps(
        { twitterId: '1', handle: 'nasa', displayName: 'NASA Live' },
        {
          twitterId: '1',
          handle: 'stale',
          displayName: 'NASA Stored',
          iconPath: 'profile_images/1/nasa',
        },
      ),
    ).toEqual({
      twitterId: '1',
      handle: 'nasa',
      displayName: 'NASA Live',
      iconPath: 'profile_images/1/nasa',
    })
  })

  it('returns undefined when both sides are empty', () => {
    expect(fillXIdentityDisplayGaps(undefined, undefined)).toBeUndefined()
  })
})

describe('xIdentityDisplayHasChrome', () => {
  it('is true when any of name, handle, or avatar is present', () => {
    expect(xIdentityDisplayHasChrome({ twitterId: '1' })).toBe(false)
    expect(xIdentityDisplayHasChrome({ handle: 'nasa' })).toBe(true)
    expect(xIdentityDisplayHasChrome({ iconPath: 'profile_images/1/x' })).toBe(
      true,
    )
  })
})

describe('overlayLiveXChromeOnIdentity', () => {
  it('fills missing name and avatar from the signed-in session', () => {
    const identity = overlayLiveXChromeOnIdentity(
      row({ twitterId: '1', handle: '' }),
      {
        twitterId: '1',
        handle: 'nasa',
        displayName: 'NASA',
        iconPath: 'profile_images/1/nasa',
      },
    )
    expect(identity).toMatchObject({
      twitterId: '1',
      handle: 'nasa',
      displayName: 'NASA',
      iconPath: 'profile_images/1/nasa',
    })
  })

  it('does not overlay a different X account', () => {
    const identity = row({ twitterId: '1', handle: 'me' })
    expect(
      overlayLiveXChromeOnIdentity(identity, {
        twitterId: '2',
        displayName: 'Other',
      }),
    ).toBe(identity)
  })
})
