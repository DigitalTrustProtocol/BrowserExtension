import { describe, expect, it } from 'vitest'
import { selectFocusedProductTab } from './focused-product-tab.ts'

describe('selectFocusedProductTab', () => {
  it('locks to a focused X tab in the current window', () => {
    expect(
      selectFocusedProductTab({
        currentWindowActive: {
          id: 2,
          windowId: 1,
          url: 'https://x.com/home',
        },
        lastFocusedWindowActive: {
          id: 9,
          windowId: 2,
          url: 'https://x.com/elonmusk',
        },
      }),
    ).toMatchObject({ kind: 'ok', tabId: 2, isX: true, domain: 'x.com' })
  })

  it('treats a real non-X http tab as off-X even if another window has X', () => {
    expect(
      selectFocusedProductTab({
        currentWindowActive: {
          id: 3,
          windowId: 1,
          url: 'https://example.com',
        },
        lastFocusedWindowActive: {
          id: 9,
          windowId: 2,
          url: 'https://x.com/home',
        },
      }),
    ).toMatchObject({ kind: 'ok', tabId: 3, isX: false })
  })

  it('falls back to lastFocusedWindow when the current tab is the extension', () => {
    expect(
      selectFocusedProductTab({
        currentWindowActive: {
          id: 1,
          windowId: 1,
          url: 'chrome-extension://abc/src/popup/index.html',
        },
        lastFocusedWindowActive: {
          id: 8,
          windowId: 2,
          url: 'https://x.com/home',
        },
      }),
    ).toMatchObject({ kind: 'ok', tabId: 8, isX: true })
  })

  it('does not invent an X tab when none is focused', () => {
    expect(selectFocusedProductTab({})).toEqual({ kind: 'none' })
  })

  it('treats a permission-stripped active tab as off-X, not a previous X tab', () => {
    expect(
      selectFocusedProductTab({
        currentWindowActive: {
          id: 4,
          windowId: 1,
          url: '',
        },
        lastFocusedWindowActive: {
          id: 9,
          windowId: 2,
          url: 'https://x.com/home',
        },
      }),
    ).toMatchObject({ kind: 'ok', tabId: 4, isX: false, domain: '' })
  })
})
