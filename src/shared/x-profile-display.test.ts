import { describe, expect, it } from 'vitest'
import {
  buildXProfileBannerUrl,
  buildXProfileIconUrl,
  isXProfileBannerPath,
  isXProfileIconPath,
  normalizeXDisplayName,
  normalizeXProfileBannerPath,
  normalizeXProfileIconPath,
  preferXProfileIconChrome,
} from './x-profile-display'

describe('x profile display helpers', () => {
  it('normalizes display names with length cap', () => {
    expect(normalizeXDisplayName('  NASA  ')).toBe('NASA')
    expect(normalizeXDisplayName('   ')).toBeUndefined()
    expect(normalizeXDisplayName('x'.repeat(120))?.length).toBe(80)
  })

  it('stores a canonical HTTPS avatar URL including the original extension', () => {
    expect(
      normalizeXProfileIconPath(
        'https://pbs.twimg.com/profile_images/11348282/abc_normal.jpg',
      ),
    ).toBe('https://pbs.twimg.com/profile_images/11348282/abc_normal.jpg')
    expect(
      normalizeXProfileIconPath(
        'http://pbs.twimg.com/profile_images/99/hash_400x400.png',
      ),
    ).toBe('https://pbs.twimg.com/profile_images/99/hash_400x400.png')
    expect(
      normalizeXProfileIconPath(
        'https://pbs.twimg.com/profile_images/1678177462591561728/oSziqC9Y_200x200.jpg',
      ),
    ).toBe(
      'https://pbs.twimg.com/profile_images/1678177462591561728/oSziqC9Y_200x200.jpg',
    )
    expect(
      normalizeXProfileIconPath(
        'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n_normal.png',
      ),
    ).toBe(
      'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n_normal.png',
    )
    expect(
      normalizeXProfileIconPath(
        'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n?format=png&name=400x400',
      ),
    ).toBe(
      'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n_400x400.png',
    )
    expect(normalizeXProfileIconPath('profile_images/11348282/abc')).toBe(
      'profile_images/11348282/abc',
    )
    expect(normalizeXProfileIconPath('https://example.com/avatar.jpg')).toBeUndefined()
  })

  it('rebuilds size variants from a stored URL without changing the extension', () => {
    expect(buildXProfileIconUrl('profile_images/11348282/abc')).toBe(
      'https://pbs.twimg.com/profile_images/11348282/abc_200x200.jpg',
    )
    expect(
      buildXProfileIconUrl(
        'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n_normal.png',
        '400x400',
      ),
    ).toBe(
      'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n_400x400.png',
    )
    expect(
      buildXProfileIconUrl(
        'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n_normal.png',
      ),
    ).toBe(
      'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n_200x200.png',
    )
  })

  it('accepts legacy stems and stored HTTPS avatar URLs', () => {
    expect(isXProfileIconPath('profile_images/11348282/abc')).toBe(true)
    expect(
      isXProfileIconPath(
        'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n_normal.png',
      ),
    ).toBe(true)
    expect(
      isXProfileIconPath(
        'http://pbs.twimg.com/profile_images/11348282/abc_normal.jpg',
      ),
    ).toBe(false)
    expect(isXProfileIconPath('https://example.com/x.png')).toBe(false)
  })

  it('does not let a later stem observation replace a stored avatar URL', () => {
    expect(
      preferXProfileIconChrome(
        'profile_images/1337607516008501250/6Ggc4S5n',
        'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n_normal.png',
      ),
    ).toBe(
      'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n_normal.png',
    )
    expect(
      preferXProfileIconChrome(
        'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n_normal.png',
        'profile_images/1337607516008501250/6Ggc4S5n',
      ),
    ).toBe(
      'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n_normal.png',
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
