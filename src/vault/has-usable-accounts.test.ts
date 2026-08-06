import { afterEach, describe, expect, it } from 'vitest'
import { resetChromeStorage } from '../background/test-chrome-mock.ts'
import * as vault from './vault.ts'
import { bytesToHex, hexToBytes, randomBytes } from './crypto/utils.ts'
import { getPublicKey } from './crypto/secp256k1.ts'
import type { Account } from './types.ts'

afterEach(async () => {
  try {
    if (await vault.exists()) await vault.destroy()
  } catch {
    /* ignore */
  }
  resetChromeStorage()
})

function sampleAccount(): Account {
  const privkey = bytesToHex(randomBytes(32))
  const pubkey = bytesToHex(getPublicKey(hexToBytes(privkey)))
  return {
    id: 'acct1',
    name: 'Main',
    type: 'generated',
    pubkey,
    privkey,
    mnemonic: null,
    nip46Config: null,
    readOnly: false,
    createdAt: 1,
  }
}

describe('vault.hasUsableAccounts', () => {
  it('returns false and destroys an empty never-lock vault shell', async () => {
    await vault.create('', { accounts: [], activeAccountId: null })
    expect(await vault.exists()).toBe(true)
    expect(await vault.hasUsableAccounts()).toBe(false)
    expect(await vault.exists()).toBe(false)
  })

  it('returns true when the vault has an account', async () => {
    const acct = sampleAccount()
    await vault.create('', { accounts: [acct], activeAccountId: acct.id })
    expect(await vault.hasUsableAccounts()).toBe(true)
    expect(await vault.exists()).toBe(true)
  })
})
