/**
 * Apply Admin key-management fixtures to the local vault / lifecycle / Sync
 * roaming markers. Never writes IndexedDB, X profile, or Nostr events.
 *
 * @module vault/admin-key-scenarios
 */

import browser from './browser.ts'
import * as vault from './vault.ts'
import * as signer from '../lib/nostr/nip07/signer.ts'
import * as accounts from '../accounts/accounts.ts'
import {
  clearLocalAccounts,
  loadOperatorLifecycle,
  readLocalAccounts,
  removeOperatorLifecycle,
  toLocalAccountEntry,
  writeLocalAccounts,
} from '../accounts/local-account-mirror.ts'
import { normalizeBoundTwitterId } from '../accounts/x-binding.ts'
import { markEasyBlobDeletedForTwitterId } from './easy-roaming.ts'
import { clearAllRoamingSyncData } from './browser-key-roaming.ts'
import { upsertXNostrBinding } from './x-nostr-bindings-sync.ts'
import { derivePanelLifecycle } from '../shared/operator-lifecycle.ts'
import { APP_MODE_STORAGE_KEY, DEFAULT_APP_MODE } from '../shared/app-mode.ts'
import {
  ADMIN_DELETED_TOMBSTONE_TWITTER_ID,
  ADMIN_TEST_MNEMONIC,
  ADMIN_TEST_VAULT_PASSWORD,
  type KeyScenarioId,
  type KeyScenarioStatus,
} from '../shared/admin-key-scenarios.ts'
import type { Account } from './types.ts'

export {
  ADMIN_DELETED_TOMBSTONE_TWITTER_ID,
  ADMIN_KEY_SCENARIO_HANDLE,
  ADMIN_TEST_MNEMONIC,
  ADMIN_TEST_VAULT_PASSWORD,
  KEY_SCENARIO_IDS,
  assertAdminKeyScenarioOperator,
  isAdminKeyScenarioOperator,
  isKeyScenarioId,
} from '../shared/admin-key-scenarios.ts'
export type {
  KeyScenarioId,
  KeyScenarioStatus,
} from '../shared/admin-key-scenarios.ts'

const UNLOCK_GUARD_KEY = 'vaultUnlockGuard'
const DEFAULT_AUTO_LOCK_MS = 900_000

export interface ApplyKeyScenarioContext {
  /** Signed-in X numeric id used when a scenario binds a key. */
  bindTwitterId?: string | null
}

async function wipeKeys(
  reason: 'destroy' | 'lastKeyDelete',
): Promise<void> {
  await signer.cancelAllUnlockWaiters()
  await vault.destroy()
  await clearLocalAccounts({
    reason,
    extraRemove: ['autoLockMs', UNLOCK_GUARD_KEY],
  })
  await browser.storage.sync.remove('myPubkey')
}

function withBinding(account: Account, twitterId?: string | null): Account {
  const tid = normalizeBoundTwitterId(twitterId)
  if (!tid) return account
  const now = Date.now()
  return {
    ...account,
    boundTwitterIds: [tid],
    boundTwitterId: tid,
    boundUpdatedAt: now,
  }
}

async function persistBindingIndex(account: Account): Promise<void> {
  const tid = normalizeBoundTwitterId(account.boundTwitterId)
  if (!tid) return
  await upsertXNostrBinding({
    twitterId: tid,
    pubkey: account.pubkey,
    updatedAt: account.boundUpdatedAt ?? Date.now(),
  })
}

async function installAccounts(
  nextAccounts: Account[],
  options: {
    password: string
    autoLockMs: number
    lockAfter?: boolean
  },
): Promise<void> {
  if (nextAccounts.length === 0) {
    throw new Error('installAccounts requires at least one account')
  }
  await wipeKeys('destroy')
  await clearAllRoamingSyncData()
  const active = nextAccounts[0]!
  await vault.create(options.password, {
    accounts: nextAccounts,
    activeAccountId: active.id,
  })
  vault.setAutoLockTimeout(options.autoLockMs)
  await browser.storage.local.set({ autoLockMs: options.autoLockMs })
  await writeLocalAccounts({
    accounts: nextAccounts.map((account) => toLocalAccountEntry(account)),
    activeAccountId: active.id,
    markPersisted: true,
  })
  for (const account of nextAccounts) {
    await persistBindingIndex(account)
  }
  if (options.lockAfter) vault.lock()
}

async function applyFirstRun(): Promise<void> {
  await wipeKeys('destroy')
  await removeOperatorLifecycle()
  await clearAllRoamingSyncData()
  await browser.storage.local.set({ [APP_MODE_STORAGE_KEY]: DEFAULT_APP_MODE })
}

async function applyAfterDelete(): Promise<void> {
  await wipeKeys('lastKeyDelete')
  await clearAllRoamingSyncData()
  await browser.storage.local.set({ [APP_MODE_STORAGE_KEY]: DEFAULT_APP_MODE })
  const hint = await accounts.createFromMnemonic(
    ADMIN_TEST_MNEMONIC,
    'Deleted test key',
  )
  await markEasyBlobDeletedForTwitterId(ADMIN_DELETED_TOMBSTONE_TWITTER_ID, {
    pubkeyHint: hint.pubkey,
  })
}

async function applyOneKey(input: {
  bindTwitterId?: string | null
  bound: boolean
}): Promise<void> {
  const raw = await accounts.createFromMnemonic(
    ADMIN_TEST_MNEMONIC,
    'Test key',
  )
  const account = input.bound ? withBinding(raw, input.bindTwitterId) : raw
  await installAccounts([account], {
    password: '',
    autoLockMs: 0,
  })
}

async function applyLockedVault(): Promise<void> {
  const account = await accounts.createFromMnemonic(
    ADMIN_TEST_MNEMONIC,
    'Test key',
  )
  await installAccounts([account], {
    password: ADMIN_TEST_VAULT_PASSWORD,
    autoLockMs: DEFAULT_AUTO_LOCK_MS,
    lockAfter: true,
  })
}

async function applyTwoKeys(bindTwitterId?: string | null): Promise<void> {
  const main = withBinding(
    await accounts.createFromMnemonic(ADMIN_TEST_MNEMONIC, 'Test key'),
    bindTwitterId,
  )
  const second = await accounts.createFromMnemonicAtIndex(
    ADMIN_TEST_MNEMONIC,
    1,
    'Test key 2',
  )
  await installAccounts([main, second], {
    password: '',
    autoLockMs: 0,
  })
}

export async function applyKeyScenario(
  id: KeyScenarioId,
  ctx: ApplyKeyScenarioContext = {},
): Promise<KeyScenarioStatus> {
  switch (id) {
    case 'firstRun':
      await applyFirstRun()
      break
    case 'afterDelete':
      await applyAfterDelete()
      break
    case 'oneKeyBound':
      await applyOneKey({ bindTwitterId: ctx.bindTwitterId, bound: true })
      break
    case 'oneKeyUnbound':
      await applyOneKey({ bound: false })
      break
    case 'lockedVault':
      await applyLockedVault()
      break
    case 'twoKeys':
      await applyTwoKeys(ctx.bindTwitterId)
      break
    default: {
      const _exhaustive: never = id
      throw new Error(`Unknown key scenario: ${String(_exhaustive)}`)
    }
  }
  return readKeyScenarioStatus()
}

export async function readKeyScenarioStatus(): Promise<KeyScenarioStatus> {
  const { accounts, activeAccountId } = await readLocalAccounts()
  const lifecycle = derivePanelLifecycle(
    await loadOperatorLifecycle(),
    accounts.length,
  )
  const vaultExists = await vault.exists()
  const vaultLocked = vaultExists && vault.isLocked()
  const autoLock = (await browser.storage.local.get(['autoLockMs'])) as {
    autoLockMs?: number
  }
  const boundTwitterIds = [
    ...new Set(
      accounts.flatMap((account) =>
        Array.isArray(account.boundTwitterIds)
          ? account.boundTwitterIds
          : account.boundTwitterId
            ? [account.boundTwitterId]
            : [],
      ),
    ),
  ]
  return {
    lifecycle,
    accountCount: accounts.length,
    vaultExists,
    vaultLocked,
    neverLock: autoLock.autoLockMs === 0,
    boundTwitterIds,
    activeAccountId,
  }
}
