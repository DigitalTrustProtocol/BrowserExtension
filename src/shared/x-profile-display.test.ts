import { describe, expect, it } from 'vitest'
import {
  buildXProfileIconUrl,
  normalizeXDisplayName,
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
})
