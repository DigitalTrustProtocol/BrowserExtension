import { describe, expect, it } from 'vitest'
import {
  MAX_BOUND_X_ACCOUNTS,
  canBindAccountToX,
  countBoundAccounts,
  findAccountByBoundTwitterId,
  firstBindableNostrAccount,
  isBindableNostrAccount,
  mergeBindingsLatestWins,
  normalizeBoundTwitterId,
  type BoundAccountView,
} from './x-binding.ts'

function acct(
  partial: Partial<BoundAccountView> & Pick<BoundAccountView, 'id' | 'pubkey'>,
): BoundAccountView {
  return {
    boundTwitterId: null,
    boundUpdatedAt: null,
    readOnly: false,
    ...partial,
  }
}

describe('x-binding', () => {
  it('normalizes twitter ids', () => {
    expect(normalizeBoundTwitterId('42')).toBe('42')
    expect(normalizeBoundTwitterId(' 99 ')).toBe('99')
    expect(normalizeBoundTwitterId('abc')).toBeNull()
    expect(normalizeBoundTwitterId(null)).toBeNull()
  })

  it('enforces 1↔1 bind rules and cap', () => {
    const accounts = [
      acct({ id: 'a', pubkey: 'aa'.repeat(32), boundTwitterId: '1', boundUpdatedAt: 10 }),
      acct({ id: 'b', pubkey: 'bb'.repeat(32) }),
    ]
    expect(canBindAccountToX(accounts, 'b', '1').ok).toBe(false)
    expect(canBindAccountToX(accounts, 'a', '2').ok).toBe(false)
    expect(canBindAccountToX(accounts, 'b', '2').ok).toBe(true)
    expect(canBindAccountToX(accounts, 'missing', '3').ok).toBe(false)

    const many: BoundAccountView[] = []
    for (let i = 0; i < MAX_BOUND_X_ACCOUNTS; i++) {
      many.push(
        acct({
          id: `id${i}`,
          pubkey: i.toString(16).padStart(64, '0'),
          boundTwitterId: String(1000 + i),
          boundUpdatedAt: i,
        }),
      )
    }
    many.push(acct({ id: 'extra', pubkey: 'ff'.repeat(32) }))
    expect(countBoundAccounts(many)).toBe(MAX_BOUND_X_ACCOUNTS)
    const capped = canBindAccountToX(many, 'extra', '9999')
    expect(capped.ok).toBe(false)
    if (!capped.ok) expect(capped.conflict).toBe('at-cap')
  })

  it('picks first unbound writable account', () => {
    const accounts = [
      acct({ id: 'ro', pubkey: '11'.repeat(32), readOnly: true }),
      acct({ id: 'bound', pubkey: '22'.repeat(32), boundTwitterId: '9' }),
      { ...acct({ id: 'npub', pubkey: '33'.repeat(32) }), type: 'npub' },
      acct({ id: 'free', pubkey: '44'.repeat(32) }),
      acct({ id: 'free2', pubkey: '55'.repeat(32) }),
    ]
    expect(firstBindableNostrAccount(accounts)?.id).toBe('free')
    expect(isBindableNostrAccount(accounts[0]!)).toBe(false)
    expect(isBindableNostrAccount(accounts[3]!)).toBe(true)
  })

  it('finds by bound twitter id', () => {
    const accounts = [
      acct({ id: 'a', pubkey: 'aa'.repeat(32), boundTwitterId: '7' }),
    ]
    expect(findAccountByBoundTwitterId(accounts, '7')?.id).toBe('a')
    expect(findAccountByBoundTwitterId(accounts, '8')).toBeUndefined()
  })

  it('merges sync and local with latest updatedAt wins', () => {
    const local = [
      acct({
        id: 'a',
        pubkey: 'aa'.repeat(32),
        boundTwitterId: '1',
        boundUpdatedAt: 100,
      }),
      acct({
        id: 'b',
        pubkey: 'bb'.repeat(32),
        boundTwitterId: null,
        boundUpdatedAt: null,
      }),
    ]
    const merged = mergeBindingsLatestWins({
      local,
      syncByTwitterId: {
        '1': { pubkey: 'bb'.repeat(32), updatedAt: 200 },
      },
      now: 200,
    })
    expect(merged.changed).toBe(true)
    expect(merged.accounts.find((a) => a.id === 'b')?.boundTwitterId).toBe('1')
    expect(merged.accounts.find((a) => a.id === 'a')?.boundTwitterId).toBeNull()
    expect(merged.syncByTwitterId['1']?.pubkey).toBe('bb'.repeat(32))
  })
})
