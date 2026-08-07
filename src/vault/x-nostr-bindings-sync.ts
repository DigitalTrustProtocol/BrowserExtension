/**
 * Non-secret Sync index of X twitterId ↔ Nostr pubkey bindings.
 *
 * @module vault/x-nostr-bindings-sync
 */

import browser from './browser.ts'
import {
  MAX_BOUND_X_ACCOUNTS,
  mergeBindingsLatestWins,
  type BoundAccountView,
} from '../accounts/x-binding.ts'

export const X_NOSTR_BINDINGS_KEY = 'xNostrBindings'

export interface XNostrBindingsSync {
  version: 1
  byTwitterId: Record<string, { pubkey: string; updatedAt: number }>
}

function isXNostrBindingsSync(value: unknown): value is XNostrBindingsSync {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v.version !== 1 || !v.byTwitterId || typeof v.byTwitterId !== 'object') {
    return false
  }
  return true
}

export async function readXNostrBindings(): Promise<XNostrBindingsSync> {
  const data = (await browser.storage.sync.get(X_NOSTR_BINDINGS_KEY)) as Record<
    string,
    unknown
  >
  const raw = data[X_NOSTR_BINDINGS_KEY]
  if (isXNostrBindingsSync(raw)) return raw
  return { version: 1, byTwitterId: {} }
}

export async function writeXNostrBindings(
  bindings: XNostrBindingsSync,
): Promise<void> {
  if (!isXNostrBindingsSync(bindings)) {
    throw new Error('Invalid xNostrBindings')
  }
  const keys = Object.keys(bindings.byTwitterId)
  if (keys.length > MAX_BOUND_X_ACCOUNTS) {
    throw new Error(
      `xNostrBindings exceeds cap of ${MAX_BOUND_X_ACCOUNTS} entries`,
    )
  }
  await browser.storage.sync.set({ [X_NOSTR_BINDINGS_KEY]: bindings })
}

/** Upsert one twitterId binding and persist Sync. */
export async function upsertXNostrBinding(entry: {
  twitterId: string
  pubkey: string
  updatedAt: number
}): Promise<void> {
  const current = await readXNostrBindings()
  // Drop any other twitterId pointing at same pubkey
  const pubkey = entry.pubkey.toLowerCase()
  for (const [tid, row] of Object.entries(current.byTwitterId)) {
    if (row.pubkey.toLowerCase() === pubkey && tid !== entry.twitterId) {
      delete current.byTwitterId[tid]
    }
  }
  current.byTwitterId[entry.twitterId] = {
    pubkey,
    updatedAt: entry.updatedAt,
  }
  await writeXNostrBindings(current)
}

export async function removeXNostrBinding(twitterId: string): Promise<void> {
  const current = await readXNostrBindings()
  if (!(twitterId in current.byTwitterId)) return
  delete current.byTwitterId[twitterId]
  await writeXNostrBindings(current)
}

/**
 * Merge Sync map with local bound views; returns merged local views + sync map.
 */
export function mergeLocalWithSyncBindings(
  local: BoundAccountView[],
  sync: XNostrBindingsSync,
  now = Date.now(),
): ReturnType<typeof mergeBindingsLatestWins> {
  return mergeBindingsLatestWins({
    local,
    syncByTwitterId: sync.byTwitterId,
    now,
  })
}
