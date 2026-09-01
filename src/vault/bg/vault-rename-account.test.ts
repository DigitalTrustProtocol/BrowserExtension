import { afterEach, describe, expect, it } from 'vitest'
import { resetChromeStorage } from '../../background/test-chrome-mock.ts'
import * as vault from '../vault.ts'
import * as accounts from '../../accounts/accounts.ts'
import { readLocalAccounts, upsertLocalAccountEntry } from '../../accounts/local-account-mirror.ts'
import { toLocalAccountEntry } from '../../accounts/local-account-mirror.ts'
import { setBrowserKeyRoaming } from '../browser-key-roaming.ts'
import {
  buildEasyBlobFromPrivkey,
  readEasyBlob,
  writeEasyBlob,
} from '../easy-roaming.ts'
import { handlers } from './vault-handlers.ts'

afterEach(async () => {
  try {
    if (await vault.exists()) await vault.destroy()
  } catch {
    /* ignore */
  }
  resetChromeStorage()
})

const rename = handlers.get('vault_renameAccount')
if (!rename) throw new Error('vault_renameAccount missing')

describe('vault_renameAccount', () => {
  it('updates vault and local mirror for a writable key', async () => {
    const { account } = await accounts.generateNewAccount('Main')
    await vault.create('', { accounts: [account], activeAccountId: account.id })
    await upsertLocalAccountEntry(toLocalAccountEntry(account), {
      activeAccountId: account.id,
    })
    await rename({ accountId: account.id, name: '  Work  ' })
    expect(vault.getAccountById(account.id)?.name).toBe('Work')
    const { accounts: local } = await readLocalAccounts()
    expect(local.find((row) => row.id === account.id)?.name).toBe('Work')
  })

  it('rejects empty and too-long names', async () => {
    const { account } = await accounts.generateNewAccount('Main')
    await vault.create('', { accounts: [account], activeAccountId: account.id })
    await upsertLocalAccountEntry(toLocalAccountEntry(account))
    await expect(rename({ accountId: account.id, name: '   ' })).rejects.toThrow(
      'empty',
    )
    await expect(
      rename({ accountId: account.id, name: 'x'.repeat(65) }),
    ).rejects.toThrow('tooLong')
  })

  it('renames a mirror-only read-only key without a vault account', async () => {
    const watch = accounts.importNpub('bb'.repeat(32), 'Watch-only')
    await upsertLocalAccountEntry(toLocalAccountEntry(watch), {
      activeAccountId: watch.id,
    })
    await rename({ accountId: watch.id, name: 'Alice' })
    const { accounts: local } = await readLocalAccounts()
    expect(local.find((row) => row.id === watch.id)?.name).toBe('Alice')
  })

  it('requires unlock to rename a writable key when the vault is locked', async () => {
    const { account } = await accounts.generateNewAccount('Main')
    await vault.create('password12', {
      accounts: [account],
      activeAccountId: account.id,
    })
    await upsertLocalAccountEntry(toLocalAccountEntry(account), {
      activeAccountId: account.id,
    })
    vault.lock()
    await expect(
      rename({ accountId: account.id, name: 'Work' }),
    ).rejects.toThrow('Vault is locked')
  })

  it('rewrites sync accountName when a blob exists and roaming is on', async () => {
    const { account } = await accounts.generateNewAccount('Main')
    if (!account.privkey) throw new Error('missing privkey')
    await vault.create('', { accounts: [account], activeAccountId: account.id })
    await upsertLocalAccountEntry(toLocalAccountEntry(account), {
      activeAccountId: account.id,
    })
    await writeEasyBlob(
      await buildEasyBlobFromPrivkey(account.privkey, { accountName: 'Main' }),
    )
    await rename({ accountId: account.id, name: 'Nostr Key 1' })
    expect((await readEasyBlob())?.accountName).toBe('Nostr Key 1')
  })

  it('does not create a sync blob on rename when none exists', async () => {
    const { account } = await accounts.generateNewAccount('Main')
    await vault.create('', { accounts: [account], activeAccountId: account.id })
    await upsertLocalAccountEntry(toLocalAccountEntry(account), {
      activeAccountId: account.id,
    })
    await rename({ accountId: account.id, name: 'Work' })
    expect(await readEasyBlob()).toBeNull()
  })

  it('skips sync remirror when roaming is off', async () => {
    const { account } = await accounts.generateNewAccount('Main')
    if (!account.privkey) throw new Error('missing privkey')
    await vault.create('', { accounts: [account], activeAccountId: account.id })
    await upsertLocalAccountEntry(toLocalAccountEntry(account), {
      activeAccountId: account.id,
    })
    await writeEasyBlob(
      await buildEasyBlobFromPrivkey(account.privkey, { accountName: 'Main' }),
    )
    await setBrowserKeyRoaming(false)
    await rename({ accountId: account.id, name: 'Work' })
    expect((await readEasyBlob())?.accountName).toBe('Main')
  })
})
