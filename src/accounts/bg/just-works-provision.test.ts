import { afterEach, describe, expect, it } from 'vitest'
import {
  resetChromeStorage,
  setChromeProfileSignedIn,
} from '../../background/test-chrome-mock.ts'
import * as vault from '../../vault/vault.ts'
import * as accounts from '../accounts.ts'
import {
  buildEasyBlobFromPrivkey,
  writeEasyBlob,
} from '../../vault/easy-roaming.ts'
import { ACTIVE_X_ACCOUNT_SESSION_KEY } from '../../shared/active-x-session.ts'
import { runJustWorksProvision } from './onboarding-handlers.ts'
import { readLocalAccounts } from '../local-account-mirror.ts'
import { boundTwitterIdsOf } from '../x-binding.ts'

afterEach(async () => {
  try {
    if (await vault.exists()) await vault.destroy()
  } catch {
    /* ignore */
  }
  resetChromeStorage()
})

describe('runJustWorksProvision', () => {
  it('mints a never-lock vault and binds when there is no local key', async () => {
    await chrome.storage.session.set({
      [ACTIVE_X_ACCOUNT_SESSION_KEY]: {
        handle: 'alice',
        twitterId: '42',
        detectedAt: Date.now(),
      },
    })
    const result = await runJustWorksProvision()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.demoPending).toBe(true)
    expect(result.boundTwitterId).toBe('42')
    expect(await vault.hasUsableAccounts()).toBe(true)
    expect(vault.getActiveAccount()?.pubkey).toBeTruthy()
  })

  it('derives a NIP-06 sub-account when a master seed already exists', async () => {
    const { account } = await accounts.generateNewAccount()
    account.boundTwitterIds = ['1']
    account.boundTwitterId = '1'
    account.boundUpdatedAt = Date.now()
    await vault.create('', {
      accounts: [account],
      activeAccountId: account.id,
    })
    vault.setAutoLockTimeout(0)
    await chrome.storage.session.set({
      [ACTIVE_X_ACCOUNT_SESSION_KEY]: {
        handle: 'bob',
        twitterId: '99',
        detectedAt: Date.now(),
      },
    })
    const result = await runJustWorksProvision()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.demoPending).toBe(false)
    expect(result.boundTwitterId).toBe('99')
    expect(result.accountId).not.toBe(account.id)
    const listed = vault.listAccounts()
    expect(listed).toHaveLength(2)
    expect(listed.some((row) => row.id === result.accountId)).toBe(true)
    const payload = vault.getDecryptedPayload()
    const sub = payload.accounts.find((row) => row.id === result.accountId)
    expect(sub?.derivationIndex).toBe(1)
    expect(sub?.mnemonic).toBe(account.mnemonic)
  })

  it('binds an existing unbound writable key and mirrors the X binding', async () => {
    const { account } = await accounts.generateNewAccount()
    await vault.create('', {
      accounts: [account],
      activeAccountId: account.id,
    })
    vault.setAutoLockTimeout(0)
    await chrome.storage.session.set({
      [ACTIVE_X_ACCOUNT_SESSION_KEY]: {
        handle: 'alice',
        twitterId: '42',
        detectedAt: Date.now(),
      },
    })
    const result = await runJustWorksProvision()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.demoPending).toBe(false)
    expect(result.boundTwitterId).toBe('42')
    expect(result.accountId).toBe(account.id)
    const { accounts: mirrored } = await readLocalAccounts()
    expect(mirrored).toHaveLength(1)
    expect(boundTwitterIdsOf(mirrored[0] ?? {})).toContain('42')
  })

  it('restores a Chrome Easy blob instead of minting a second identity', async () => {
    setChromeProfileSignedIn(true)
    const { account } = await accounts.generateNewAccount()
    if (!account.privkey) throw new Error('expected privkey')
    const blob = await buildEasyBlobFromPrivkey(account.privkey, {
      accountName: account.name,
    })
    await writeEasyBlob(blob)
    const result = await runJustWorksProvision()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.demoPending).toBe(true)
    expect(vault.getActiveAccount()?.pubkey).toBe(account.pubkey)
  })
})
