import { describe, expect, it } from 'vitest'
import {
  buildXProfileBannerUrl,
  buildXProfileIconUrl,
  isXProfileBannerPath,
  normalizeXDisplayName,
  normalizeXProfileBannerPath,
  normalizeXProfileIconPath,
} from './x-profile-display'

describe('x profile display helpers', () => {
  it('normalizes display names with length cap', () => {
    expect(normalizeXDisplayName('  NASA  ')).toBe('NASA')
    expect(normalizeXDisplayName('   ')).toBeUndefined()
    expect(normalizeXDisplayName('x'.repeat(120))?.length).toBe(80)
  })

  it('stores only the profile image path stem', () => {
    expect(
      normalizeXProfileIconPath(
        'https://pbs.twimg.com/profile_images/11348282/abc_normal.jpg',
      ),
    ).toBe('profile_images/11348282/abc')
    expect(
      normalizeXProfileIconPath(
        'http://pbs.twimg.com/profile_images/99/hash_400x400.png',
      ),
    ).toBe('profile_images/99/hash')
    expect(
      normalizeXProfileIconPath(
        'https://pbs.twimg.com/profile_images/1678177462591561728/oSziqC9Y_200x200.jpg',
      ),
    ).toBe('profile_images/1678177462591561728/oSziqC9Y')
    expect(normalizeXProfileIconPath('https://example.com/avatar.jpg')).toBeUndefined()
  })

  it('builds a full profile image URL from the stored path', () => {
    expect(buildXProfileIconUrl('profile_images/11348282/abc')).toBe(
      'https://pbs.twimg.com/profile_images/11348282/abc_200x200.jpg',
    )
  })

  it('stores only the profile banner path stem', () => {
    expect(
      normalizeXProfileBannerPath(
        'https://pbs.twimg.com/profile_banners/44196397/1774145451',
      ),
    ).toBe('profile_banners/44196397/1774145451')
    expect(
      normalizeXProfileBannerPath(
        'https://pbs.twimg.com/profile_banners/44196397/1774145451/600x200',
      ),
    ).toBe('profile_banners/44196397/1774145451')
    expect(
      normalizeXProfileBannerPath(
        'http://pbs.twimg.com/profile_banners/11348282/1/1500x500',
      ),
    ).toBe('profile_banners/11348282/1')
    expect(
      normalizeXProfileBannerPath('profile_banners/44196397/1774145451'),
    ).toBe('profile_banners/44196397/1774145451')
    expect(
      normalizeXProfileBannerPath(
        'https://pbs.twimg.com/profile_images/11348282/nasa_400x400.jpg',
      ),
    ).toBeUndefined()
    expect(
      normalizeXProfileBannerPath('https://example.com/banner.jpg'),
    ).toBeUndefined()
    expect(isXProfileBannerPath('profile_banners/44196397/1774145451')).toBe(
      true,
    )
    expect(isXProfileBannerPath('profile_images/11348282/nasa')).toBe(false)
  })

  it('builds a full-bleed banner URL from the stored path', () => {
    expect(
      buildXProfileBannerUrl('profile_banners/44196397/1774145451'),
    ).toBe(
      'https://pbs.twimg.com/profile_banners/44196397/1774145451/1500x500',
    )
  })
})
