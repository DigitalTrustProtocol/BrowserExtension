import { afterEach, describe, expect, it } from 'vitest'
import { resetContentAppModeForTests, setAppModeForTests } from './app-mode'
import {
  accountsHaveWritableKey,
  hasWritableOperatorKey,
  resetContentOperatorKeyForTests,
  setHasWritableOperatorKeyForTests,
} from './operator-key'

afterEach(() => {
  resetContentOperatorKeyForTests()
  resetContentAppModeForTests()
})

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

describe('hasWritableOperatorKey', () => {
  it('is true in Demo even without a vault key', () => {
    setHasWritableOperatorKeyForTests(false)
    setAppModeForTests('demo')
    expect(hasWritableOperatorKey()).toBe(true)
  })

  it('is false in Live without a vault key', () => {
    setHasWritableOperatorKeyForTests(false)
    setAppModeForTests('production')
    expect(hasWritableOperatorKey()).toBe(false)
  })
})
