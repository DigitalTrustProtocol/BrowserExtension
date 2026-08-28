/**
 * Local operator binding between vault Nostr accounts and X twitterIds.
 *
 * Cardinality: 1 X → 1 Nostr (keep); 1 Nostr → N X (allowed).
 * Separate from NIP-39 / xIdentities (protocol proof). This module only
 * manages vault + chrome.storage.local metadata and Sync binding index rules.
 *
 * @module accounts/x-binding
 */

export const MAX_BOUND_X_ACCOUNTS = 10

export type XBindingConflict =
  | 'none'
  | 'twitter-already-bound'
  | 'at-cap'
  | 'account-missing'
  | 'invalid-twitter-id'

export interface BoundAccountView {
  id: string
  pubkey: string
  /** All X ids this Nostr account is bound to. Source of truth. */
  boundTwitterIds: string[]
  /** Last-touched X id (compat with older single-field readers). */
  boundTwitterId: string | null
  /** Last-touched binding time across the set. */
  boundUpdatedAt: number | null
  /** Per-X updatedAt when known; merge uses this over the account-level stamp. */
  boundUpdatedAtByTwitterId?: Record<string, number>
  readOnly: boolean
}

export type BindingAccountShape = {
  boundTwitterIds?: readonly string[] | null
  boundTwitterId?: string | null
  boundUpdatedAtByTwitterId?: Record<string, number> | null
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

/** Union of `boundTwitterIds` and legacy `boundTwitterId`. */
export function boundTwitterIdsOf(account: BindingAccountShape): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  const push = (raw: string | null | undefined) => {
    const id = normalizeBoundTwitterId(raw)
    if (!id || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  }
  if (Array.isArray(account.boundTwitterIds)) {
    for (const raw of account.boundTwitterIds) push(raw)
  }
  push(account.boundTwitterId)
  return ids
}

export function accountIsBoundTo(
  account: BindingAccountShape,
  twitterId: string,
): boolean {
  const tid = normalizeBoundTwitterId(twitterId)
  if (!tid) return false
  return boundTwitterIdsOf(account).includes(tid)
}

export function primaryBoundTwitterId(
  account: BindingAccountShape,
): string | null {
  const ids = boundTwitterIdsOf(account)
  return ids[0] ?? null
}

export function toBoundAccountView(
  account: {
    id: string
    pubkey: string
    readOnly?: boolean
    boundTwitterIds?: readonly string[] | null
    boundTwitterId?: string | null
    boundUpdatedAt?: number | null
    boundUpdatedAtByTwitterId?: Record<string, number> | null
    xBindingMeta?: Record<string, { boundUpdatedAt?: number | null }> | null
  },
): BoundAccountView {
  const boundTwitterIds = boundTwitterIdsOf(account)
  const byId: Record<string, number> = {}
  if (account.boundUpdatedAtByTwitterId) {
    for (const [tid, at] of Object.entries(account.boundUpdatedAtByTwitterId)) {
      const id = normalizeBoundTwitterId(tid)
      if (id && typeof at === 'number' && Number.isFinite(at)) byId[id] = at
    }
  }
  if (account.xBindingMeta) {
    for (const [tid, meta] of Object.entries(account.xBindingMeta)) {
      const id = normalizeBoundTwitterId(tid)
      const at = meta?.boundUpdatedAt
      if (id && typeof at === 'number' && Number.isFinite(at) && byId[id] == null) {
        byId[id] = at
      }
    }
  }
  const lastTouched =
    typeof account.boundUpdatedAt === 'number' &&
    Number.isFinite(account.boundUpdatedAt)
      ? account.boundUpdatedAt
      : null
  const primary =
    normalizeBoundTwitterId(account.boundTwitterId) ??
    boundTwitterIds[0] ??
    null
  return {
    id: account.id,
    pubkey: account.pubkey,
    boundTwitterIds,
    boundTwitterId: primary,
    boundUpdatedAt: lastTouched,
    ...(Object.keys(byId).length > 0 ? { boundUpdatedAtByTwitterId: byId } : {}),
    readOnly: account.readOnly === true,
  }
}

/** Distinct X twitterIds across all accounts (the cap unit). */
export function countBoundAccounts(
  accounts: ReadonlyArray<BindingAccountShape>,
): number {
  const seen = new Set<string>()
  for (const a of accounts) {
    for (const id of boundTwitterIdsOf(a)) seen.add(id)
  }
  return seen.size
}

/** Operator-known X ids: vault + Sync index + easy blobs + signed-in session. */
export function collectOperatorKnownTwitterIds(input: {
  vaultTwitterIds?: readonly string[]
  syncTwitterIds?: readonly string[]
  blobTwitterIds?: readonly string[]
  signedInTwitterId?: string | null
}): string[] {
  const seen = new Set<string>()
  const push = (raw: string | null | undefined) => {
    const id = normalizeBoundTwitterId(raw)
    if (id) seen.add(id)
  }
  for (const id of input.vaultTwitterIds ?? []) push(id)
  for (const id of input.syncTwitterIds ?? []) push(id)
  for (const id of input.blobTwitterIds ?? []) push(id)
  push(input.signedInTwitterId)
  return [...seen].sort((a, b) => a.localeCompare(b))
}

export function findAccountByBoundTwitterId<T extends BindingAccountShape>(
  accounts: ReadonlyArray<T>,
  twitterId: string,
): T | undefined {
  const id = normalizeBoundTwitterId(twitterId)
  if (!id) return undefined
  return accounts.find((a) => accountIsBoundTo(a, id))
}

export function findAccountByPubkey<T extends BoundAccountView>(
  accounts: ReadonlyArray<T>,
  pubkey: string,
): T | undefined {
  const needle = pubkey.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(needle)) return undefined
  return accounts.find((a) => a.pubkey.toLowerCase() === needle)
}

/** Writable local account that can be bound to an X user (including reuse). */
export function isWritableNostrAccount(account: {
  readOnly?: boolean
  type?: string
}): boolean {
  if (account.readOnly) return false
  if (account.type === 'npub') return false
  return true
}

export type NostrKeyKind = 'nsec' | 'readonly' | 'derivative' | 'nip46'

/** Vault key class shown on the Nostr Keys list. */
export function nostrKeyKind(account: {
  readOnly?: boolean
  type?: string
}): NostrKeyKind {
  if (account.type === 'nip46') return 'nip46'
  if (account.readOnly === true || account.type === 'npub') return 'readonly'
  if (account.type === 'generated') return 'derivative'
  return 'nsec'
}

/**
 * Writable local account that is not already bound to any X user.
 * Home-gate "spare key" path; reuse of an already-bound key is still allowed
 * via Bindings / bindAccountToX.
 */
export function isBindableNostrAccount(account: {
  boundTwitterIds?: readonly string[] | null
  boundTwitterId?: string | null
  readOnly?: boolean
  type?: string
}): boolean {
  if (!isWritableNostrAccount(account)) return false
  return boundTwitterIdsOf(account).length === 0
}

/** First unbound writable Nostr account in list order. */
export function firstBindableNostrAccount<
  T extends {
    boundTwitterIds?: readonly string[] | null
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
 * 1 Nostr → N X is allowed; 1 X → 1 Nostr is not (unless `reassign`).
 */
export function canBindAccountToX(
  accounts: ReadonlyArray<BoundAccountView>,
  accountId: string,
  twitterId: string,
  options?: { reassign?: boolean },
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
  if (accountIsBoundTo(account, tid)) {
    return { ok: true }
  }
  const other = findAccountByBoundTwitterId(accounts, tid)
  if (other && other.id !== accountId && !options?.reassign) {
    return {
      ok: false,
      conflict: 'twitter-already-bound',
      message:
        'This X account is already bound to another Nostr identity. Change it in Bindings first.',
    }
  }
  const alreadyKnown = Boolean(other)
  if (!alreadyKnown && countBoundAccounts(accounts) >= MAX_BOUND_X_ACCOUNTS) {
    return {
      ok: false,
      conflict: 'at-cap',
      message: `At most ${MAX_BOUND_X_ACCOUNTS} X bindings are allowed. Unbind an unused X user in Bindings first.`,
    }
  }
  return { ok: true }
}

/**
 * Merge Sync binding map with local accounts.
 * Per twitterId, latest updatedAt wins (then larger pubkey).
 * One pubkey may keep many twitterIds. Never invents or deletes vault accounts.
 */
export type SyncBindingMeta = {
  pubkey: string
  updatedAt: number
  bioUpdatedAt?: number
  bioMismatchNpub?: string
  publishedBindingAt?: number
}

export function mergeBindingsLatestWins(input: {
  local: BoundAccountView[]
  syncByTwitterId: Record<string, SyncBindingMeta>
  now?: number
}): {
  accounts: BoundAccountView[]
  changed: boolean
  syncByTwitterId: Record<string, SyncBindingMeta>
} {
  const now = input.now ?? Date.now()
  const accounts = input.local.map((a) => toBoundAccountView(a))

  type Candidate = {
    twitterId: string
    pubkey: string
    updatedAt: number
  }
  const byTwitter = new Map<string, Candidate>()

  function newerWins(a: Candidate, b: Candidate): boolean {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt
    if (a.pubkey !== b.pubkey) return a.pubkey > b.pubkey
    return a.twitterId > b.twitterId
  }

  function consider(c: Candidate): void {
    const tid = normalizeBoundTwitterId(c.twitterId)
    if (!tid || !/^[0-9a-f]{64}$/i.test(c.pubkey)) return
    const next: Candidate = {
      twitterId: tid,
      pubkey: c.pubkey.toLowerCase(),
      updatedAt: c.updatedAt,
    }
    const prev = byTwitter.get(tid)
    if (!prev || newerWins(next, prev)) byTwitter.set(tid, next)
  }

  for (const a of accounts) {
    for (const tid of a.boundTwitterIds) {
      const perId = a.boundUpdatedAtByTwitterId?.[tid]
      consider({
        twitterId: tid,
        pubkey: a.pubkey,
        updatedAt:
          typeof perId === 'number' && Number.isFinite(perId)
            ? perId
            : (a.boundUpdatedAt ?? 0),
      })
    }
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
    })
  }

  const ranked = [...byTwitter.values()].sort(
    (a, b) => b.updatedAt - a.updatedAt || a.pubkey.localeCompare(b.pubkey),
  )
  if (ranked.length > MAX_BOUND_X_ACCOUNTS) {
    for (const drop of ranked.slice(MAX_BOUND_X_ACCOUNTS)) {
      byTwitter.delete(drop.twitterId)
    }
  }

  const idsByPubkey = new Map<string, Candidate[]>()
  for (const c of byTwitter.values()) {
    const list = idsByPubkey.get(c.pubkey) ?? []
    list.push(c)
    idsByPubkey.set(c.pubkey, list)
  }

  let changed = false
  const nextAccounts = accounts.map((a) => {
    const pubkey = a.pubkey.toLowerCase()
    const wins = idsByPubkey.get(pubkey) ?? []
    const nextIds = wins.map((w) => w.twitterId).sort()
    const prevIds = [...a.boundTwitterIds].sort()
    const byId: Record<string, number> = {}
    let lastAt: number | null = null
    let lastTid: string | null = null
    for (const w of wins) {
      byId[w.twitterId] = w.updatedAt
      if (lastAt == null || w.updatedAt >= lastAt) {
        lastAt = w.updatedAt
        lastTid = w.twitterId
      }
    }
    const idsEqual =
      nextIds.length === prevIds.length &&
      nextIds.every((id, i) => id === prevIds[i])
    const primaryEqual = a.boundTwitterId === lastTid
    const atEqual = a.boundUpdatedAt === (lastAt ?? null)
    if (!idsEqual || !primaryEqual || !atEqual) changed = true
    return {
      ...a,
      boundTwitterIds: nextIds,
      boundTwitterId: lastTid,
      boundUpdatedAt: lastAt,
      ...(Object.keys(byId).length > 0
        ? { boundUpdatedAtByTwitterId: byId }
        : {}),
    }
  })

  const syncByTwitterId: Record<string, SyncBindingMeta> = {}
  for (const a of nextAccounts) {
    const pubkey = a.pubkey.toLowerCase()
    for (const tid of a.boundTwitterIds) {
      const previous = input.syncByTwitterId[tid]
      const updatedAt =
        a.boundUpdatedAtByTwitterId?.[tid] ?? a.boundUpdatedAt ?? now
      const next: SyncBindingMeta = { pubkey, updatedAt }
      if (
        previous &&
        previous.pubkey.toLowerCase() === pubkey &&
        typeof previous.bioUpdatedAt === 'number' &&
        Number.isFinite(previous.bioUpdatedAt)
      ) {
        next.bioUpdatedAt = previous.bioUpdatedAt
      }
      if (
        previous &&
        previous.pubkey.toLowerCase() === pubkey &&
        typeof previous.publishedBindingAt === 'number' &&
        Number.isFinite(previous.publishedBindingAt)
      ) {
        next.publishedBindingAt = previous.publishedBindingAt
      }
      if (
        previous &&
        previous.pubkey.toLowerCase() === pubkey &&
        typeof previous.bioMismatchNpub === 'string' &&
        previous.bioMismatchNpub.startsWith('npub1')
      ) {
        next.bioMismatchNpub = previous.bioMismatchNpub
      }
      syncByTwitterId[tid] = next
    }
  }

  return { accounts: nextAccounts, changed, syncByTwitterId }
}
