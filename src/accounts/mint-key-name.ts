/**
 * Mint the next `Nostr Key {n}` from vault + local-mirror names.
 *
 * @module accounts/mint-key-name
 */

import * as vault from '../vault/vault.ts'
import { readLocalAccounts } from './local-account-mirror.ts'
import { resolveNewKeyName } from './key-title.ts'

export async function existingKeyNames(): Promise<string[]> {
  const { accounts } = await readLocalAccounts()
  const vaultNames = vault.isLocked() ? [] : vault.listAccounts().map((a) => a.name)
  return [...vaultNames, ...accounts.map((a) => a.name)]
}

export async function nameForNewKey(override?: string | null): Promise<string> {
  return resolveNewKeyName(await existingKeyNames(), override)
}
