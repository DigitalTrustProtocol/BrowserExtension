import { afterEach, describe, expect, it } from 'vitest'
import { resetChromeStorage } from '../background/test-chrome-mock.ts'
import * as vault from '../vault/vault.ts'
import * as accounts from './accounts.ts'
import { upsertLocalAccountEntry, toLocalAccountEntry } from './local-account-mirror.ts'
import { existingKeyNames, nameForNewKey } from './mint-key-name.ts'

afterEach(async () => {
  try {
    if (await vault.exists()) await vault.destroy()
  } catch {
    /* ignore */
  }
  resetChromeStorage()
})

describe('existingKeyNames', () => {
  it('unions vault and mirror-only names so numbering does not collide', async () => {
    const { account } = await accounts.generateNewAccount('Nostr Key 1')
    await vault.create('', { accounts: [account], activeAccountId: account.id })
    const watch = accounts.importNpub('bb'.repeat(32), 'Nostr Key 2')
    await upsertLocalAccountEntry(toLocalAccountEntry(watch))
    const names = await existingKeyNames()
    expect(names).toContain('Nostr Key 1')
    expect(names).toContain('Nostr Key 2')
    expect(await nameForNewKey()).toBe('Nostr Key 3')
  })
})
