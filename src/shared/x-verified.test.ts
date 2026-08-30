import { describe, expect, it } from 'vitest'
import {
  isObservedXVerifiedType,
  isXVerifiedType,
  mergeObservedXVerifiedChrome,
  normalizeXAffiliationLabel,
  pickXVerifiedChrome,
  readXVerifiedChrome,
} from './x-verified'

describe('readXVerifiedChrome', () => {
  it('maps government verified_type over is_blue_verified', () => {
    expect(
      readXVerifiedChrome({
        is_blue_verified: true,
        legacy: { verified: true, verified_type: 'Government' },
      }),
    ).toEqual({ verifiedType: 'government' })
  })

  it('maps business verified_type', () => {
    expect(
      readXVerifiedChrome({
        is_blue_verified: true,
        legacy: { verified_type: 'Business' },
      }),
    ).toEqual({ verifiedType: 'business' })
  })

  it('maps blue from is_blue_verified', () => {
    expect(readXVerifiedChrome({ is_blue_verified: true })).toEqual({
      verifiedType: 'blue',
    })
  })

  it('emits none when verification keys exist but the user is not badged', () => {
    expect(readXVerifiedChrome({ is_blue_verified: false })).toEqual({
      verifiedType: 'none',
    })
  })

  it('omits verifiedType when the User has no verification keys', () => {
    expect(readXVerifiedChrome({ rest_id: '1' })).toEqual({})
  })

  it('reads a singular highlighted affiliation and ignores the org url', () => {
    expect(
      readXVerifiedChrome({
        affiliates_highlighted_label: {
          label: {
            url: { url: 'https://x.com/Tesla', urlType: 'DeepLink' },
            badge: {
              url: 'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n_normal.png',
            },
            description: 'Tesla',
          },
        },
      }),
    ).toEqual({
      affiliationObserved: true,
      affiliationBadgePath:
        'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n_normal.png',
      affiliationLabel: 'Tesla',
    })
  })

  it('marks affiliation observed when the highlighted label is empty', () => {
    expect(
      readXVerifiedChrome({ affiliates_highlighted_label: {} }),
    ).toEqual({ affiliationObserved: true })
  })
})

describe('mergeObservedXVerifiedChrome', () => {
  it('prefers a real badge over none from a stub User', () => {
    expect(
      mergeObservedXVerifiedChrome(
        { verifiedType: 'none' },
        { verifiedType: 'blue' },
      ),
    ).toEqual({ verifiedType: 'blue' })
  })
})

describe('guards and pick', () => {
  it('accepts stored and observed type sentinels', () => {
    expect(isXVerifiedType('blue')).toBe(true)
    expect(isXVerifiedType('none')).toBe(false)
    expect(isObservedXVerifiedType('none')).toBe(true)
    expect(normalizeXAffiliationLabel('  Tesla Motors extra text here  ')).toBe(
      'Tesla Motors extra text here'.slice(0, 40),
    )
    expect(
      pickXVerifiedChrome({
        verifiedType: 'government',
        affiliationLabel: 'NASA',
      }),
    ).toEqual({ verifiedType: 'government', affiliationLabel: 'NASA' })
  })
})
