/**
 * Mirror vault public account metadata into chrome.storage.local.accounts.
 *
 * @module accounts/local-account-mirror
 */

import browser from '../vault/browser.ts'
import type { LocalAccountEntry } from '../nip07/bg/state.ts'
import type { Account } from '../vault/types.ts'
import { normalizeBoundTwitterId } from './x-binding.ts'

export function toLocalAccountEntry(
  account: Pick<
    Account,
    | 'id'
    | 'name'
    | 'pubkey'
    | 'type'
    | 'readOnly'
    | 'privkey'
    | 'boundTwitterId'
    | 'boundUpdatedAt'
  > & { type?: string },
): LocalAccountEntry {
  const boundTwitterId = normalizeBoundTwitterId(account.boundTwitterId)
  return {
    id: account.id,
    name: account.name || 'Account',
    pubkey: account.pubkey,
    type: account.type || 'generated',
    readOnly: account.readOnly ?? !account.privkey,
    boundTwitterId,
    boundUpdatedAt:
      boundTwitterId &&
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
): Promise<void> {
  const data = (await browser.storage.local.get(['accounts'])) as {
    accounts?: LocalAccountEntry[]
  }
  const accts = [...(data.accounts || [])]
  const idx = accts.findIndex((a) => a.id === accountId)
  if (idx < 0) return
  accts[idx] = {
    ...accts[idx],
    boundTwitterId: normalizeBoundTwitterId(boundTwitterId),
    boundUpdatedAt: normalizeBoundTwitterId(boundTwitterId)
      ? boundUpdatedAt
      : null,
  }
  await browser.storage.local.set({ accounts: accts })
}
