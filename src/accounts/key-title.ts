/**
 * Local vault nicknames for Nostr keys (`Account.name`).
 * Default minted title is English `Nostr Key {n}` (max matching N + 1).
 * Read-only is a display suffix, never stored in the name.
 *
 * @module accounts/key-title
 */

import {
  evaluateXIdentityRow,
  npubFromPubkey,
} from '../identity/x-identity-row.ts'
import type { XIdentityRecord } from '../storage/types.ts'

export const DEFAULT_KEY_TITLE_PREFIX = 'Nostr Key'
export const KEY_TITLE_MAX_LENGTH = 64

const DEFAULT_KEY_TITLE_RE = /\bkey\s+(\d+)$/i

export type KeyTitleError = 'empty' | 'tooLong'

export type KeyTitleParse =
  | { ok: true; name: string }
  | { ok: false; error: KeyTitleError }

/** Sequence N from a factory title `Nostr Key {n}`; undefined if renamed. */
export function defaultKeyTitleNumber(
  name: string | null | undefined,
): number | undefined {
  const trimmed = name?.trim()
  if (!trimmed) return undefined
  const match = DEFAULT_KEY_TITLE_RE.exec(trimmed)
  if (!match) return undefined
  const n = Number(match[1])
  return Number.isInteger(n) && n >= 0 ? n : undefined
}

export function nextDefaultKeyName(
  existingNames: readonly (string | null | undefined)[],
): string {
  let max = 0
  for (const raw of existingNames) {
    const n = defaultKeyTitleNumber(raw)
    if (n != null && n > max) max = n
  }
  return `${DEFAULT_KEY_TITLE_PREFIX} ${max + 1}`
}

export function normalizeKeyTitle(raw: string): KeyTitleParse {
  const name = raw.trim()
  if (!name) return { ok: false, error: 'empty' }
  if (name.length > KEY_TITLE_MAX_LENGTH) return { ok: false, error: 'tooLong' }
  return { ok: true, name }
}

/** Cap an optional override; empty/missing falls through to `nextDefaultKeyName`. */
export function resolveNewKeyName(
  existingNames: readonly (string | null | undefined)[],
  override?: string | null,
): string {
  const trimmed = override?.trim()
  if (!trimmed) return nextDefaultKeyName(existingNames)
  return trimmed.length > KEY_TITLE_MAX_LENGTH
    ? trimmed.slice(0, KEY_TITLE_MAX_LENGTH)
    : trimmed
}

export function accountIsReadOnly(account: {
  readOnly?: boolean
  type?: string
}): boolean {
  return account.readOnly === true || account.type === 'npub'
}

export function formatKeyTitle(
  name: string | undefined,
  readOnly: boolean,
  readOnlySuffix: string,
  fallback = '',
): string {
  const base = name?.trim() || fallback.trim()
  if (!base) return readOnly && readOnlySuffix ? `- (${readOnlySuffix})` : base
  if (!readOnly) return base
  return `${base} - (${readOnlySuffix})`
}

export type IdentityTitleRow = Pick<
  XIdentityRecord,
  | 'twitterId'
  | 'displayName'
  | 'xNpub'
  | 'xDate'
  | 'postNpub'
  | 'postDate'
  | 'nip39Npub'
  | 'nip39XId'
  | 'nip39Date'
  | 'eventNpub'
>

/** Use a known X display name when this pubkey is already the winning npub. */
export function keyTitleFromXIdentities(
  pubkeyHex: string,
  rows: readonly IdentityTitleRow[],
): string | undefined {
  const npub = npubFromPubkey(pubkeyHex)
  if (!npub) return undefined
  for (const row of rows) {
    const winning = evaluateXIdentityRow(row).winningNpub?.trim().toLowerCase()
    if (winning !== npub) continue
    const display = row.displayName?.trim()
    if (!display) continue
    return display.length > KEY_TITLE_MAX_LENGTH
      ? display.slice(0, KEY_TITLE_MAX_LENGTH)
      : display
  }
  return undefined
}
