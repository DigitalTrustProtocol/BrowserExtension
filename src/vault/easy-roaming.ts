/**
 * Easy-account roaming blobs for Chrome Sync.
 *
 * Phase 1: single `easyAccountBlob` (v1).
 * Phase 1.5 / X-bound: per-X map `easyAccountBlobs` (v2), max 10 entries.
 * Local vault remains source of truth after unlock; sync is backup / restore.
 *
 * @module vault/easy-roaming
 */

import browser from './browser.ts'
import type { Account } from './types.ts'
import { ncryptsecEncode, ncryptsecDecode } from './crypto/nip49.ts'
import { getPublicKey } from './crypto/secp256k1.ts'
import { hexToBytes, bytesToHex } from './crypto/utils.ts'
import { npubEncode } from './crypto/bech32.ts'
import * as accounts from '../accounts/accounts.ts'
import { MAX_BOUND_X_ACCOUNTS, normalizeBoundTwitterId } from '../accounts/x-binding.ts'
import { MAX_ROAMING_ENTRY_BYTES } from './constants.ts'

function estimateJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

export const EASY_ACCOUNT_BLOB_KEY = 'easyAccountBlob'
export const EASY_ACCOUNT_BLOBS_KEY = 'easyAccountBlobs'

/** Phase 1 Easy wrap: empty password (never-lock comfort path). */
export const EASY_WRAP_PASSWORD = ''

export type EasyConflict = 'none' | 'same' | 'different'

/** Legacy single-account Easy blob (v1). */
export interface EasyAccountBlob {
  version: 1
  updatedAt: number
  ncryptsec: string
  pubkeyHint: string
  accountName?: string
  easyRoaming?: true
  boundTwitterId?: string
}

/** Per-X Easy blob entry (schema v2 map values). */
export interface EasyAccountBlobV2 {
  version: 2
  updatedAt: number
  /** Present for live entries; omitted when `deleted` is true. */
  ncryptsec?: string
  pubkeyHint: string
  accountName?: string
  easyRoaming?: true
  boundTwitterId: string
  boundUpdatedAt: number
  /** Multi-device delete marker — peers silently remove local account. */
  deleted?: boolean
  /** NIP-19 npub kept after delete (public; no secrets). */
  npubDeleted?: string
  /** Optional BIP-39 mnemonic when roaming (stripped on delete). */
  mnemonic?: string
}

export interface EasyAccountBlobsMap {
  version: 2
  byTwitterId: Record<string, EasyAccountBlobV2>
}

function isEasyAccountBlob(value: unknown): value is EasyAccountBlob {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    v.version === 1 &&
    typeof v.updatedAt === 'number' &&
    typeof v.ncryptsec === 'string' &&
    typeof v.pubkeyHint === 'string' &&
    /^[0-9a-f]{64}$/i.test(v.pubkeyHint)
  )
}

function isEasyAccountBlobV2(value: unknown): value is EasyAccountBlobV2 {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const base =
    v.version === 2 &&
    typeof v.updatedAt === 'number' &&
    typeof v.pubkeyHint === 'string' &&
    /^[0-9a-f]{64}$/i.test(v.pubkeyHint) &&
    typeof v.boundTwitterId === 'string' &&
    /^[0-9]+$/.test(v.boundTwitterId) &&
    typeof v.boundUpdatedAt === 'number'
  if (!base) return false
  if (v.deleted === true) {
    return (
      (v.ncryptsec === undefined || v.ncryptsec === '') &&
      (typeof v.npubDeleted === 'string' || v.npubDeleted === undefined)
    )
  }
  return typeof v.ncryptsec === 'string' && v.ncryptsec.length > 0
}

function isEasyAccountBlobsMap(value: unknown): value is EasyAccountBlobsMap {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v.version !== 2 || !v.byTwitterId || typeof v.byTwitterId !== 'object') {
    return false
  }
  for (const entry of Object.values(v.byTwitterId as Record<string, unknown>)) {
    if (!isEasyAccountBlobV2(entry)) return false
  }
  return true
}

export async function readEasyBlob(): Promise<EasyAccountBlob | null> {
  const data = (await browser.storage.sync.get(EASY_ACCOUNT_BLOB_KEY)) as Record<
    string,
    unknown
  >
  const raw = data[EASY_ACCOUNT_BLOB_KEY]
  return isEasyAccountBlob(raw) ? raw : null
}

export async function writeEasyBlob(blob: EasyAccountBlob): Promise<void> {
  if (!isEasyAccountBlob(blob)) throw new Error('Invalid easy account blob')
  await browser.storage.sync.set({ [EASY_ACCOUNT_BLOB_KEY]: blob })
}

export async function clearEasyBlob(): Promise<void> {
  await browser.storage.sync.remove(EASY_ACCOUNT_BLOB_KEY)
}

export async function readEasyBlobsMap(): Promise<EasyAccountBlobsMap> {
  const data = (await browser.storage.sync.get([
    EASY_ACCOUNT_BLOBS_KEY,
    EASY_ACCOUNT_BLOB_KEY,
  ])) as Record<string, unknown>
  const mapRaw = data[EASY_ACCOUNT_BLOBS_KEY]
  if (isEasyAccountBlobsMap(mapRaw)) return mapRaw

  // Migrate v1 single blob into map when it carries a boundTwitterId.
  const v1 = data[EASY_ACCOUNT_BLOB_KEY]
  if (isEasyAccountBlob(v1)) {
    const tid = normalizeBoundTwitterId(v1.boundTwitterId)
    if (tid) {
      const migrated: EasyAccountBlobsMap = {
        version: 2,
        byTwitterId: {
          [tid]: {
            version: 2,
            updatedAt: v1.updatedAt,
            ncryptsec: v1.ncryptsec,
            pubkeyHint: v1.pubkeyHint.toLowerCase(),
            accountName: v1.accountName,
            easyRoaming: true,
            boundTwitterId: tid,
            boundUpdatedAt: v1.updatedAt,
          },
        },
      }
      await writeEasyBlobsMap(migrated)
      return migrated
    }
  }
  return { version: 2, byTwitterId: {} }
}

export async function writeEasyBlobsMap(map: EasyAccountBlobsMap): Promise<void> {
  if (!isEasyAccountBlobsMap(map)) throw new Error('Invalid easyAccountBlobs map')
  const liveKeys = Object.entries(map.byTwitterId).filter(([, e]) => !e.deleted)
  if (liveKeys.length > MAX_BOUND_X_ACCOUNTS) {
    throw new Error(
      `Easy account blobs exceed cap of ${MAX_BOUND_X_ACCOUNTS} entries`,
    )
  }
  await browser.storage.sync.set({ [EASY_ACCOUNT_BLOBS_KEY]: map })
}

export async function clearEasyBlobsMap(): Promise<void> {
  await browser.storage.sync.remove(EASY_ACCOUNT_BLOBS_KEY)
}

export function countLiveEasyBlobs(map: EasyAccountBlobsMap): number {
  return Object.values(map.byTwitterId).filter((e) => !e.deleted).length
}

export function classifyEasyConflict(
  localPubkey: string | null | undefined,
  syncBlob: EasyAccountBlob | EasyAccountBlobV2 | null,
): EasyConflict {
  if (!syncBlob) return 'none'
  if (!localPubkey) return 'different'
  return localPubkey.toLowerCase() === syncBlob.pubkeyHint.toLowerCase()
    ? 'same'
    : 'different'
}

export async function buildEasyBlobFromPrivkey(
  privkeyHex: string,
  meta: {
    accountName?: string
    updatedAt?: number
    boundTwitterId?: string
  } = {},
): Promise<EasyAccountBlob> {
  const privkeyBytes = hexToBytes(privkeyHex)
  let pubkeyHint: string
  try {
    pubkeyHint = bytesToHex(getPublicKey(privkeyBytes))
  } finally {
    privkeyBytes.fill(0)
  }

  const ncryptsec = await ncryptsecEncode(privkeyHex, EASY_WRAP_PASSWORD)
  const tid = normalizeBoundTwitterId(meta.boundTwitterId)
  return {
    version: 1,
    updatedAt: meta.updatedAt ?? Date.now(),
    ncryptsec,
    pubkeyHint,
    accountName: meta.accountName,
    easyRoaming: true,
    ...(tid ? { boundTwitterId: tid } : {}),
  }
}

export async function buildEasyBlobV2FromPrivkey(
  privkeyHex: string,
  meta: {
    accountName?: string
    updatedAt?: number
    boundTwitterId: string
    boundUpdatedAt?: number
    mnemonic?: string | null
  },
): Promise<EasyAccountBlobV2> {
  const tid = normalizeBoundTwitterId(meta.boundTwitterId)
  if (!tid) throw new Error('Easy v2 blob requires boundTwitterId')
  const base = await buildEasyBlobFromPrivkey(privkeyHex, {
    accountName: meta.accountName,
    updatedAt: meta.updatedAt,
    boundTwitterId: tid,
  })
  const now = meta.boundUpdatedAt ?? base.updatedAt
  const entry: EasyAccountBlobV2 = {
    version: 2,
    updatedAt: base.updatedAt,
    ncryptsec: base.ncryptsec,
    pubkeyHint: base.pubkeyHint.toLowerCase(),
    accountName: base.accountName,
    easyRoaming: true,
    boundTwitterId: tid,
    boundUpdatedAt: now,
  }
  if (meta.mnemonic) entry.mnemonic = meta.mnemonic
  if (estimateJsonBytes(entry) > MAX_ROAMING_ENTRY_BYTES) {
    delete entry.mnemonic
    if (estimateJsonBytes(entry) > MAX_ROAMING_ENTRY_BYTES) {
      throw new Error('Roaming entry exceeds 5 KB limit')
    }
  }
  return entry
}

/**
 * Upsert a per-X Easy blob. Refuses when at cap unless replacing same twitterId.
 */
export async function upsertEasyBlobForTwitterId(
  privkeyHex: string,
  meta: {
    boundTwitterId: string
    accountName?: string
    boundUpdatedAt?: number
    replace?: boolean
    mnemonic?: string | null
  },
): Promise<{ wrote: boolean; conflict: EasyConflict }> {
  const tid = normalizeBoundTwitterId(meta.boundTwitterId)
  if (!tid) throw new Error('boundTwitterId required')
  const map = await readEasyBlobsMap()
  const existing = map.byTwitterId[tid] ?? null
  const liveExisting = existing && !existing.deleted ? existing : null
  const privkeyBytes = hexToBytes(privkeyHex)
  let pubkey: string
  try {
    pubkey = bytesToHex(getPublicKey(privkeyBytes))
  } finally {
    privkeyBytes.fill(0)
  }
  const conflict = classifyEasyConflict(pubkey, liveExisting)
  if (conflict === 'different' && !meta.replace) {
    return { wrote: false, conflict }
  }
  const liveCount = countLiveEasyBlobs(map)
  if (!liveExisting && liveCount >= MAX_BOUND_X_ACCOUNTS) {
    throw new Error(
      `At most ${MAX_BOUND_X_ACCOUNTS} Easy X-bound backups are allowed`,
    )
  }
  // Drop other twitterIds with same pubkey
  for (const [otherTid, row] of Object.entries(map.byTwitterId)) {
    if (row.pubkeyHint.toLowerCase() === pubkey.toLowerCase() && otherTid !== tid) {
      delete map.byTwitterId[otherTid]
    }
  }
  map.byTwitterId[tid] = await buildEasyBlobV2FromPrivkey(privkeyHex, {
    accountName: meta.accountName,
    boundTwitterId: tid,
    boundUpdatedAt: meta.boundUpdatedAt,
    mnemonic: meta.mnemonic,
  })
  await writeEasyBlobsMap(map)
  // Keep legacy v1 key in sync for older clients when this is the only entry
  const v1 = await buildEasyBlobFromPrivkey(privkeyHex, {
    accountName: meta.accountName,
    boundTwitterId: tid,
  })
  await writeEasyBlob(v1)
  return { wrote: true, conflict }
}

/**
 * Replace a live Sync entry with a delete marker (keep npub; strip secrets).
 */
export async function markEasyBlobDeletedForTwitterId(
  twitterId: string,
  opts: { pubkeyHint?: string; npub?: string } = {},
): Promise<void> {
  const tid = normalizeBoundTwitterId(twitterId)
  if (!tid) return
  const map = await readEasyBlobsMap()
  const existing = map.byTwitterId[tid]
  const pubkeyHint = (
    opts.pubkeyHint ||
    existing?.pubkeyHint ||
    ''
  ).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(pubkeyHint)) {
    delete map.byTwitterId[tid]
    await writeEasyBlobsMap(map)
    return
  }
  const npub =
    opts.npub ||
    existing?.npubDeleted ||
    npubEncode(pubkeyHint)
  const now = Date.now()
  map.byTwitterId[tid] = {
    version: 2,
    updatedAt: now,
    pubkeyHint,
    boundTwitterId: tid,
    boundUpdatedAt: now,
    deleted: true,
    npubDeleted: npub,
    easyRoaming: true,
  }
  await writeEasyBlobsMap(map)
}

export async function removeEasyBlobForTwitterId(
  twitterId: string,
): Promise<void> {
  const tid = normalizeBoundTwitterId(twitterId)
  if (!tid) return
  const map = await readEasyBlobsMap()
  if (!(tid in map.byTwitterId)) return
  delete map.byTwitterId[tid]
  await writeEasyBlobsMap(map)
}

/**
 * Decode Easy blob into a vault Account (no mnemonic; type generated).
 */
export async function restoreAccountFromEasyBlob(
  blob: EasyAccountBlob | EasyAccountBlobV2,
): Promise<Account> {
  if (blob.version === 2 && blob.deleted) {
    throw new Error('Cannot restore deleted roaming account')
  }
  if (!isEasyAccountBlob(blob) && !isEasyAccountBlobV2(blob)) {
    throw new Error('Invalid easy account blob')
  }
  if (!blob.ncryptsec) throw new Error('Easy blob missing ncryptsec')
  const privkeyHex = await ncryptsecDecode(blob.ncryptsec, EASY_WRAP_PASSWORD)
  try {
    let acct: Account
    if (blob.version === 2 && blob.mnemonic) {
      acct = await accounts.createFromMnemonic(
        blob.mnemonic,
        blob.accountName || 'Main',
      )
    } else {
      acct = await accounts.importNsec(
        privkeyHex,
        blob.accountName || 'Main',
      )
      acct = { ...acct, type: 'generated', mnemonic: null }
    }
    const tid =
      blob.version === 2
        ? normalizeBoundTwitterId(blob.boundTwitterId)
        : normalizeBoundTwitterId(blob.boundTwitterId)
    return {
      ...acct,
      name: blob.accountName || acct.name || 'Main',
      boundTwitterId: tid,
      boundUpdatedAt:
        blob.version === 2
          ? blob.boundUpdatedAt
          : tid
            ? blob.updatedAt
            : null,
    }
  } finally {
    void privkeyHex
  }
}

/**
 * If sync already backs up this pubkey (or has no blob), write a fresh blob.
 * If sync has a different pubkey, no-op unless `replace` is true.
 * @returns whether a write occurred
 */
export async function remirrorEasyBlobForPubkey(
  privkeyHex: string,
  meta: {
    accountName?: string
    replace?: boolean
    boundTwitterId?: string
  } = {},
): Promise<{ wrote: boolean; conflict: EasyConflict }> {
  const tid = normalizeBoundTwitterId(meta.boundTwitterId)
  if (tid) {
    return upsertEasyBlobForTwitterId(privkeyHex, {
      boundTwitterId: tid,
      accountName: meta.accountName,
      replace: meta.replace,
    })
  }

  const existing = await readEasyBlob()
  const privkeyBytes = hexToBytes(privkeyHex)
  let pubkey: string
  try {
    pubkey = bytesToHex(getPublicKey(privkeyBytes))
  } finally {
    privkeyBytes.fill(0)
  }

  const conflict = classifyEasyConflict(pubkey, existing)
  if (conflict === 'different' && !meta.replace) {
    return { wrote: false, conflict }
  }

  const blob = await buildEasyBlobFromPrivkey(privkeyHex, {
    accountName: meta.accountName,
  })
  await writeEasyBlob(blob)
  return {
    wrote: true,
    conflict:
      conflict === 'different'
        ? 'different'
        : classifyEasyConflict(pubkey, blob),
  }
}
