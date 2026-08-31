import { afterEach, describe, expect, it } from 'vitest'
import { resetChromeStorage } from '../background/test-chrome-mock.ts'
import * as vault from './vault.ts'
import {
  applyKeyScenario,
  readKeyScenarioStatus,
} from './admin-key-scenarios.ts'
import {
  ADMIN_DELETED_TOMBSTONE_TWITTER_ID,
  ADMIN_TEST_MNEMONIC,
  assertAdminKeyScenarioOperator,
  isAdminKeyScenarioOperator,
  isKeyScenarioId,
} from '../shared/admin-key-scenarios.ts'
import { loadOperatorLifecycle } from '../accounts/local-account-mirror.ts'
import { readEasyBlobsMap } from './easy-roaming.ts'
import { readXNostrBindings } from './x-nostr-bindings-sync.ts'
import { validateMnemonic } from './crypto/bip39.ts'

afterEach(async () => {
  try {
    if (await vault.exists()) await vault.destroy()
  } catch {
    /* ignore */
  }
  resetChromeStorage()
})

describe('admin key scenario gate', () => {
  it('accepts the Digital Trust Protocol handle and rejects others', () => {
    expect(isAdminKeyScenarioOperator('TrustProtocol')).toBe(true)
    expect(isAdminKeyScenarioOperator('@trustprotocol')).toBe(true)
    expect(isAdminKeyScenarioOperator('keutmann')).toBe(false)
    expect(isAdminKeyScenarioOperator(undefined)).toBe(false)
    expect(() => assertAdminKeyScenarioOperator('alice')).toThrow(
      /@TrustProtocol/,
    )
    expect(() => assertAdminKeyScenarioOperator('TrustProtocol')).not.toThrow()
  })

  it('recognizes known scenario ids', () => {
    expect(isKeyScenarioId('firstRun')).toBe(true)
    expect(isKeyScenarioId('afterDelete')).toBe(true)
    expect(isKeyScenarioId('nope')).toBe(false)
  })

  it('uses a valid public test mnemonic', async () => {
    expect(await validateMnemonic(ADMIN_TEST_MNEMONIC)).toBe(true)
  })
})

describe('applyKeyScenario', () => {
  it('resets to first-run with no keys and no prior delete', async () => {
    await applyKeyScenario('oneKeyUnbound')
    const status = await applyKeyScenario('firstRun')
    expect(status.lifecycle).toBe('neverUsed')
    expect(status.accountCount).toBe(0)
    expect(status.vaultExists).toBe(false)
    expect(status.vaultLocked).toBe(false)
    expect(await loadOperatorLifecycle()).toBeNull()
    expect(await vault.exists()).toBe(false)
    const blobs = await readEasyBlobsMap()
    expect(Object.keys(blobs.byTwitterId)).toHaveLength(0)
  })

  it('resets to keysCleared and writes a Sync tombstone for the fixed X id', async () => {
    const status = await applyKeyScenario('afterDelete')
    expect(status.lifecycle).toBe('keysCleared')
    expect(status.accountCount).toBe(0)
    expect(status.vaultExists).toBe(false)
    const lifecycle = await loadOperatorLifecycle()
    expect(lifecycle?.everHadAccounts).toBe(true)
    expect(lifecycle?.restoreSuppressed).toBe(true)
    expect(lifecycle?.reason).toBe('lastKeyDelete')
    const blobs = await readEasyBlobsMap()
    const tombstone = blobs.byTwitterId[ADMIN_DELETED_TOMBSTONE_TWITTER_ID]
    expect(tombstone?.deleted).toBe(true)
    expect(tombstone?.pubkeyHint).toMatch(/^[0-9a-f]{64}$/)
    expect(tombstone?.ncryptsec).toBeUndefined()
  })

  it('imports the test key never-lock and binds the current X id', async () => {
    const status = await applyKeyScenario('oneKeyBound', {
      bindTwitterId: '42',
    })
    expect(status.lifecycle).toBe('active')
    expect(status.accountCount).toBe(1)
    expect(status.vaultExists).toBe(true)
    expect(status.vaultLocked).toBe(false)
    expect(status.neverLock).toBe(true)
    expect(status.boundTwitterIds).toEqual(['42'])
    expect(vault.listAccounts()).toHaveLength(1)
    expect(vault.getActiveAccount()?.boundTwitterIds).toEqual(['42'])
    const bindings = await readXNostrBindings()
    expect(bindings.byTwitterId['42']?.pubkey).toBe(
      vault.getActiveAccount()?.pubkey,
    )
  })

  it('imports the test key never-lock without an X binding', async () => {
    const status = await applyKeyScenario('oneKeyUnbound', {
      bindTwitterId: '42',
    })
    expect(status.accountCount).toBe(1)
    expect(status.neverLock).toBe(true)
    expect(status.boundTwitterIds).toEqual([])
    expect(vault.getActiveAccount()?.boundTwitterIds).toEqual([])
    const bindings = await readXNostrBindings()
    expect(bindings.byTwitterId['42']).toBeUndefined()
  })

  it('creates a locked vault with the test key', async () => {
    const status = await applyKeyScenario('lockedVault')
    expect(status.accountCount).toBe(1)
    expect(status.vaultExists).toBe(true)
    expect(status.vaultLocked).toBe(true)
    expect(status.neverLock).toBe(false)
    expect(vault.isLocked()).toBe(true)
  })

  it('installs two HD keys from the test seed', async () => {
    const status = await applyKeyScenario('twoKeys', { bindTwitterId: '99' })
    expect(status.accountCount).toBe(2)
    expect(status.neverLock).toBe(true)
    expect(status.boundTwitterIds).toEqual(['99'])
    const listed = vault.listAccounts()
    expect(listed).toHaveLength(2)
    expect(listed[0]?.boundTwitterIds).toEqual(['99'])
    expect(listed[1]?.boundTwitterIds).toEqual([])
  })

  it('does not write IndexedDB repository keys into chrome.storage', async () => {
    await applyKeyScenario('afterDelete')
    await applyKeyScenario('oneKeyBound', { bindTwitterId: '1' })
    const local = await chrome.storage.local.get(null)
    expect(local.events).toBeUndefined()
    expect(local.xIdentities).toBeUndefined()
    expect(local.xPosts).toBeUndefined()
    expect(local.outbox).toBeUndefined()
  })
})

describe('readKeyScenarioStatus', () => {
  it('reports empty neverUsed before any apply', async () => {
    const status = await readKeyScenarioStatus()
    expect(status.lifecycle).toBe('neverUsed')
    expect(status.accountCount).toBe(0)
    expect(status.vaultExists).toBe(false)
  })
})
