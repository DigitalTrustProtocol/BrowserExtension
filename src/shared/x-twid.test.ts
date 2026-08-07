import { describe, expect, it } from 'vitest'
import { twitterIdFromTwidCookie } from './x-twid.ts'

describe('twitterIdFromTwidCookie', () => {
  it('parses encoded and plain twid values', () => {
    expect(twitterIdFromTwidCookie('twid=u%3D42')).toBe('42')
    expect(twitterIdFromTwidCookie('foo=1; twid="u=11348282"; bar=2')).toBe(
      '11348282',
    )
    expect(twitterIdFromTwidCookie('u=99')).toBe('99')
    expect(twitterIdFromTwidCookie('u%3D7')).toBe('7')
  })

  it('rejects missing or invalid', () => {
    expect(twitterIdFromTwidCookie('')).toBeUndefined()
    expect(twitterIdFromTwidCookie('auth_token=abc')).toBeUndefined()
    expect(twitterIdFromTwidCookie('twid=notanid')).toBeUndefined()
  })
})
