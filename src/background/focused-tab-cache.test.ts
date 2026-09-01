import { afterEach, describe, expect, it } from 'vitest'
import { resetChromeStorage, setChromeQueriedTabs } from './test-chrome-mock.ts'
import { FOCUSED_PRODUCT_TAB_SESSION_KEY } from '../shared/focused-product-tab.ts'
import {
  clearCachedFocusedProductTab,
  hydrateFocusedProductTab,
} from './focused-tab-cache.ts'

afterEach(() => {
  clearCachedFocusedProductTab()
  resetChromeStorage()
})

describe('hydrateFocusedProductTab', () => {
  it('keeps the last X tab when Advanced Zone takes focus', async () => {
    await chrome.storage.session.set({
      [FOCUSED_PRODUCT_TAB_SESSION_KEY]: {
        kind: 'ok',
        tabId: 2,
        windowId: 1,
        url: 'https://x.com/home',
        domain: 'x.com',
        isX: true,
      },
    })
    setChromeQueriedTabs([
      { id: 2, windowId: 1, url: 'https://x.com/home', active: false },
      {
        id: 8,
        windowId: 1,
        url: 'chrome-extension://attentionx-test/src/cockpit/index.html',
        active: true,
      },
    ])
    await expect(hydrateFocusedProductTab()).resolves.toMatchObject({
      kind: 'ok',
      tabId: 2,
      isX: true,
      domain: 'x.com',
    })
  })

  it('restores the last X tab over a permission-stripped active tab', async () => {
    await chrome.storage.session.set({
      [FOCUSED_PRODUCT_TAB_SESSION_KEY]: {
        kind: 'ok',
        tabId: 2,
        windowId: 1,
        url: 'https://x.com/home',
        domain: 'x.com',
        isX: true,
      },
    })
    setChromeQueriedTabs([
      { id: 2, windowId: 1, url: 'https://x.com/home', active: false },
      { id: 4, windowId: 1, url: '', active: true },
    ])
    await expect(hydrateFocusedProductTab()).resolves.toMatchObject({
      kind: 'ok',
      tabId: 2,
      isX: true,
      domain: 'x.com',
    })
  })

  it('treats a readable non-X http tab as off-X', async () => {
    await chrome.storage.session.set({
      [FOCUSED_PRODUCT_TAB_SESSION_KEY]: {
        kind: 'ok',
        tabId: 2,
        windowId: 1,
        url: 'https://x.com/home',
        domain: 'x.com',
        isX: true,
      },
    })
    setChromeQueriedTabs([
      { id: 2, windowId: 1, url: 'https://x.com/home', active: false },
      { id: 4, windowId: 1, url: 'https://www.google.com/', active: true },
    ])
    await expect(hydrateFocusedProductTab()).resolves.toMatchObject({
      kind: 'ok',
      tabId: 4,
      isX: false,
      domain: 'www.google.com',
    })
  })

  it('keeps a background X tab when Chrome strips its URL', async () => {
    await chrome.storage.session.set({
      [FOCUSED_PRODUCT_TAB_SESSION_KEY]: {
        kind: 'ok',
        tabId: 2,
        windowId: 1,
        url: 'https://x.com/home',
        domain: 'x.com',
        isX: true,
      },
    })
    setChromeQueriedTabs([
      { id: 2, windowId: 1, url: '', active: false },
      {
        id: 8,
        windowId: 1,
        url: 'chrome-extension://attentionx-test/src/cockpit/index.html',
        active: true,
      },
    ])
    await expect(hydrateFocusedProductTab()).resolves.toMatchObject({
      kind: 'ok',
      tabId: 2,
      isX: true,
      url: 'https://x.com/home',
    })
  })

  it('returns none for a permission-stripped tab when no X tab exists', async () => {
    setChromeQueriedTabs([{ id: 8, windowId: 1, url: '', active: true }])
    await expect(hydrateFocusedProductTab()).resolves.toEqual({ kind: 'none' })
  })

  it('keeps the last X tab when Graph or Path is focused', async () => {
    await chrome.storage.session.set({
      [FOCUSED_PRODUCT_TAB_SESSION_KEY]: {
        kind: 'ok',
        tabId: 2,
        windowId: 1,
        url: 'https://x.com/home',
        domain: 'x.com',
        isX: true,
      },
    })
    setChromeQueriedTabs([
      { id: 2, windowId: 1, url: 'https://x.com/home', active: false },
      {
        id: 8,
        windowId: 1,
        url: 'chrome-extension://attentionx-test/src/cockpit/index.html?mode=graph',
        active: true,
      },
    ])
    await expect(hydrateFocusedProductTab()).resolves.toMatchObject({
      kind: 'ok',
      tabId: 2,
      isX: true,
    })
  })

  it('restores the last X tab after a stripped tab then Graph', async () => {
    setChromeQueriedTabs([
      { id: 2, windowId: 1, url: 'https://x.com/home', active: true },
    ])
    await expect(hydrateFocusedProductTab()).resolves.toMatchObject({
      tabId: 2,
      isX: true,
    })
    setChromeQueriedTabs([
      { id: 2, windowId: 1, url: 'https://x.com/home', active: false },
      { id: 4, windowId: 1, url: '', active: true },
    ])
    await expect(hydrateFocusedProductTab()).resolves.toMatchObject({
      tabId: 2,
      isX: true,
    })
    setChromeQueriedTabs([
      { id: 2, windowId: 1, url: 'https://x.com/home', active: false },
      {
        id: 8,
        windowId: 1,
        url: 'chrome-extension://attentionx-test/src/cockpit/index.html',
        active: true,
      },
    ])
    await expect(hydrateFocusedProductTab()).resolves.toMatchObject({
      tabId: 2,
      isX: true,
      domain: 'x.com',
    })
  })
})
