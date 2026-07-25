import { describe, expect, it } from 'vitest'
import {
  buildNip39TwitterLinkTags,
  canonicalTwitterProfileId,
  canonicalTwitterProfileUrl,
  normalizeTwitterHandle,
  parseTwitterIdFromAuthorMeta,
} from './x-identity'

describe('x-identity', () => {
  it('normalizes Twitter handles', () => {
    expect(normalizeTwitterHandle('@NASA')).toBe('nasa')
    expect(normalizeTwitterHandle('NASA')).toBe('nasa')
  })

  it('parses numeric author identifiers from Schema.org metadata', () => {
    expect(parseTwitterIdFromAuthorMeta('11348282')).toBe('11348282')
    expect(parseTwitterIdFromAuthorMeta('nasa')).toBeUndefined()
    expect(parseTwitterIdFromAuthorMeta(undefined)).toBeUndefined()
  })

  it('prefers twitter_id for canonical profile references', () => {
    expect(
      canonicalTwitterProfileUrl({ handle: 'nasa', twitterId: '11348282' }),
    ).toBe('https://x.com/i/user/11348282')
    expect(
      canonicalTwitterProfileId({ handle: 'nasa', twitterId: '11348282' }),
    ).toBe('11348282')
  })

  it('falls back to handle when twitter_id is unavailable', () => {
    expect(canonicalTwitterProfileUrl({ handle: 'NASA' })).toBe(
      'https://x.com/nasa',
    )
    expect(canonicalTwitterProfileId({ handle: 'NASA' })).toBe('nasa')
  })

  it('builds NIP-39 kind 10011 tags for handle and twitter_id', () => {
    expect(
      buildNip39TwitterLinkTags('NASA', '11348282', '2080659774136291424'),
    ).toEqual([
      ['i', 'twitter:nasa', '2080659774136291424'],
      ['i', 'twitter_id:11348282', '2080659774136291424'],
    ])
  })
})
