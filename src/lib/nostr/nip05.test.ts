import { describe, expect, it } from 'vitest'
import {
  normalizeNip05Identifier,
  parseNip05Identifier,
} from './nip05'

describe('parseNip05Identifier', () => {
  it('parses and lowercases name@domain', () => {
    expect(parseNip05Identifier(' Me@Example.COM ')).toEqual({
      name: 'me',
      domain: 'example.com',
    })
    expect(parseNip05Identifier('_@nostr.example')).toEqual({
      name: '_',
      domain: 'nostr.example',
    })
  })

  it('rejects non-identifiers', () => {
    expect(parseNip05Identifier('')).toBeUndefined()
    expect(parseNip05Identifier('not-an-email')).toBeUndefined()
    expect(parseNip05Identifier('me@')).toBeUndefined()
  })
})

describe('normalizeNip05Identifier', () => {
  it('returns the canonical identifier', () => {
    expect(normalizeNip05Identifier('Me@Example.COM')).toBe('me@example.com')
  })
})
