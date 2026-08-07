/**
 * Logout-surviving (until logout / roaming OFF) credential login checksums.
 * Stored in chrome.storage.sync when roaming is enabled and Chrome is signed in.
 *
 * @module vault/credential-checksums
 */

import browser from './browser.ts'
import {
  CREDENTIAL_PBKDF2_ITERATIONS,
  MAX_CREDENTIAL_CHECKSUMS,
} from './crypto/credential-seed.ts'

export const CREDENTIAL_CHECKSUMS_KEY = 'credentialChecksums'

export type CredentialChecksumEntry = {
  checksum: string
  iterations: number
}

function isEntry(value: unknown): value is CredentialChecksumEntry {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.checksum === 'string' &&
    /^[0-9a-f]{64}$/i.test(v.checksum) &&
    typeof v.iterations === 'number' &&
    Number.isFinite(v.iterations) &&
    v.iterations > 0
  )
}

export async function readCredentialChecksums(): Promise<
  CredentialChecksumEntry[]
> {
  const data = (await browser.storage.sync.get(CREDENTIAL_CHECKSUMS_KEY)) as Record<
    string,
    unknown
  >
  const raw = data[CREDENTIAL_CHECKSUMS_KEY]
  if (!Array.isArray(raw)) return []
  return raw.filter(isEntry).map((e) => ({
    checksum: e.checksum.toLowerCase(),
    iterations: e.iterations,
  }))
}

export async function writeCredentialChecksums(
  entries: CredentialChecksumEntry[],
): Promise<void> {
  const cleaned = entries
    .filter(isEntry)
    .map((e) => ({
      checksum: e.checksum.toLowerCase(),
      iterations: e.iterations,
    }))
    .slice(-MAX_CREDENTIAL_CHECKSUMS)
  await browser.storage.sync.set({ [CREDENTIAL_CHECKSUMS_KEY]: cleaned })
}

export async function clearCredentialChecksums(): Promise<void> {
  await browser.storage.sync.remove(CREDENTIAL_CHECKSUMS_KEY)
}

export function findChecksumMatch(
  entries: CredentialChecksumEntry[],
  checksum: string,
  iterations: number,
): boolean {
  const needle = checksum.toLowerCase()
  return entries.some(
    (e) => e.checksum === needle && e.iterations === iterations,
  )
}

export async function appendCredentialChecksum(entry: {
  checksum: string
  iterations?: number
}): Promise<CredentialChecksumEntry[]> {
  const list = await readCredentialChecksums()
  const iterations = entry.iterations ?? CREDENTIAL_PBKDF2_ITERATIONS
  const checksum = entry.checksum.toLowerCase()
  if (findChecksumMatch(list, checksum, iterations)) return list
  list.push({ checksum, iterations })
  while (list.length > MAX_CREDENTIAL_CHECKSUMS) list.shift()
  await writeCredentialChecksums(list)
  return list
}

export function distinctIterations(
  entries: CredentialChecksumEntry[],
): number[] {
  return [...new Set(entries.map((e) => e.iterations))].sort((a, b) => b - a)
}
