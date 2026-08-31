import { describe, expect, it } from 'vitest'
import { accountsHaveWritableKey } from './operator-key'

describe('accountsHaveWritableKey', () => {
  it('is false for missing or empty accounts', () => {
    expect(accountsHaveWritableKey(undefined)).toBe(false)
    expect(accountsHaveWritableKey([])).toBe(false)
    expect(accountsHaveWritableKey({ accounts: [] })).toBe(false)
  })

  it('is true when any mirrored account is writable', () => {
    expect(
      accountsHaveWritableKey([
        { id: 'ro', readOnly: true },
        { id: 'gen', readOnly: false },
      ]),
    ).toBe(true)
  })

  it('is false when every mirrored account is read-only', () => {
    expect(
      accountsHaveWritableKey([{ id: 'ro', readOnly: true }]),
    ).toBe(false)
  })
})
