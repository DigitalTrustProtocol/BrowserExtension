/**
 * Mirror vault public account metadata into chrome.storage.local.accounts.
 *
 * @module accounts/local-account-mirror
 */

import browser from '../vault/browser.ts'
import type { LocalAccountEntry } from '../nip07/bg/state.ts'
import type { Account } from '../vault/types.ts'
import {
  boundTwitterIdsOf,
  normalizeBoundTwitterId,
  primaryBoundTwitterId,
} from './x-binding.ts'

export function toLocalAccountEntry(
  account: Pick<
    Account,
    | 'id'
    | 'name'
    | 'pubkey'
    | 'type'
    | 'readOnly'
    | 'privkey'
    | 'boundTwitterIds'
    | 'boundTwitterId'
    | 'boundUpdatedAt'
  > & { type?: string },
): LocalAccountEntry {
  const boundTwitterIds = boundTwitterIdsOf(account)
  const boundTwitterId = primaryBoundTwitterId(account)
  return {
    id: account.id,
    name: account.name || 'Account',
    pubkey: account.pubkey,
    type: account.type || 'generated',
    readOnly: account.readOnly ?? !account.privkey,
    boundTwitterIds,
    boundTwitterId,
    boundUpdatedAt:
      boundTwitterIds.length > 0 &&
      typeof account.boundUpdatedAt === 'number' &&
      Number.isFinite(account.boundUpdatedAt)
        ? account.boundUpdatedAt
        : null,
  }
}

export async function upsertLocalAccountEntry(
  entry: LocalAccountEntry,
): Promise<LocalAccountEntry[]> {
  const data = (await browser.storage.local.get(['accounts'])) as {
    accounts?: LocalAccountEntry[]
  }
  const accts = [...(data.accounts || [])]
  const idx = accts.findIndex((a) => a.id === entry.id)
  if (idx >= 0) accts[idx] = { ...accts[idx], ...entry }
  else accts.push(entry)
  await browser.storage.local.set({ accounts: accts })
  return accts
}

export async function patchLocalAccountBinding(
  accountId: string,
  boundTwitterId: string | null,
  boundUpdatedAt: number | null,
  options?: { boundTwitterIds?: string[]; removeTwitterId?: string },
): Promise<void> {
  const data = (await browser.storage.local.get(['accounts'])) as {
    accounts?: LocalAccountEntry[]
  }
  const accts = [...(data.accounts || [])]
  const idx = accts.findIndex((a) => a.id === accountId)
  if (idx < 0) return
  const current = accts[idx]
  let ids = options?.boundTwitterIds
    ? [...options.boundTwitterIds]
    : boundTwitterIdsOf(current)
  const addTid = normalizeBoundTwitterId(boundTwitterId)
  const removeTid = normalizeBoundTwitterId(options?.removeTwitterId)
  if (addTid && !ids.includes(addTid)) ids.push(addTid)
  if (removeTid) ids = ids.filter((id) => id !== removeTid)
  if (!addTid && !removeTid && !options?.boundTwitterIds) ids = []
  const primary = addTid ?? ids[0] ?? null
  accts[idx] = {
    ...current,
    boundTwitterIds: ids,
    boundTwitterId: primary,
    boundUpdatedAt: ids.length > 0 ? boundUpdatedAt : null,
  }
  await browser.storage.local.set({ accounts: accts })
}
