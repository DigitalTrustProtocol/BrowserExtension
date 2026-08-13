import { describe, expect, it } from 'vitest'
import { parseXProfileHandle, parseXStatusPostId } from './x-status-url'

describe('parseXStatusPostId', () => {
  it('extracts post id from status URL', () => {
    expect(
      parseXStatusPostId('https://x.com/alice/status/2080659774136291424'),
    ).toBe('2080659774136291424')
  })

  it('returns null for profile and home', () => {
    expect(parseXStatusPostId('https://x.com/alice')).toBeNull()
    expect(parseXStatusPostId('https://x.com/home')).toBeNull()
  })

  it('rejects non-X hosts', () => {
    expect(
      parseXStatusPostId('https://example.com/status/1234567890123456789'),
    ).toBeNull()
  })
})

describe('parseXProfileHandle', () => {
  it('extracts a profile handle', () => {
    expect(parseXProfileHandle('https://x.com/alice')).toBe('alice')
  })

  it('returns null for home, status, and reserved paths', () => {
    expect(parseXProfileHandle('https://x.com/home')).toBeNull()
    expect(
      parseXProfileHandle('https://x.com/alice/status/2080659774136291424'),
    ).toBe('alice')
    expect(parseXProfileHandle('https://x.com/explore')).toBeNull()
  })
})
