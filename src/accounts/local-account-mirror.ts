/**
 * Mirror vault public account metadata into chrome.storage.local.accounts
 * and keep operator lifecycle in the same write when accounts appear or vanish.
 *
 * @module accounts/local-account-mirror
 */

import browser from '../vault/browser.ts'
import type { LocalAccountEntry } from '../lib/nostr/nip07/bg/state.ts'
import type { Account } from '../vault/types.ts'
import { sortAccountsByGeneration } from './account-order.ts'
import {
  boundTwitterIdsOf,
  normalizeBoundTwitterId,
  primaryBoundTwitterId,
  toBoundAccountView,
  type BoundAccountView,
} from './x-binding.ts'
import {
  OPERATOR_LIFECYCLE_KEY,
  nextLifecycleOnClear,
  nextLifecycleOnPersist,
  operatorLifecycleFromUnknown,
  type OperatorLifecycleReason,
  type OperatorLifecycleRecord,
} from '../shared/operator-lifecycle.ts'
import { WIZARD_SESSION_KEY } from '../shared/panel-session.ts'

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
  > & {
    type?: string
    createdAt?: number
    derivationIndex?: number
  },
): LocalAccountEntry {
  const boundTwitterIds = boundTwitterIdsOf(account)
  const boundTwitterId = primaryBoundTwitterId(account)
  return {
    id: account.id,
    name: account.name || 'Account',
    pubkey: account.pubkey,
    type: account.type || 'generated',
    readOnly: account.readOnly ?? !account.privkey,
    ...(typeof account.createdAt === 'number' && Number.isFinite(account.createdAt)
      ? { createdAt: account.createdAt }
      : {}),
    ...(typeof account.derivationIndex === 'number' &&
    Number.isFinite(account.derivationIndex)
      ? { derivationIndex: account.derivationIndex }
      : {}),
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

export async function readLocalAccounts(): Promise<{
  accounts: LocalAccountEntry[]
  activeAccountId: string | null
}> {
  const data = (await browser.storage.local.get([
    'accounts',
    'activeAccountId',
  ])) as {
    accounts?: LocalAccountEntry[]
    activeAccountId?: string | null
  }
  return {
    accounts: sortAccountsByGeneration(
      Array.isArray(data.accounts) ? data.accounts : [],
    ),
    activeAccountId:
      typeof data.activeAccountId === 'string' ? data.activeAccountId : null,
  }
}

export function listLocalBoundAccountViews(
  accounts: ReadonlyArray<LocalAccountEntry>,
): BoundAccountView[] {
  return accounts.map((account) => toBoundAccountView(account))
}

export async function loadOperatorLifecycle(): Promise<OperatorLifecycleRecord | null> {
  const data = (await browser.storage.local.get(OPERATOR_LIFECYCLE_KEY)) as Record<
    string,
    unknown
  >
  return operatorLifecycleFromUnknown(data[OPERATOR_LIFECYCLE_KEY])
}

export async function writeLocalAccounts(input: {
  accounts: LocalAccountEntry[]
  activeAccountId: string | null
  markPersisted?: boolean
}): Promise<void> {
  const payload: Record<string, unknown> = {
    accounts: sortAccountsByGeneration(input.accounts),
    activeAccountId: input.activeAccountId,
  }
  if (input.markPersisted && input.accounts.length > 0) {
    const previous = await loadOperatorLifecycle()
    payload[OPERATOR_LIFECYCLE_KEY] = nextLifecycleOnPersist(
      previous,
      Date.now(),
    )
  }
  await browser.storage.local.set(payload)
}

export async function upsertLocalAccountEntry(
  entry: LocalAccountEntry,
  options?: { activeAccountId?: string | null },
): Promise<LocalAccountEntry[]> {
  const { accounts, activeAccountId } = await readLocalAccounts()
  const accts = [...accounts]
  const idx = accts.findIndex((a) => a.id === entry.id)
  if (idx >= 0) accts[idx] = { ...accts[idx], ...entry }
  else accts.push(entry)
  const nextActive =
    options && 'activeAccountId' in options
      ? (options.activeAccountId ?? null)
      : activeAccountId
  await writeLocalAccounts({
    accounts: accts,
    activeAccountId: nextActive,
    markPersisted: true,
  })
  return accts
}

export async function patchLocalAccountBinding(
  accountId: string,
  boundTwitterId: string | null,
  boundUpdatedAt: number | null,
  options?: { boundTwitterIds?: string[]; removeTwitterId?: string },
): Promise<void> {
  const { accounts, activeAccountId } = await readLocalAccounts()
  const accts = [...accounts]
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
  await writeLocalAccounts({ accounts: accts, activeAccountId })
}

export async function clearLocalAccounts(input: {
  reason: Exclude<OperatorLifecycleReason, 'accountPersisted'>
  extraRemove?: string[]
}): Promise<void> {
  const previous = await loadOperatorLifecycle()
  const next = nextLifecycleOnClear(previous, Date.now(), input.reason)
  const extra = input.extraRemove ?? []
  await browser.storage.local.remove([
    'accounts',
    'activeAccountId',
    ...extra,
  ])
  await browser.storage.local.set({ [OPERATOR_LIFECYCLE_KEY]: next })
  try {
    await browser.storage.session.remove(WIZARD_SESSION_KEY)
  } catch {
    /* session unavailable */
  }
}

export async function removeOperatorLifecycle(): Promise<void> {
  await browser.storage.local.remove(OPERATOR_LIFECYCLE_KEY)
}

export async function isRestoreSuppressed(): Promise<boolean> {
  const record = await loadOperatorLifecycle()
  return record?.restoreSuppressed === true
}
