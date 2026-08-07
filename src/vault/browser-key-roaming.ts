/**
 * “Roaming of Nostr keys” preference + Sync clear helpers.
 * Default ON. When OFF, Sync roaming data is cleared; local vault stays.
 *
 * @module vault/browser-key-roaming
 */

import browser from './browser.ts'
import {
  clearEasyBlob,
  clearEasyBlobsMap,
  EASY_ACCOUNT_BLOB_KEY,
  EASY_ACCOUNT_BLOBS_KEY,
} from './easy-roaming.ts'
import { clearCredentialChecksums } from './credential-checksums.ts'
import { X_NOSTR_BINDINGS_KEY } from './x-nostr-bindings-sync.ts'
import { MAX_ROAMING_ENTRY_BYTES } from './constants.ts'

export const BROWSER_KEY_ROAMING_KEY = 'browserKeyRoaming'
export { MAX_ROAMING_ENTRY_BYTES }

export async function getBrowserKeyRoaming(): Promise<boolean> {
  const data = (await browser.storage.local.get(BROWSER_KEY_ROAMING_KEY)) as Record<
    string,
    unknown
  >
  if (typeof data[BROWSER_KEY_ROAMING_KEY] === 'boolean') {
    return data[BROWSER_KEY_ROAMING_KEY] as boolean
  }
  return true
}

export async function setBrowserKeyRoaming(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [BROWSER_KEY_ROAMING_KEY]: enabled })
  // Mirror preference so it can roam with the profile when sync is used.
  try {
    await browser.storage.sync.set({ [BROWSER_KEY_ROAMING_KEY]: enabled })
  } catch {
    /* sync may be unavailable */
  }
}

/** Clear all Sync-backed roaming material (keys, bindings, checksums). */
export async function clearAllRoamingSyncData(): Promise<void> {
  await clearEasyBlob()
  await clearEasyBlobsMap()
  await clearCredentialChecksums()
  await browser.storage.sync.remove([
    X_NOSTR_BINDINGS_KEY,
    EASY_ACCOUNT_BLOB_KEY,
    EASY_ACCOUNT_BLOBS_KEY,
  ])
}

export function estimateJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}
