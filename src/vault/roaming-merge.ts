/**
 * Merge / restore X-bound roaming Sync blobs into the local vault.
 *
 * @module vault/roaming-merge
 */

import browser from './browser.ts'
import * as vault from './vault.ts'
import {
  getBrowserKeyRoaming,
} from './browser-key-roaming.ts'
import {
  readEasyBlobsMap,
  restoreAccountFromEasyBlob,
  type EasyAccountBlobV2,
} from './easy-roaming.ts'
import {
  mergeLocalWithSyncBindings,
  readXNostrBindings,
  writeXNostrBindings,
} from './x-nostr-bindings-sync.ts'
import {
  findAccountByBoundTwitterId,
  findAccountByPubkey,
  normalizeBoundTwitterId,
  boundTwitterIdsOf,
  toBoundAccountView,
  type BoundAccountView,
} from '../accounts/x-binding.ts'
import type { Account } from './types.ts'
import { patchLocalAccountBinding } from '../accounts/local-account-mirror.ts'

async function isChromeProfileSignedIn(): Promise<boolean> {
  try {
    const identity = browser.identity as
      | {
          getProfileUserInfo?: (
            details?: { accountStatus?: string },
          ) => Promise<{ id?: string; email?: string }>
        }
      | undefined
    if (!identity?.getProfileUserInfo) return false
    let info: { id?: string; email?: string }
    try {
      info = await identity.getProfileUserInfo({ accountStatus: 'ANY' })
    } catch {
      info = await identity.getProfileUserInfo()
    }
    return (
      (typeof info?.id === 'string' && info.id.length > 0) ||
      (typeof info?.email === 'string' && info.email.length > 0)
    )
  } catch {
    return false
  }
}

/**
 * Apply deleted Sync markers: silently remove matching local X-bound accounts.
 * Restore missing non-deleted blobs into an unlocked never-lock vault, or create
 * the vault when none exists.
 */
export async function mergeRoamingSyncIntoLocal(): Promise<{
  restored: number
  removed: number
}> {
  if (!(await getBrowserKeyRoaming())) {
    return { restored: 0, removed: 0 }
  }
  if (!(await isChromeProfileSignedIn())) {
    return { restored: 0, removed: 0 }
  }

  const map = await readEasyBlobsMap()
  const entries = Object.values(map.byTwitterId)
  if (entries.length === 0) return { restored: 0, removed: 0 }

  let removed = 0
  let restored = 0

  const hasLocal = await vault.hasUsableAccounts()

  if (!hasLocal) {
    const live = entries.filter((e) => !e.deleted && e.ncryptsec)
    if (live.length === 0) return { restored: 0, removed: 0 }
    if (await vault.exists()) await vault.destroy()

    const byPubkey = new Map<string, Account>()
    for (const blob of live) {
      try {
        const acct = await restoreAccountFromEasyBlob(blob)
        const existing = byPubkey.get(acct.pubkey.toLowerCase())
        if (!existing) {
          byPubkey.set(acct.pubkey.toLowerCase(), acct)
          continue
        }
        const ids = new Set(boundTwitterIdsOf(existing))
        for (const id of boundTwitterIdsOf(acct)) ids.add(id)
        existing.boundTwitterIds = [...ids]
        existing.boundTwitterId = acct.boundTwitterId ?? existing.boundTwitterId
        existing.boundUpdatedAt =
          acct.boundUpdatedAt ?? existing.boundUpdatedAt
        existing.xBindingMeta = {
          ...(existing.xBindingMeta ?? {}),
          ...(acct.xBindingMeta ?? {}),
        }
      } catch {
        /* skip bad blob */
      }
    }
    const accounts = [...byPubkey.values()]
    if (accounts.length === 0) return { restored: 0, removed: 0 }

    const active = accounts[0]
    await vault.create('', { accounts, activeAccountId: active.id })
    vault.setAutoLockTimeout(0)
    await browser.storage.local.set({
      autoLockMs: 0,
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        pubkey: a.pubkey,
        type: a.type,
        readOnly: false,
        boundTwitterIds: boundTwitterIdsOf(a),
        boundTwitterId: a.boundTwitterId ?? null,
        boundUpdatedAt: a.boundUpdatedAt ?? null,
      })),
      activeAccountId: active.id,
    })
    return { restored: accounts.length, removed: 0 }
  }

  if (vault.isLocked()) {
    // Only merge when unlocked (never-lock auto-unlock runs first on SW start).
    return { restored: 0, removed: 0 }
  }

  // Silent unbind (or remove) for tombstones — per X, not per vault account.
  for (const blob of entries) {
    if (!blob.deleted) continue
    const tid = normalizeBoundTwitterId(blob.boundTwitterId)
    if (!tid) continue
    const views = vault.listAccounts().map((a) => toBoundAccountView(a))
    const local = findAccountByBoundTwitterId(views, tid)
    if (!local) continue
    const remaining = boundTwitterIdsOf(local).filter((id) => id !== tid)
    if (remaining.length > 0) {
      await vault.setAccountXBinding(local.id, null, null, {
        removeTwitterId: tid,
      })
      await patchLocalAccountBinding(local.id, null, local.boundUpdatedAt, {
        boundTwitterIds: remaining,
        removeTwitterId: tid,
      })
      continue
    }
    await vault.removeAccount(local.id)
    removed += 1
    const localData = (await browser.storage.local.get(['accounts'])) as {
      accounts?: Array<{ id: string }>
    }
    const next = (localData.accounts || []).filter((a) => a.id !== local.id)
    await browser.storage.local.set({ accounts: next })
  }

  // Add missing live blobs — or attach the twitterId onto an existing pubkey.
  const viewsAfter = vault.listAccounts().map((a) => toBoundAccountView(a))
  for (const blob of entries) {
    if (blob.deleted || !blob.ncryptsec) continue
    const tid = normalizeBoundTwitterId(blob.boundTwitterId)
    if (!tid) continue
    if (findAccountByBoundTwitterId(viewsAfter, tid)) continue
    const existing = findAccountByPubkey(
      viewsAfter,
      blob.pubkeyHint.toLowerCase(),
    )
    if (existing) {
      const now =
        blob.version === 2 ? blob.boundUpdatedAt : blob.updatedAt
      await vault.setAccountXBinding(existing.id, tid, now)
      await patchLocalAccountBinding(existing.id, tid, now, {
        boundTwitterIds: [...boundTwitterIdsOf(existing), tid],
      })
      existing.boundTwitterIds = [...boundTwitterIdsOf(existing), tid]
      existing.boundTwitterId = tid
      existing.boundUpdatedAt = now
      continue
    }
    try {
      const acct = await restoreAccountFromEasyBlob(blob)
      await vault.addAccount(acct)
      restored += 1
      const localData = (await browser.storage.local.get(['accounts'])) as {
        accounts?: unknown[]
      }
      const list = localData.accounts || []
      list.push({
        id: acct.id,
        name: acct.name,
        pubkey: acct.pubkey,
        type: acct.type,
        readOnly: false,
        boundTwitterIds: boundTwitterIdsOf(acct),
        boundTwitterId: acct.boundTwitterId ?? null,
        boundUpdatedAt: acct.boundUpdatedAt ?? null,
      })
      await browser.storage.local.set({ accounts: list })
      viewsAfter.push(toBoundAccountView(acct))
    } catch {
      /* skip */
    }
  }

  // Binding index merge
  try {
    const sync = await readXNostrBindings()
    const merged = mergeLocalWithSyncBindings(
      vault.listAccounts() as BoundAccountView[],
      sync,
    )
    if (merged.changed) {
      await writeXNostrBindings({ version: 1, byTwitterId: merged.syncByTwitterId })
    }
  } catch {
    /* ignore */
  }

  return { restored, removed }
}

export type { EasyAccountBlobV2 }
