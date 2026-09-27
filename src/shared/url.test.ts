import { describe, expect, it } from 'vitest'
import { normalizeRelayUrl } from './url'

describe('normalizeRelayUrl', () => {
  it('accepts ws on an IP and localhost', () => {
    expect(normalizeRelayUrl('ws://127.0.0.1:7777')).toBe('ws://127.0.0.1:7777')
    expect(normalizeRelayUrl('ws://localhost:7777')).toBe('ws://localhost:7777')
  })

  it('accepts wss and collapses a trailing slash', () => {
    expect(normalizeRelayUrl('wss://nos.lol')).toBe('wss://nos.lol')
    expect(normalizeRelayUrl('ws://127.0.0.1:7777/')).toBe('ws://127.0.0.1:7777')
    expect(normalizeRelayUrl('wss://nos.lol/')).toBe('wss://nos.lol')
  })

  it('rejects http and https', () => {
    expect(normalizeRelayUrl('http://127.0.0.1:7777')).toBeNull()
    expect(normalizeRelayUrl('https://nos.lol')).toBeNull()
  })
})
