import { describe, expect, it } from 'vitest'
import {
  buildKind0Metadata,
  compareKind0ToX,
  mergeKind0WithXPrefill,
} from './edit-profile-state.ts'

describe('mergeKind0WithXPrefill', () => {
  it('overwrites X fields and keeps Nostr-only fields', () => {
    const merged = mergeKind0WithXPrefill(
      {
        name: 'Old',
        picture: 'https://example.com/old.png',
        nip05: 'me@example.com',
        lud16: 'me@wallet.com',
        website: 'https://example.com',
        about: 'keep me',
      },
      {
        name: 'NASA',
        picture: 'https://pbs.twimg.com/profile_images/1/abc_normal.jpg',
        banner: 'https://pbs.twimg.com/profile_banners/1/2/1500x500',
      },
    )
    expect(merged.name).toBe('NASA')
    expect(merged.display_name).toBe('NASA')
    expect(merged.picture).toContain('pbs.twimg.com')
    expect(merged.banner).toContain('profile_banners')
    expect(merged.nip05).toBe('me@example.com')
    expect(merged.lud16).toBe('me@wallet.com')
    expect(merged.website).toBe('https://example.com')
    expect(merged.about).toBe('keep me')
  })

  it('writes about only when bio was read', () => {
    const skipped = mergeKind0WithXPrefill(
      { about: 'old' },
      { name: 'NASA', about: 'new bio' },
    )
    expect(skipped.about).toBe('old')
    const written = mergeKind0WithXPrefill(
      { about: 'old' },
      { name: 'NASA', about: 'new bio', aboutProvided: true },
    )
    expect(written.about).toBe('new bio')
  })
})

describe('compareKind0ToX', () => {
  it('reports missing, mismatch, and match', () => {
    expect(compareKind0ToX(null, { name: 'NASA' })).toBe('missing')
    expect(
      compareKind0ToX({ name: 'Other' }, { name: 'NASA' }),
    ).toBe('mismatch')
    expect(
      compareKind0ToX({ name: 'NASA', nip05: 'a@b.c' }, { name: 'NASA' }),
    ).toBe('match')
  })
})

describe('buildKind0Metadata', () => {
  it('deletes empty freeform fields', () => {
    const metadata = buildKind0Metadata(
      { name: 'Old', nip05: 'keep@old.com', website: 'https://old.example' },
      {
        name: 'New',
        about: '',
        picture: '',
        nip05: '',
        lud16: '',
        website: '',
        banner: '',
      },
    )
    expect(metadata.name).toBe('New')
    expect(metadata.nip05).toBeUndefined()
    expect(metadata.website).toBeUndefined()
  })
})
