/**
 * Local 1↔1 operator binding between vault Nostr accounts and X twitterIds.
 *
 * Separate from NIP-39 / xIdentities (protocol proof). This module only
 * manages vault + chrome.storage.local metadata and Sync binding index rules.
 *
 * @module accounts/x-binding
 */

export const MAX_BOUND_X_ACCOUNTS = 10

export type XBindingConflict =
  | 'none'
  | 'account-already-bound'
  | 'twitter-already-bound'
  | 'at-cap'
  | 'account-missing'
  | 'invalid-twitter-id'

export interface BoundAccountView {
  id: string
  pubkey: string
  boundTwitterId: string | null
  boundUpdatedAt: number | null
  readOnly: boolean
}

export function isDigitsTwitterId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]+$/.test(value)
}

export function normalizeBoundTwitterId(
  value: string | null | undefined,
): string | null {
  if (value == null || value === '') return null
  const trimmed = String(value).trim()
  return isDigitsTwitterId(trimmed) ? trimmed : null
}

export function countBoundAccounts(
  accounts: ReadonlyArray<Pick<BoundAccountView, 'boundTwitterId'>>,
): number {
  let n = 0
  for (const a of accounts) {
    if (normalizeBoundTwitterId(a.boundTwitterId)) n += 1
  }
  return n
}

export function findAccountByBoundTwitterId<T extends BoundAccountView>(
  accounts: ReadonlyArray<T>,
  twitterId: string,
): T | undefined {
  const id = normalizeBoundTwitterId(twitterId)
  if (!id) return undefined
  return accounts.find((a) => normalizeBoundTwitterId(a.boundTwitterId) === id)
}

export function findAccountByPubkey<T extends BoundAccountView>(
  accounts: ReadonlyArray<T>,
  pubkey: string,
): T | undefined {
  const needle = pubkey.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(needle)) return undefined
  return accounts.find((a) => a.pubkey.toLowerCase() === needle)
}

/** Writable local account that is not already bound to an X user. */
export function isBindableNostrAccount(account: {
  boundTwitterId?: string | null
  readOnly?: boolean
  type?: string
}): boolean {
  if (account.readOnly) return false
  if (account.type === 'npub') return false
  return normalizeBoundTwitterId(account.boundTwitterId) == null
}

/** First unbound writable Nostr account in list order. */
export function firstBindableNostrAccount<
  T extends {
    boundTwitterId?: string | null
    readOnly?: boolean
    type?: string
  },
>(accounts: ReadonlyArray<T>): T | undefined {
  return accounts.find((account) => isBindableNostrAccount(account))
}

/**
 * Validate whether `accountId` may be bound to `twitterId`.
 * Does not mutate. Callers apply the change after confirmations.
 */
export function canBindAccountToX(
  accounts: ReadonlyArray<BoundAccountView>,
  accountId: string,
  twitterId: string,
): { ok: true } | { ok: false; conflict: XBindingConflict; message: string } {
  const tid = normalizeBoundTwitterId(twitterId)
  if (!tid) {
    return {
      ok: false,
      conflict: 'invalid-twitter-id',
      message: 'X binding requires a numeric twitterId',
    }
  }
  const account = accounts.find((a) => a.id === accountId)
  if (!account) {
    return {
      ok: false,
      conflict: 'account-missing',
      message: 'Account not found',
    }
  }
  const existingOnAccount = normalizeBoundTwitterId(account.boundTwitterId)
  if (existingOnAccount && existingOnAccount !== tid) {
    return {
      ok: false,
      conflict: 'account-already-bound',
      message:
        'This Nostr account is already bound to another X user. Unbind it in Security first.',
    }
  }
  if (existingOnAccount === tid) {
    return { ok: true }
  }
  const other = findAccountByBoundTwitterId(accounts, tid)
  if (other && other.id !== accountId) {
    return {
      ok: false,
      conflict: 'twitter-already-bound',
      message:
        'This X account is already bound to another Nostr identity. Unbind it in Security first.',
    }
  }
  if (
    !existingOnAccount &&
    countBoundAccounts(accounts) >= MAX_BOUND_X_ACCOUNTS
  ) {
    return {
      ok: false,
      conflict: 'at-cap',
      message: `At most ${MAX_BOUND_X_ACCOUNTS} X-bound Nostr accounts are allowed. Unbind an unused binding in Security first.`,
    }
  }
  return { ok: true }
}

/**
 * Merge Sync binding map with local accounts.
 * Latest updatedAt wins; tie-break: lexicographically larger pubkey, then twitterId.
 * Never invents or deletes vault accounts — only repoints boundTwitterId on matches.
 */
export function mergeBindingsLatestWins(input: {
  local: BoundAccountView[]
  syncByTwitterId: Record<string, { pubkey: string; updatedAt: number }>
  now?: number
}): {
  accounts: BoundAccountView[]
  changed: boolean
  syncByTwitterId: Record<string, { pubkey: string; updatedAt: number }>
} {
  const now = input.now ?? Date.now()
  const accounts = input.local.map((a) => ({
    ...a,
    boundTwitterId: normalizeBoundTwitterId(a.boundTwitterId),
    boundUpdatedAt:
      typeof a.boundUpdatedAt === 'number' && Number.isFinite(a.boundUpdatedAt)
        ? a.boundUpdatedAt
        : null,
  }))

  type Candidate = {
    twitterId: string
    pubkey: string
    updatedAt: number
    source: 'local' | 'sync'
  }
  const byTwitter = new Map<string, Candidate>()
  const byPubkey = new Map<string, Candidate>()

  function consider(c: Candidate): void {
    const tid = normalizeBoundTwitterId(c.twitterId)
    if (!tid || !/^[0-9a-f]{64}$/i.test(c.pubkey)) return
    const pubkey = c.pubkey.toLowerCase()
    const next: Candidate = { ...c, twitterId: tid, pubkey }

    const prevT = byTwitter.get(tid)
    if (!prevT || newerWins(next, prevT)) {
      if (prevT) byPubkey.delete(prevT.pubkey)
      byTwitter.set(tid, next)
      const prevP = byPubkey.get(pubkey)
      if (prevP && prevP.twitterId !== tid) {
        byTwitter.delete(prevP.twitterId)
      }
      byPubkey.set(pubkey, next)
      return
    }
    // Existing twitter winner stays; if this pubkey had a different twitter, skip
  }

  function newerWins(a: Candidate, b: Candidate): boolean {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt
    if (a.pubkey !== b.pubkey) return a.pubkey > b.pubkey
    return a.twitterId > b.twitterId
  }

  for (const a of accounts) {
    const tid = normalizeBoundTwitterId(a.boundTwitterId)
    if (!tid) continue
    consider({
      twitterId: tid,
      pubkey: a.pubkey,
      updatedAt: a.boundUpdatedAt ?? 0,
      source: 'local',
    })
  }
  for (const [twitterId, entry] of Object.entries(input.syncByTwitterId)) {
    if (!entry || typeof entry.pubkey !== 'string') continue
    consider({
      twitterId,
      pubkey: entry.pubkey,
      updatedAt:
        typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
          ? entry.updatedAt
          : 0,
      source: 'sync',
    })
  }

  // Rebuild uniqueness: one pubkey → one twitter (already enforced in consider)
  let changed = false
  const nextAccounts = accounts.map((a) => {
    const pubkey = a.pubkey.toLowerCase()
    const win = byPubkey.get(pubkey)
    if (!win) {
      if (a.boundTwitterId != null) {
        changed = true
        return { ...a, boundTwitterId: null, boundUpdatedAt: null }
      }
      return a
    }
    if (
      a.boundTwitterId !== win.twitterId ||
      a.boundUpdatedAt !== win.updatedAt
    ) {
      // Only apply if local account exists (always true here)
      changed = true
      return {
        ...a,
        boundTwitterId: win.twitterId,
        boundUpdatedAt: win.updatedAt || now,
      }
    }
    return a
  })

  // Cap: if more than MAX after merge, keep newest MAX by updatedAt
  const bound = nextAccounts
    .filter((a) => normalizeBoundTwitterId(a.boundTwitterId))
    .sort(
      (a, b) =>
        (b.boundUpdatedAt ?? 0) - (a.boundUpdatedAt ?? 0) ||
        a.pubkey.localeCompare(b.pubkey),
    )
  if (bound.length > MAX_BOUND_X_ACCOUNTS) {
    const drop = new Set(
      bound.slice(MAX_BOUND_X_ACCOUNTS).map((a) => a.id),
    )
    for (let i = 0; i < nextAccounts.length; i++) {
      if (drop.has(nextAccounts[i].id)) {
        nextAccounts[i] = {
          ...nextAccounts[i],
          boundTwitterId: null,
          boundUpdatedAt: null,
        }
        changed = true
      }
    }
  }

  const syncByTwitterId: Record<string, { pubkey: string; updatedAt: number }> =
    {}
  for (const a of nextAccounts) {
    const tid = normalizeBoundTwitterId(a.boundTwitterId)
    if (!tid) continue
    syncByTwitterId[tid] = {
      pubkey: a.pubkey.toLowerCase(),
      updatedAt: a.boundUpdatedAt ?? now,
    }
  }

  return { accounts: nextAccounts, changed, syncByTwitterId }
}
