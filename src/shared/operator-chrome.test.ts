import { describe, expect, it } from 'vitest'
import { resolveAccountChrome, resolveOperatorChrome } from './operator-chrome.ts'

const ICON =
  'https://pbs.twimg.com/profile_images/1/abc_normal.jpg'

describe('resolveOperatorChrome', () => {
  it('uses signed-in X chrome and ignores kind 0', () => {
    const chrome = resolveOperatorChrome({
      signedInTwitterId: '1',
      xDisplay: { displayName: 'NASA', handle: 'nasa', iconPath: ICON },
      boundTwitterIds: ['1'],
      kind0Name: 'Nostr Name',
      kind0Picture: 'https://example.com/p.png',
      accountName: 'Main',
      npubFallback: 'npub1abc',
      emptyFallback: 'No accounts',
    })
    expect(chrome.displayName).toBe('NASA')
    expect(chrome.displaySub).toBe('@nasa')
    expect(chrome.avatarUrl).toContain('pbs.twimg.com')
  })

  it('does not pick a rival X when off-tab with several bindings', () => {
    const chrome = resolveOperatorChrome({
      signedInTwitterId: null,
      boundTwitterIds: ['1', '2'],
      soleBoundDisplay: { displayName: 'Wrong', handle: 'wrong' },
      kind0Name: 'Kind Zero',
      accountName: 'Main',
      npubFallback: 'npub1abc',
      emptyFallback: 'No accounts',
    })
    expect(chrome.displayName).toBe('Main')
    expect(chrome.displaySub).toBe('npub1abc')
    expect(chrome.avatarUrl).toBeNull()
  })

  it('uses the sole bound X off-tab', () => {
    const chrome = resolveOperatorChrome({
      signedInTwitterId: null,
      boundTwitterIds: ['1'],
      soleBoundDisplay: { displayName: 'Tesla', handle: 'tesla' },
      kind0Name: 'Kind Zero',
      npubFallback: 'npub1abc',
      emptyFallback: 'No accounts',
    })
    expect(chrome.displayName).toBe('Tesla')
    expect(chrome.displaySub).toBe('@tesla')
  })

  it('falls back to kind 0 when unbound', () => {
    const chrome = resolveOperatorChrome({
      signedInTwitterId: null,
      boundTwitterIds: [],
      kind0Name: 'Kind Zero',
      kind0Picture: 'https://example.com/p.png',
      npubFallback: 'npub1abc',
      emptyFallback: 'No accounts',
    })
    expect(chrome.displayName).toBe('Kind Zero')
    expect(chrome.avatarUrl).toBe('https://example.com/p.png')
  })

  it('uses signed-in X for an account bound to it, not a rival binding', () => {
    const chrome = resolveAccountChrome({
      signedInTwitterId: '1',
      boundTwitterIds: ['1', '2'],
      xDisplays: {
        '1': { displayName: 'NASA', handle: 'nasa' },
        '2': { displayName: 'Tesla', handle: 'tesla' },
      },
      kind0Name: 'Kind Zero',
      npubFallback: 'npub1abc',
      emptyFallback: 'No accounts',
    })
    expect(chrome.displayName).toBe('NASA')
    expect(chrome.displaySub).toBe('@nasa')
  })
})
