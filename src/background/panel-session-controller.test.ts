import { afterEach, describe, expect, it } from 'vitest'
import { resetChromeStorage, setChromeQueriedTabs } from './test-chrome-mock.ts'
import {
  currentPanelSessionRevisionForTests,
  closePanelNotes,
  getPanelSessionSnapshot,
  resetPanelSessionControllerForTests,
} from './panel-session-controller.ts'
import { writeLocalAccounts } from '../accounts/local-account-mirror.ts'
import {
  ACTIVE_X_TAB_REGISTRY_KEY,
} from '../shared/active-x-session.ts'
import { FOCUSED_PRODUCT_TAB_SESSION_KEY } from '../shared/focused-product-tab.ts'
import { OPERATOR_LIFECYCLE_KEY } from '../shared/operator-lifecycle.ts'
import {
  OPEN_NOTES_ON_LAUNCH_KEY,
  SELECTED_SUBJECT_HISTORY_STORAGE_KEY,
  SELECTED_SUBJECT_STORAGE_KEY,
} from '../shared/selected-subject.ts'

afterEach(async () => {
  await resetPanelSessionControllerForTests()
  resetChromeStorage()
})

describe('PanelSessionController', () => {
  it('serves GET_PANEL_SESSION from storage without waiting for backend/IndexedDB', async () => {
    const snapshot = await getPanelSessionSnapshot()
    expect(snapshot.route).toBe('firstRun')
    expect(snapshot.lifecycle).toBe('neverUsed')
    expect(snapshot.revision).toBeGreaterThan(0)
  })

  it('serializes recomputes so revisions stay monotonic', async () => {
    const first = await getPanelSessionSnapshot()
    const second = await getPanelSessionSnapshot()
    expect(second.revision).toBeGreaterThanOrEqual(first.revision)
    expect(currentPanelSessionRevisionForTests()).toBeGreaterThanOrEqual(
      second.revision,
    )
  })

  it('routes last-key-delete to afterKeyClear, not firstRun', async () => {
    await chrome.storage.local.set({
      [OPERATOR_LIFECYCLE_KEY]: {
        version: 1,
        revision: 2,
        everHadAccounts: true,
        restoreSuppressed: true,
        changedAt: 1,
        reason: 'lastKeyDelete',
      },
    })
    const snapshot = await getPanelSessionSnapshot()
    expect(snapshot.route).toBe('afterKeyClear')
    expect(snapshot.lifecycle).toBe('keysCleared')
  })

  it('uses the focused tab observation, not another tab in the registry', async () => {
    setChromeQueriedTabs([
      { id: 2, windowId: 1, url: 'https://x.com/home' },
    ])
    await writeLocalAccounts({
      accounts: [
        {
          id: 'acct-1',
          name: 'Main',
          pubkey: 'aa'.repeat(32),
          type: 'generated',
          readOnly: false,
          boundTwitterIds: ['44196397'],
          boundTwitterId: '44196397',
          boundUpdatedAt: 1,
        },
      ],
      activeAccountId: 'acct-1',
      markPersisted: true,
    })
    await chrome.storage.local.set({
      keyVault: { version: 1 },
      autoLockMs: 0,
      allowedDomains: ['x.com'],
      xHostOneTimeAutoConnectDone: true,
    })
    await chrome.storage.session.set({
      [FOCUSED_PRODUCT_TAB_SESSION_KEY]: {
        kind: 'ok',
        tabId: 2,
        windowId: 1,
        url: 'https://x.com/home',
        domain: 'x.com',
        isX: true,
      },
      [ACTIVE_X_TAB_REGISTRY_KEY]: {
        version: 1,
        byTabId: {
          '1': {
            tabId: 1,
            windowId: 1,
            status: 'identified',
            observedAt: Date.now(),
            navigationEpoch: 1,
            account: {
              handle: 'other',
              twitterId: '999',
              detectedAt: Date.now(),
            },
          },
          '2': {
            tabId: 2,
            windowId: 1,
            status: 'identified',
            observedAt: Date.now(),
            navigationEpoch: 3,
            account: {
              handle: 'elonmusk',
              twitterId: '44196397',
              detectedAt: Date.now(),
            },
          },
        },
      },
    })
    const snapshot = await getPanelSessionSnapshot()
    expect(snapshot.x).toMatchObject({
      kind: 'identified',
      tabId: 2,
      twitterId: '44196397',
    })
    expect(snapshot.binding.kind).toBe('localBound')
    expect(snapshot.route).toBe('xHome')
  })

  it('does not treat Sync-only pubkey evidence as a local Home binding', async () => {
    setChromeQueriedTabs([
      { id: 2, windowId: 1, url: 'https://x.com/home' },
    ])
    await writeLocalAccounts({
      accounts: [
        {
          id: 'acct-1',
          name: 'Main',
          pubkey: 'aa'.repeat(32),
          type: 'generated',
          readOnly: false,
          boundTwitterIds: [],
          boundTwitterId: null,
          boundUpdatedAt: null,
        },
      ],
      activeAccountId: 'acct-1',
      markPersisted: true,
    })
    await chrome.storage.local.set({
      keyVault: { version: 1 },
      autoLockMs: 0,
      allowedDomains: ['x.com'],
      xHostOneTimeAutoConnectDone: true,
    })
    await chrome.storage.sync.set({
      xNostrBindings: {
        version: 1,
        byTwitterId: {
          '44196397': { pubkey: 'bb'.repeat(32), updatedAt: 1 },
        },
      },
    })
    await chrome.storage.session.set({
      [FOCUSED_PRODUCT_TAB_SESSION_KEY]: {
        kind: 'ok',
        tabId: 2,
        windowId: 1,
        url: 'https://x.com/home',
        domain: 'x.com',
        isX: true,
      },
      [ACTIVE_X_TAB_REGISTRY_KEY]: {
        version: 1,
        byTabId: {
          '2': {
            tabId: 2,
            windowId: 1,
            status: 'identified',
            observedAt: Date.now(),
            navigationEpoch: 1,
            account: {
              handle: 'elonmusk',
              twitterId: '44196397',
              detectedAt: Date.now(),
            },
          },
        },
      },
    })
    const snapshot = await getPanelSessionSnapshot()
    expect(snapshot.binding.kind).toBe('remoteOnly')
    expect(snapshot.route).toBe('xUnbound')
  })

  it('assembles selected Notes subject from session storage, not the other tab', async () => {
    setChromeQueriedTabs([
      { id: 2, windowId: 1, url: 'https://x.com/home' },
    ])
    await writeLocalAccounts({
      accounts: [
        {
          id: 'acct-1',
          name: 'Main',
          pubkey: 'aa'.repeat(32),
          type: 'generated',
          readOnly: false,
          boundTwitterIds: ['44196397'],
          boundTwitterId: '44196397',
          boundUpdatedAt: 1,
        },
      ],
      activeAccountId: 'acct-1',
      markPersisted: true,
    })
    await chrome.storage.local.set({
      keyVault: { version: 1 },
      autoLockMs: 0,
      allowedDomains: ['x.com'],
      xHostOneTimeAutoConnectDone: true,
    })
    await chrome.storage.session.set({
      [FOCUSED_PRODUCT_TAB_SESSION_KEY]: {
        kind: 'ok',
        tabId: 2,
        windowId: 1,
        url: 'https://x.com/home',
        domain: 'x.com',
        isX: true,
      },
      [ACTIVE_X_TAB_REGISTRY_KEY]: {
        version: 1,
        byTabId: {
          '1': {
            tabId: 1,
            windowId: 1,
            status: 'identified',
            observedAt: Date.now(),
            navigationEpoch: 1,
            account: {
              handle: 'other',
              twitterId: '999',
              detectedAt: Date.now(),
            },
          },
          '2': {
            tabId: 2,
            windowId: 1,
            status: 'identified',
            observedAt: Date.now(),
            navigationEpoch: 3,
            account: {
              handle: 'elonmusk',
              twitterId: '44196397',
              detectedAt: Date.now(),
            },
          },
        },
      },
      [OPEN_NOTES_ON_LAUNCH_KEY]: true,
      [SELECTED_SUBJECT_STORAGE_KEY]: {
        subject: { type: 'i', value: 'user:id:11348282' },
      },
      [SELECTED_SUBJECT_HISTORY_STORAGE_KEY]: {
        entries: [
          { subject: { type: 'i', value: 'user:id:1' } },
          { subject: { type: 'i', value: 'user:id:11348282' } },
        ],
        index: 1,
      },
    })
    const snapshot = await getPanelSessionSnapshot()
    expect(snapshot.route).toBe('xHome')
    expect(snapshot.x).toMatchObject({ twitterId: '44196397' })
    expect(snapshot.intent.notesRequested).toBe(true)
    expect(snapshot.intent.selected).toEqual({
      subject: { type: 'i', value: 'user:id:11348282' },
    })
    expect(snapshot.intent.canBack).toBe(true)
    expect(snapshot.intent.canForward).toBe(false)
  })

  it('closePanelNotes clears notesRequested without changing the selected subject', async () => {
    await chrome.storage.session.set({
      [OPEN_NOTES_ON_LAUNCH_KEY]: true,
      [SELECTED_SUBJECT_STORAGE_KEY]: {
        subject: { type: 'i', value: 'user:id:99' },
      },
    })
    const before = await getPanelSessionSnapshot()
    expect(before.intent.notesRequested).toBe(true)
    await closePanelNotes()
    const after = await getPanelSessionSnapshot()
    expect(after.intent.notesRequested).toBe(false)
    expect(after.intent.selected).toEqual({
      subject: { type: 'i', value: 'user:id:99' },
    })
  })

  it('does not throw when PANEL_SESSION_CHANGED has no receiver', async () => {
    const original = chrome.runtime.sendMessage
    chrome.runtime.sendMessage = (async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.')
    }) as typeof chrome.runtime.sendMessage
    try {
      const snapshot = await getPanelSessionSnapshot()
      expect(snapshot.revision).toBeGreaterThan(0)
    } finally {
      chrome.runtime.sendMessage = original
    }
  })
})
