import { describe, expect, it } from 'vitest'
import {
  CREDENTIAL_PBKDF2_ITERATIONS,
  checksumFromEntropy,
  deriveCredentialAccount,
  deriveCredentialEntropy,
  sanitizeEmail,
  validateCredentialInputs,
  validateCredentialPassword,
  validateCredentialPin,
} from './credential-seed.ts'
import { constantTimeEqual } from './utils.ts'

describe('credential-seed', () => {
  it('sanitizes email to lowercase trimmed', () => {
    expect(sanitizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com')
  })

  it('validates password rules', () => {
    expect(validateCredentialPassword('short').ok).toBe(false)
    expect(validateCredentialPassword('longenoughbutnodigit!').ok).toBe(false)
    expect(validateCredentialPassword('longenough1234').ok).toBe(false)
    expect(validateCredentialPassword('LongEnough1!').ok).toBe(true)
  })

  it('validates pin rules', () => {
    expect(validateCredentialPin('12').ok).toBe(false)
    expect(validateCredentialPin('123456789').ok).toBe(false)
    expect(validateCredentialPin('12ab').ok).toBe(false)
    expect(validateCredentialPin('1234').ok).toBe(true)
    expect(validateCredentialPin('12345678').ok).toBe(true)
  })

  it('rejects invalid combined inputs', () => {
    const r = validateCredentialInputs({
      email: 'not-an-email',
      password: 'LongEnough1!',
      pin: '1234',
    })
    expect(r.ok).toBe(false)
  })

  it('derives deterministic entropy, checksum, and account', async () => {
    const email = 'alice@example.com'
    const password = 'CorrectHorse1!'
    const pin = '4242'
    const a = await deriveCredentialEntropy(email, password, pin)
    const b = await deriveCredentialEntropy(email, password, pin)
    expect(constantTimeEqual(a, b)).toBe(true)
    expect(a.length).toBe(16)
    expect(checksumFromEntropy(a)).toBe(checksumFromEntropy(b))

    const other = await deriveCredentialEntropy(email, password, '9999')
    expect(constantTimeEqual(a, other)).toBe(false)

    const acct = await deriveCredentialAccount({ email, password, pin })
    expect(acct.iterations).toBe(CREDENTIAL_PBKDF2_ITERATIONS)
    expect(acct.checksum).toMatch(/^[0-9a-f]{64}$/)
    expect(acct.mnemonic.split(' ').length).toBe(12)
    expect(acct.account.privkey).toMatch(/^[0-9a-f]{64}$/)
    expect(acct.account.type).toBe('generated')

    const again = await deriveCredentialAccount({ email, password, pin })
    expect(again.account.pubkey).toBe(acct.account.pubkey)
    expect(again.checksum).toBe(acct.checksum)

    a.fill(0)
    b.fill(0)
    other.fill(0)
    acct.entropy.fill(0)
    again.entropy.fill(0)
  }, 60_000)

  it('changing password changes the pubkey', async () => {
    const base = await deriveCredentialAccount({
      email: 'bob@example.com',
      password: 'CorrectHorse1!',
      pin: '1111',
    })
    const changed = await deriveCredentialAccount({
      email: 'bob@example.com',
      password: 'CorrectHorse2!',
      pin: '1111',
    })
    expect(changed.account.pubkey).not.toBe(base.account.pubkey)
    base.entropy.fill(0)
    changed.entropy.fill(0)
  }, 60_000)
})
