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

const NPUB_PATTERN = /^npub1[023456789ac-hj-np-z]{10,100}$/

export interface XNostrBindingEntry {
  pubkey: string
  updatedAt: number
  /** Epoch ms — X bio known to contain this npub (no further bio probes). */
  bioUpdatedAt?: number
  /** Other single npub observed in X bio (suggest-strip warning). */
  bioMismatchNpub?: string
  /** Epoch ms — kind 10011 binding published for this pair. */
  publishedBindingAt?: number
}

export interface XNostrBindingsSync {
  version: 1
  byTwitterId: Record<string, XNostrBindingEntry>
}

function isBindingEntry(value: unknown): value is XNostrBindingEntry {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v.pubkey !== 'string' || typeof v.updatedAt !== 'number') {
    return false
  }
  if (
    v.bioUpdatedAt !== undefined &&
    (typeof v.bioUpdatedAt !== 'number' || !Number.isFinite(v.bioUpdatedAt))
  ) {
    return false
  }
  if (
    v.publishedBindingAt !== undefined &&
    (typeof v.publishedBindingAt !== 'number' ||
      !Number.isFinite(v.publishedBindingAt))
  ) {
    return false
  }
  if (v.bioMismatchNpub !== undefined) {
    if (
      typeof v.bioMismatchNpub !== 'string' ||
      !NPUB_PATTERN.test(v.bioMismatchNpub.trim().toLowerCase())
    ) {
      return false
    }
  }
  return true
}

function isXNostrBindingsSync(value: unknown): value is XNostrBindingsSync {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v.version !== 1 || !v.byTwitterId || typeof v.byTwitterId !== 'object') {
    return false
  }
  for (const entry of Object.values(v.byTwitterId as Record<string, unknown>)) {
    if (!isBindingEntry(entry)) return false
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

function applyOptionalTimestamp(
  next: XNostrBindingEntry,
  key: 'bioUpdatedAt' | 'publishedBindingAt',
  value: number | null | undefined,
  previous: number | undefined,
): void {
  const resolved =
    value === null ? undefined : value !== undefined ? value : previous
  if (typeof resolved === 'number') next[key] = resolved
}

/** Upsert one twitterId binding and persist Sync. Preserves setup timestamps. */
export async function upsertXNostrBinding(entry: {
  twitterId: string
  pubkey: string
  updatedAt: number
  bioUpdatedAt?: number | null
  bioMismatchNpub?: string | null
  publishedBindingAt?: number | null
}): Promise<void> {
  const current = await readXNostrBindings()
  const pubkey = entry.pubkey.toLowerCase()
  const previous = current.byTwitterId[entry.twitterId]
  const next: XNostrBindingEntry = {
    pubkey,
    updatedAt: entry.updatedAt,
  }
  applyOptionalTimestamp(next, 'bioUpdatedAt', entry.bioUpdatedAt, previous?.bioUpdatedAt)
  applyOptionalTimestamp(
    next,
    'publishedBindingAt',
    entry.publishedBindingAt,
    previous?.publishedBindingAt,
  )
  const mismatch =
    entry.bioMismatchNpub === null
      ? undefined
      : entry.bioMismatchNpub !== undefined
        ? entry.bioMismatchNpub.trim().toLowerCase()
        : previous?.bioMismatchNpub
  if (typeof mismatch === 'string' && NPUB_PATTERN.test(mismatch)) {
    next.bioMismatchNpub = mismatch
  }
  current.byTwitterId[entry.twitterId] = next
  await writeXNostrBindings(current)
}

/** Patch bio / published-binding setup flags for an existing Sync binding. */
export async function patchXNostrBindingSetup(entry: {
  twitterId: string
  pubkey: string
  bioUpdatedAt?: number | null
  bioMismatchNpub?: string | null
  publishedBindingAt?: number | null
}): Promise<void> {
  const current = await readXNostrBindings()
  const tid = entry.twitterId
  const existing = current.byTwitterId[tid]
  const pubkey = entry.pubkey.toLowerCase()
  if (existing && existing.pubkey.toLowerCase() !== pubkey) {
    return
  }
  const now = Date.now()
  const next: XNostrBindingEntry = {
    pubkey,
    updatedAt: existing?.updatedAt ?? now,
  }

  if (entry.bioUpdatedAt === null) {
    // cleared
  } else if (typeof entry.bioUpdatedAt === 'number') {
    next.bioUpdatedAt = entry.bioUpdatedAt
  } else if (typeof existing?.bioUpdatedAt === 'number') {
    next.bioUpdatedAt = existing.bioUpdatedAt
  }

  if (entry.publishedBindingAt === null) {
    // cleared
  } else if (typeof entry.publishedBindingAt === 'number') {
    next.publishedBindingAt = entry.publishedBindingAt
  } else if (typeof existing?.publishedBindingAt === 'number') {
    next.publishedBindingAt = existing.publishedBindingAt
  }

  if (entry.bioMismatchNpub === null) {
    // cleared
  } else if (typeof entry.bioMismatchNpub === 'string') {
    const m = entry.bioMismatchNpub.trim().toLowerCase()
    if (NPUB_PATTERN.test(m)) next.bioMismatchNpub = m
  } else if (typeof existing?.bioMismatchNpub === 'string') {
    next.bioMismatchNpub = existing.bioMismatchNpub
  }

  current.byTwitterId[tid] = next
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
