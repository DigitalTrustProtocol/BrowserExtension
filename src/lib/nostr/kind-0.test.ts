import { describe, expect, it } from 'vitest'
import { buildKind0Metadata, mergeKind0WithXPrefill } from './kind-0'

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

  it('canonicalizes nip05 identifiers', () => {
    const metadata = buildKind0Metadata(null, {
      name: 'New',
      about: '',
      picture: '',
      nip05: 'Me@Example.COM',
      lud16: '',
      website: '',
      banner: '',
    })
    expect(metadata.nip05).toBe('me@example.com')
  })
})

describe('externalKind0Display', () => {
  it('keeps only normalized display fields', async () => {
    const { externalKind0Display, parseKind0Content } = await import('./kind-0')
    expect(parseKind0Content('{"name":"Ada","about":"x"}')).toEqual({
      name: 'Ada',
      about: 'x',
    })
    expect(
      externalKind0Display({
        name: ' Ada ',
        display_name: 'A',
        picture: 'https://example.com/a.png',
        about: 'secret',
        lud16: 'pay',
      }),
    ).toEqual({
      name: 'Ada',
      display_name: 'A',
      picture: 'https://example.com/a.png',
    })
    expect(parseKind0Content('not-json')).toBeNull()
  })
})
