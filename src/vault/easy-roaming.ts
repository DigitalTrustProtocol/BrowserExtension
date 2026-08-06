/**
 * Easy-account roaming blob for Chrome Sync (Phase 1).
 *
 * Stores a single-account NIP-49 ncryptsec (empty-password wrap) plus
 * non-secret metadata in chrome.storage.sync. Local vault remains source of
 * truth after unlock; sync is backup / restore transport.
 *
 * @module vault/easy-roaming
 */

import browser from './browser.ts';
import type { Account } from './types.ts';
import { ncryptsecEncode, ncryptsecDecode } from './crypto/nip49.ts';
import { getPublicKey } from './crypto/secp256k1.ts';
import { hexToBytes, bytesToHex } from './crypto/utils.ts';
import * as accounts from '../accounts/accounts.ts';

export const EASY_ACCOUNT_BLOB_KEY = 'easyAccountBlob';

/** Phase 1 Easy wrap: empty password (never-lock comfort path). */
export const EASY_WRAP_PASSWORD = '';

export type EasyConflict = 'none' | 'same' | 'different';

export interface EasyAccountBlob {
  version: 1;
  updatedAt: number;
  ncryptsec: string;
  pubkeyHint: string;
  accountName?: string;
  /** Marks this blob as Easy roaming backup (not a signer type). */
  easyRoaming?: true;
}

function isEasyAccountBlob(value: unknown): value is EasyAccountBlob {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.updatedAt === 'number' &&
    typeof v.ncryptsec === 'string' &&
    typeof v.pubkeyHint === 'string' &&
    /^[0-9a-f]{64}$/i.test(v.pubkeyHint)
  );
}

export async function readEasyBlob(): Promise<EasyAccountBlob | null> {
  const data = (await browser.storage.sync.get(EASY_ACCOUNT_BLOB_KEY)) as Record<
    string,
    unknown
  >;
  const raw = data[EASY_ACCOUNT_BLOB_KEY];
  return isEasyAccountBlob(raw) ? raw : null;
}

export async function writeEasyBlob(blob: EasyAccountBlob): Promise<void> {
  if (!isEasyAccountBlob(blob)) throw new Error('Invalid easy account blob');
  await browser.storage.sync.set({ [EASY_ACCOUNT_BLOB_KEY]: blob });
}

export async function clearEasyBlob(): Promise<void> {
  await browser.storage.sync.remove(EASY_ACCOUNT_BLOB_KEY);
}

export function classifyEasyConflict(
  localPubkey: string | null | undefined,
  syncBlob: EasyAccountBlob | null,
): EasyConflict {
  if (!syncBlob) return 'none';
  if (!localPubkey) return 'different';
  return localPubkey.toLowerCase() === syncBlob.pubkeyHint.toLowerCase()
    ? 'same'
    : 'different';
}

export async function buildEasyBlobFromPrivkey(
  privkeyHex: string,
  meta: { accountName?: string; updatedAt?: number } = {},
): Promise<EasyAccountBlob> {
  const privkeyBytes = hexToBytes(privkeyHex);
  let pubkeyHint: string;
  try {
    pubkeyHint = bytesToHex(getPublicKey(privkeyBytes));
  } finally {
    privkeyBytes.fill(0);
  }

  const ncryptsec = await ncryptsecEncode(privkeyHex, EASY_WRAP_PASSWORD);
  return {
    version: 1,
    updatedAt: meta.updatedAt ?? Date.now(),
    ncryptsec,
    pubkeyHint,
    accountName: meta.accountName,
    easyRoaming: true,
  };
}

/**
 * Decode Easy blob into a vault Account (no mnemonic; type generated).
 */
export async function restoreAccountFromEasyBlob(
  blob: EasyAccountBlob,
): Promise<Account> {
  if (!isEasyAccountBlob(blob)) throw new Error('Invalid easy account blob');
  const privkeyHex = await ncryptsecDecode(blob.ncryptsec, EASY_WRAP_PASSWORD);
  try {
    const acct = await accounts.importNsec(
      privkeyHex,
      blob.accountName || 'Main',
    );
    // Easy restore uses generated labeling so signing paths stay unchanged.
    return {
      ...acct,
      type: 'generated',
      mnemonic: null,
      name: blob.accountName || 'Main',
    };
  } finally {
    // importNsec already copied hex onto Account; zero the temporary decode buffer
    // by overwriting the string is not possible — best-effort via unused local.
    void privkeyHex;
  }
}

/**
 * If sync already backs up this pubkey (or has no blob), write a fresh blob.
 * If sync has a different pubkey, no-op unless `replace` is true.
 * @returns whether a write occurred
 */
export async function remirrorEasyBlobForPubkey(
  privkeyHex: string,
  meta: { accountName?: string; replace?: boolean } = {},
): Promise<{ wrote: boolean; conflict: EasyConflict }> {
  const existing = await readEasyBlob();
  const privkeyBytes = hexToBytes(privkeyHex);
  let pubkey: string;
  try {
    pubkey = bytesToHex(getPublicKey(privkeyBytes));
  } finally {
    privkeyBytes.fill(0);
  }

  const conflict = classifyEasyConflict(pubkey, existing);
  if (conflict === 'different' && !meta.replace) {
    return { wrote: false, conflict };
  }

  const blob = await buildEasyBlobFromPrivkey(privkeyHex, {
    accountName: meta.accountName,
  });
  await writeEasyBlob(blob);
  return { wrote: true, conflict: conflict === 'different' ? 'different' : classifyEasyConflict(pubkey, blob) };
}
