import { afterEach, describe, expect, it } from 'vitest'
import { resetChromeStorage } from '../background/test-chrome-mock.ts'
import { OPERATOR_LIFECYCLE_KEY } from '../shared/operator-lifecycle.ts'
import { WIZARD_SESSION_KEY } from '../shared/panel-session.ts'
import {
  clearLocalAccounts,
  isRestoreSuppressed,
  loadOperatorLifecycle,
  removeOperatorLifecycle,
  upsertLocalAccountEntry,
  writeLocalAccounts,
} from './local-account-mirror.ts'
import type { LocalAccountEntry } from '../nip07/bg/state.ts'

afterEach(() => {
  resetChromeStorage()
})

function entry(id: string): LocalAccountEntry {
  return {
    id,
    name: 'Main',
    pubkey: `${id}${'aa'.repeat(31)}`.slice(0, 64),
    type: 'generated',
    readOnly: false,
    boundTwitterIds: [],
    boundTwitterId: null,
    boundUpdatedAt: null,
  }
}

describe('local-account-mirror lifecycle', () => {
  it('persists everHadAccounts and advances revision on create then clear then create', async () => {
    await upsertLocalAccountEntry(entry('a1'), { activeAccountId: 'a1' })
    const first = await loadOperatorLifecycle()
    expect(first?.everHadAccounts).toBe(true)
    expect(first?.restoreSuppressed).toBe(false)
    expect(first?.reason).toBe('accountPersisted')
    const firstRev = first?.revision ?? 0
    expect(firstRev).toBeGreaterThan(0)

    await clearLocalAccounts({ reason: 'lastKeyDelete' })
    const cleared = await loadOperatorLifecycle()
    expect(cleared?.everHadAccounts).toBe(true)
    expect(cleared?.restoreSuppressed).toBe(true)
    expect(cleared?.reason).toBe('lastKeyDelete')
    expect(cleared?.revision).toBeGreaterThan(firstRev)
    expect(await isRestoreSuppressed()).toBe(true)

    await upsertLocalAccountEntry(entry('a2'), { activeAccountId: 'a2' })
    const again = await loadOperatorLifecycle()
    expect(again?.restoreSuppressed).toBe(false)
    expect(again?.reason).toBe('accountPersisted')
    expect(again?.revision).toBeGreaterThan(cleared?.revision ?? 0)
    expect(await isRestoreSuppressed()).toBe(false)
  })

  it('logout and destroy keep restoreSuppressed; Delete All removes lifecycle', async () => {
    await writeLocalAccounts({
      accounts: [entry('a1')],
      activeAccountId: 'a1',
      markPersisted: true,
    })
    await clearLocalAccounts({ reason: 'logout' })
    expect((await loadOperatorLifecycle())?.reason).toBe('logout')
    expect(await isRestoreSuppressed()).toBe(true)

    await writeLocalAccounts({
      accounts: [entry('a3')],
      activeAccountId: 'a3',
      markPersisted: true,
    })
    await clearLocalAccounts({ reason: 'destroy' })
    expect((await loadOperatorLifecycle())?.reason).toBe('destroy')
    expect(await isRestoreSuppressed()).toBe(true)

    await removeOperatorLifecycle()
    expect(await loadOperatorLifecycle()).toBeNull()
    expect(await isRestoreSuppressed()).toBe(false)
    const stored = await chrome.storage.local.get(OPERATOR_LIFECYCLE_KEY)
    expect(stored[OPERATOR_LIFECYCLE_KEY]).toBeUndefined()
  })

  it('clears first-run wizard session on key wipe', async () => {
    await chrome.storage.session.set({
      [WIZARD_SESSION_KEY]: { step: 'method', ts: Date.now() },
    })
    await writeLocalAccounts({
      accounts: [entry('a1')],
      activeAccountId: 'a1',
      markPersisted: true,
    })
    await clearLocalAccounts({ reason: 'lastKeyDelete' })
    const session = await chrome.storage.session.get(WIZARD_SESSION_KEY)
    expect(session[WIZARD_SESSION_KEY]).toBeUndefined()
  })
})
