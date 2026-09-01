import { afterEach, describe, expect, it } from 'vitest'
import {
  resetChromeStorage,
  setChromeExtensionTabIds,
  setChromeQueriedTabs,
} from './test-chrome-mock.ts'
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

  it('does not restore a previous X tab over a permission-stripped Google tab', async () => {
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
      tabId: 4,
      isX: false,
      domain: '',
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

  it('treats a permission-stripped Advanced Zone tab as an extension page', async () => {
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
      { id: 8, windowId: 1, url: '', active: true },
    ])
    setChromeExtensionTabIds([8])
    await expect(hydrateFocusedProductTab()).resolves.toMatchObject({
      kind: 'ok',
      tabId: 2,
      isX: true,
      domain: 'x.com',
    })
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

  it('restores the last X tab after Google then Graph', async () => {
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
      tabId: 4,
      isX: false,
    })
    setChromeQueriedTabs([
      { id: 2, windowId: 1, url: 'https://x.com/home', active: false },
      { id: 8, windowId: 1, url: '', active: true },
    ])
    setChromeExtensionTabIds([8])
    await expect(hydrateFocusedProductTab()).resolves.toMatchObject({
      tabId: 2,
      isX: true,
      domain: 'x.com',
    })
  })
})
