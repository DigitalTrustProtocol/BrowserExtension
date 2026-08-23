import {
  evaluateXIdentityRow,
  npubFromPubkey,
  pubkeyFromNpub,
  primaryNpubFromRow,
} from '../identity/x-identity-row'
import type { XIdentityRecord } from '../storage/types'

const HEX_PUBKEY = /^[0-9a-f]{64}$/

export function normalizeNpubOrHex(value: string): {
  npub?: string
  hex?: string
} {
  const trimmed = value.trim().toLowerCase()
  if (HEX_PUBKEY.test(trimmed)) {
    return { hex: trimmed, npub: npubFromPubkey(trimmed) }
  }
  if (trimmed.startsWith('npub1')) {
    return { npub: trimmed, hex: pubkeyFromNpub(trimmed) }
  }
  return {}
}

/** Winning npub and hex keys for reverse lookup. Empty when unbound. */
export function winningNpubLookupKeys(
  row: Pick<
    XIdentityRecord,
    | 'twitterId'
    | 'xNpub'
    | 'xDate'
    | 'postNpub'
    | 'postDate'
    | 'nip39Npub'
    | 'nip39XId'
    | 'nip39Date'
    | 'eventNpub'
  >,
): string[] {
  const npub = evaluateXIdentityRow(row).winningNpub
  if (!npub) return []
  const keys = new Set<string>([npub])
  const hex = pubkeyFromNpub(npub)
  if (hex) keys.add(hex)
  return [...keys]
}

export function npubForIdentityRow(
  row: Parameters<typeof primaryNpubFromRow>[0],
): string | undefined {
  return primaryNpubFromRow(row)
}

export function twitterIdFromWinningNpub(
  rows: readonly XIdentityRecord[],
  npubOrHex: string,
): string | undefined {
  const wanted = normalizeNpubOrHex(npubOrHex)
  if (!wanted.npub && !wanted.hex) return undefined
  for (const row of rows) {
    const keys = winningNpubLookupKeys(row)
    if (wanted.npub && keys.includes(wanted.npub)) return row.twitterId
    if (wanted.hex && keys.includes(wanted.hex)) return row.twitterId
  }
  return undefined
}