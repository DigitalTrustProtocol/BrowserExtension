import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetChromeStorage, setChromeQueriedTabs } from './test-chrome-mock.ts'
import {
  currentPanelSessionRevisionForTests,
  closePanelNotes,
  getPanelSessionSnapshot,
  notifyPanelVaultLockChanged,
  requestPanelSessionRecompute,
  resetJustWorksProvisionKick,
  resetPanelSessionControllerForTests,
  setEnsureActiveXAccountListener,
  setJustWorksProvisionListener,
} from './panel-session-controller.ts'
import { writeLocalAccounts } from '../accounts/local-account-mirror.ts'
import {
  ACTIVE_X_TAB_REGISTRY_KEY,
} from '../shared/active-x-session.ts'
import { FOCUSED_PRODUCT_TAB_SESSION_KEY } from '../shared/focused-product-tab.ts'
import { OPERATOR_LIFECYCLE_KEY } from '../shared/operator-lifecycle.ts'
import {
  JUST_WORKS_DEMO_PENDING_KEY,
  JUST_WORKS_FAILED_KEY,
  PANEL_SESSION_SNAPSHOT_KEY,
} from '../shared/panel-session.ts'
import { EASY_ACCOUNT_BLOB_KEY } from '../shared/easy-restore-available.ts'
import {
  OPEN_NOTES_ON_LAUNCH_KEY,
  SELECTED_SUBJECT_HISTORY_STORAGE_KEY,
  SELECTED_SUBJECT_STORAGE_KEY,
} from '../shared/selected-subject.ts'
import { saveActiveXTabRegistry } from './active-x-tab-store.ts'

afterEach(async () => {
  await resetPanelSessionControllerForTests()
  resetChromeStorage()
})

describe('PanelSessionController', () => {
  it('serves GET_PANEL_SESSION from storage without waiting for backend/IndexedDB', async () => {
    const snapshot = await getPanelSessionSnapshot()
    expect(snapshot.route).toBe('xUnknown')
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
    await seedIdentifiedXSession()
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

  it('kicks ENSURE fire-and-forget on unknown X without waiting on GET', async () => {
    let resolveEnsure: (() => void) | undefined
    const hook = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveEnsure = resolve
        }),
    )
    setEnsureActiveXAccountListener(hook)
    await seedConnectedXTab()
    const snapshot = await getPanelSessionSnapshot()
    expect(snapshot.x.kind).toBe('unknown')
    expect(hook).toHaveBeenCalledTimes(1)
    expect(resolveEnsure).toBeTypeOf('function')
    resolveEnsure?.()
  })

  it('does not kick ENSURE when X is identified', async () => {
    const hook = vi.fn()
    setEnsureActiveXAccountListener(hook)
    await seedConnectedXTab({
      status: 'identified',
      navigationEpoch: 1,
      twitterId: '44196397',
      handle: 'elonmusk',
    })
    const identified = await getPanelSessionSnapshot()
    expect(identified.x.kind).toBe('identified')
    expect(hook).not.toHaveBeenCalled()
  })

  it('does not kick ENSURE when X is loggedOut', async () => {
    const hook = vi.fn()
    setEnsureActiveXAccountListener(hook)
    await seedConnectedXTab({ status: 'loggedOut', navigationEpoch: 1 })
    const loggedOut = await getPanelSessionSnapshot()
    expect(loggedOut.x.kind).toBe('loggedOut')
    expect(hook).not.toHaveBeenCalled()
  })

  it('starts one automatic ENSURE per tab/navigation epoch', async () => {
    const hook = vi.fn()
    setEnsureActiveXAccountListener(hook)
    await seedConnectedXTab({ status: 'unknown', navigationEpoch: 1 })
    const first = await getPanelSessionSnapshot()
    expect(first.x.kind).toBe('unknown')
    expect(hook).toHaveBeenCalledTimes(1)

    requestPanelSessionRecompute()
    await vi.waitFor(() => {
      expect(currentPanelSessionRevisionForTests()).toBeGreaterThan(
        first.revision,
      )
    })
    expect(hook).toHaveBeenCalledTimes(1)

    await saveActiveXTabRegistry({
      version: 1,
      byTabId: {
        '2': {
          tabId: 2,
          windowId: 1,
          status: 'unknown',
          observedAt: Date.now(),
          navigationEpoch: 2,
        },
      },
    })
    requestPanelSessionRecompute()
    await vi.waitFor(() => {
      expect(hook).toHaveBeenCalledTimes(2)
    })
  })

  it('holds the mounted panel while a newly opened x.com tab identifies', async () => {
    const hook = vi.fn()
    setEnsureActiveXAccountListener(hook)
    await seedConnectedXTab({
      status: 'identified',
      navigationEpoch: 1,
      twitterId: '44196397',
      handle: 'elonmusk',
    })
    const home = await getPanelSessionSnapshot()
    expect(home.route).toBe('xHome')

    // A new x.com tab takes focus with no observation yet (xUnknown gap).
    setChromeQueriedTabs([
      { id: 2, windowId: 1, url: 'https://x.com/home', active: false },
      { id: 9, windowId: 1, url: 'https://x.com/elonmusk', active: true },
    ])
    const reopened = await getPanelSessionSnapshot()
    expect(reopened.route).toBe('xHome')
    await vi.waitFor(() => {
      expect(hook).toHaveBeenCalledTimes(1)
    })
    // Held: no new broadcast and the persisted snapshot stays on xHome.
    expect(currentPanelSessionRevisionForTests()).toBe(home.revision)
    const stored = await chrome.storage.session.get(PANEL_SESSION_SNAPSHOT_KEY)
    expect(
      (stored[PANEL_SESSION_SNAPSHOT_KEY] as { route?: string } | undefined)
        ?.route,
    ).toBe('xHome')
  })

  it('adopts the new x.com tab identity after the hold', async () => {
    await seedConnectedXTab({
      status: 'identified',
      navigationEpoch: 1,
      twitterId: '44196397',
      handle: 'elonmusk',
    })
    const home = await getPanelSessionSnapshot()
    expect(home.route).toBe('xHome')

    setChromeQueriedTabs([
      { id: 2, windowId: 1, url: 'https://x.com/home', active: false },
      { id: 9, windowId: 1, url: 'https://x.com/home', active: true },
    ])
    await getPanelSessionSnapshot()
    // ENSURE identifies the new tab (same account).
    await saveActiveXTabRegistry({
      version: 1,
      byTabId: {
        '9': {
          tabId: 9,
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
    })
    requestPanelSessionRecompute()
    await vi.waitFor(() => {
      expect(currentPanelSessionRevisionForTests()).toBeGreaterThan(
        home.revision,
      )
    })
    const adopted = await getPanelSessionSnapshot()
    expect(adopted.route).toBe('xHome')
    expect(adopted.x).toMatchObject({
      kind: 'identified',
      tabId: 9,
      twitterId: '44196397',
    })
  })

  it('shows xLoggedOut when the newly opened x.com tab is logged out', async () => {
    await seedConnectedXTab({
      status: 'identified',
      navigationEpoch: 1,
      twitterId: '44196397',
      handle: 'elonmusk',
    })
    const home = await getPanelSessionSnapshot()
    expect(home.route).toBe('xHome')

    setChromeQueriedTabs([
      { id: 2, windowId: 1, url: 'https://x.com/home', active: false },
      { id: 9, windowId: 1, url: 'https://x.com/home', active: true },
    ])
    await saveActiveXTabRegistry({
      version: 1,
      byTabId: {
        '9': {
          tabId: 9,
          windowId: 1,
          status: 'loggedOut',
          observedAt: Date.now(),
          navigationEpoch: 1,
        },
      },
    })
    requestPanelSessionRecompute()
    await vi.waitFor(() => {
      expect(currentPanelSessionRevisionForTests()).toBeGreaterThan(
        home.revision,
      )
    })
    const loggedOut = await getPanelSessionSnapshot()
    expect(loggedOut.route).toBe('xLoggedOut')
  })

  it('shows xUnknown over a message-only route while a new x.com tab identifies', async () => {
    const hook = vi.fn()
    setEnsureActiveXAccountListener(hook)
    setChromeQueriedTabs([
      { id: 4, windowId: 1, url: 'https://www.google.com/' },
    ])
    await chrome.storage.local.set({
      keyVault: { version: 1 },
      autoLockMs: 0,
      allowedDomains: ['x.com'],
      xHostOneTimeAutoConnectDone: true,
    })
    const unsupported = await getPanelSessionSnapshot()
    expect(unsupported.route).toBe('unsupportedSite')

    setChromeQueriedTabs([{ id: 9, windowId: 1, url: 'https://x.com/home' }])
    requestPanelSessionRecompute()
    await vi.waitFor(() => {
      expect(currentPanelSessionRevisionForTests()).toBeGreaterThan(
        unsupported.revision,
      )
    })
    expect(hook).toHaveBeenCalledTimes(1)
    const next = await getPanelSessionSnapshot()
    expect(next.route).toBe('xUnknown')
  })

  it('does not kick JustWorks on the Demo / Live intro', async () => {
    let calls = 0
    setJustWorksProvisionListener(async () => {
      calls += 1
      return { ok: true, demoPending: false }
    })
    await seedIdentifiedXSession()
    const snapshot = await getPanelSessionSnapshot()
    expect(snapshot.route).toBe('demoChoice')
    await Promise.resolve()
    expect(calls).toBe(0)
  })

  it('kicks justWorksProvision once to restore an Easy blob', async () => {
    let calls = 0
    setJustWorksProvisionListener(async () => {
      calls += 1
      return { ok: true, demoPending: false }
    })
    await seedIdentifiedXSession()
    await seedEasyRestoreAvailable()
    const snapshot = await getPanelSessionSnapshot()
    expect(snapshot.route).toBe('justWorks')
    await vi.waitFor(() => {
      expect(calls).toBe(1)
    })
    await getPanelSessionSnapshot()
    expect(calls).toBe(1)
  })

  it('re-kicks JustWorks after a full wipe back to neverUsed', async () => {
    let calls = 0
    setJustWorksProvisionListener(async () => {
      calls += 1
      return { ok: true, demoPending: false }
    })
    await seedIdentifiedXSession()
    await seedEasyRestoreAvailable()
    await getPanelSessionSnapshot()
    await vi.waitFor(() => {
      expect(calls).toBe(1)
    })
    resetJustWorksProvisionKick()
    requestPanelSessionRecompute()
    await vi.waitFor(() => {
      expect(calls).toBe(2)
    })
  })

  it('does not kick JustWorks after keysCleared', async () => {
    let calls = 0
    setJustWorksProvisionListener(async () => {
      calls += 1
      return { ok: true, demoPending: true }
    })
    await seedIdentifiedXSession()
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
    await Promise.resolve()
    expect(calls).toBe(0)
    const session = await chrome.storage.session.get(JUST_WORKS_DEMO_PENDING_KEY)
    expect(session[JUST_WORKS_DEMO_PENDING_KEY]).toBeUndefined()
  })

  it('does not kick JustWorks when the vault is locked', async () => {
    let calls = 0
    setJustWorksProvisionListener(async () => {
      calls += 1
      return { ok: false, reason: 'locked' }
    })
    await seedIdentifiedXSession()
    await chrome.storage.local.set({
      keyVault: { version: 1 },
      autoLockMs: 60_000,
    })
    notifyPanelVaultLockChanged(true)
    const snapshot = await getPanelSessionSnapshot()
    expect(snapshot.route).toBe('unlock')
    expect(calls).toBe(0)
  })

  it('does not kick JustWorks for remoteOnly recovery', async () => {
    let calls = 0
    setJustWorksProvisionListener(async () => {
      calls += 1
      return { ok: true, demoPending: true }
    })
    setChromeQueriedTabs([{ id: 2, windowId: 1, url: 'https://x.com/home' }])
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
    expect(calls).toBe(0)
  })

  it('records justWorksFailed when provision fails', async () => {
    setJustWorksProvisionListener(async () => ({
      ok: false,
      reason: 'generate-failed',
    }))
    await seedIdentifiedXSession()
    await seedEasyRestoreAvailable()
    await getPanelSessionSnapshot()
    await vi.waitFor(async () => {
      const session = await chrome.storage.session.get(JUST_WORKS_FAILED_KEY)
      expect(session[JUST_WORKS_FAILED_KEY]).toBe(true)
    })
  })

  it('does not kick JustWorks off an X host', async () => {
    let calls = 0
    setJustWorksProvisionListener(async () => {
      calls += 1
      return { ok: true, demoPending: true }
    })
    setChromeQueriedTabs([
      { id: 9, windowId: 1, url: 'https://www.google.com/' },
    ])
    await chrome.storage.session.set({
      [FOCUSED_PRODUCT_TAB_SESSION_KEY]: {
        kind: 'ok',
        tabId: 9,
        windowId: 1,
        url: 'https://www.google.com/',
        domain: 'www.google.com',
        isX: false,
      },
    })
    const snapshot = await getPanelSessionSnapshot()
    expect(snapshot.route).toBe('unsupportedSite')
    await Promise.resolve()
    expect(calls).toBe(0)
  })

  it('keeps the identified X user when Advanced Zone is the active tab', async () => {
    await seedIdentifiedXSession()
    setChromeQueriedTabs([
      { id: 2, windowId: 1, url: 'https://x.com/home', active: false },
      {
        id: 8,
        windowId: 1,
        url: 'chrome-extension://attentionx-test/src/cockpit/index.html',
        active: true,
      },
    ])
    const snapshot = await getPanelSessionSnapshot()
    expect(snapshot.route).not.toBe('unsupportedSite')
    expect(snapshot.x).toMatchObject({
      kind: 'identified',
      twitterId: '44196397',
      handle: 'elonmusk',
    })
  })

  it('keeps the identified X user when Graph is the active tab', async () => {
    await seedIdentifiedXSession()
    setChromeQueriedTabs([
      { id: 2, windowId: 1, url: 'https://x.com/home', active: false },
      {
        id: 8,
        windowId: 1,
        url: 'chrome-extension://attentionx-test/src/cockpit/index.html?mode=path',
        active: true,
      },
    ])
    const snapshot = await getPanelSessionSnapshot()
    expect(snapshot.route).not.toBe('unsupportedSite')
    expect(snapshot.x).toMatchObject({
      kind: 'identified',
      twitterId: '44196397',
    })
  })

  it('does not kick JustWorks while X is logged out', async () => {
    let calls = 0
    setJustWorksProvisionListener(async () => {
      calls += 1
      return { ok: true, demoPending: true }
    })
    setChromeQueriedTabs([{ id: 2, windowId: 1, url: 'https://x.com/home' }])
    await chrome.storage.local.set({
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
          '2': {
            tabId: 2,
            windowId: 1,
            status: 'loggedOut',
            observedAt: Date.now(),
            navigationEpoch: 1,
          },
        },
      },
    })
    const snapshot = await getPanelSessionSnapshot()
    expect(snapshot.route).toBe('xLoggedOut')
    await Promise.resolve()
    expect(calls).toBe(0)
  })

  it('does not kick JustWorks while X is unknown', async () => {
    let justWorksCalls = 0
    setJustWorksProvisionListener(async () => {
      justWorksCalls += 1
      return { ok: true, demoPending: true }
    })
    const ensure = vi.fn()
    setEnsureActiveXAccountListener(ensure)
    await seedConnectedXTab({ status: 'unknown', navigationEpoch: 1 })
    const snapshot = await getPanelSessionSnapshot()
    expect(snapshot.route).toBe('xUnknown')
    expect(ensure).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(justWorksCalls).toBe(0)
  })
})

async function seedEasyRestoreAvailable(): Promise<void> {
  await chrome.storage.sync.set({
    [EASY_ACCOUNT_BLOB_KEY]: {
      version: 1,
      pubkeyHint: 'aa'.repeat(32),
    },
  })
}

async function seedIdentifiedXSession(): Promise<void> {
  setChromeQueriedTabs([{ id: 2, windowId: 1, url: 'https://x.com/home' }])
  await chrome.storage.local.set({
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
}

async function seedConnectedXTab(options?: {
  status?: 'unknown' | 'loggedOut' | 'identified'
  navigationEpoch?: number
  twitterId?: string
  handle?: string
}): Promise<void> {
  setChromeQueriedTabs([{ id: 2, windowId: 1, url: 'https://x.com/home' }])
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
  const status = options?.status
  await chrome.storage.session.set({
    [FOCUSED_PRODUCT_TAB_SESSION_KEY]: {
      kind: 'ok',
      tabId: 2,
      windowId: 1,
      url: 'https://x.com/home',
      domain: 'x.com',
      isX: true,
    },
    ...(status
      ? {
          [ACTIVE_X_TAB_REGISTRY_KEY]: {
            version: 1,
            byTabId: {
              '2': {
                tabId: 2,
                windowId: 1,
                status,
                observedAt: Date.now(),
                navigationEpoch: options?.navigationEpoch ?? 1,
                ...(status === 'identified'
                  ? {
                      account: {
                        handle: options?.handle ?? 'elonmusk',
                        twitterId: options?.twitterId ?? '44196397',
                        detectedAt: Date.now(),
                      },
                    }
                  : {}),
              },
            },
          },
        }
      : {}),
  })
}
