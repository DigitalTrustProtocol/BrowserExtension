import { describe, expect, it } from 'vitest'
import {
  MAX_BOUND_X_ACCOUNTS,
  accountIsBoundTo,
  boundTwitterIdsOf,
  canBindAccountToX,
  countBoundAccounts,
  collectOperatorKnownTwitterIds,
  findAccountByBoundTwitterId,
  firstBindableNostrAccount,
  isBindableNostrAccount,
  mergeBindingsLatestWins,
  normalizeBoundTwitterId,
  toBoundAccountView,
  type BoundAccountView,
} from './x-binding.ts'

function acct(
  partial: Partial<BoundAccountView> & Pick<BoundAccountView, 'id' | 'pubkey'>,
): BoundAccountView {
  const boundTwitterIds =
    partial.boundTwitterIds ??
    (partial.boundTwitterId ? [partial.boundTwitterId] : [])
  return {
    boundUpdatedAt: null,
    readOnly: false,
    boundTwitterId: partial.boundTwitterId ?? boundTwitterIds[0] ?? null,
    ...partial,
    boundTwitterIds:
      partial.boundTwitterIds ??
      (partial.boundTwitterId ? [partial.boundTwitterId] : boundTwitterIds),
  }
}

describe('x-binding', () => {
  it('normalizes twitter ids', () => {
    expect(normalizeBoundTwitterId('42')).toBe('42')
    expect(normalizeBoundTwitterId(' 99 ')).toBe('99')
    expect(normalizeBoundTwitterId('abc')).toBeNull()
    expect(normalizeBoundTwitterId(null)).toBeNull()
  })

  it('unions legacy boundTwitterId with boundTwitterIds', () => {
    expect(boundTwitterIdsOf({ boundTwitterId: '1' })).toEqual(['1'])
    expect(boundTwitterIdsOf({ boundTwitterIds: ['2', '3'] })).toEqual(['2', '3'])
    expect(
      boundTwitterIdsOf({ boundTwitterIds: ['2'], boundTwitterId: '1' }),
    ).toEqual(['2', '1'])
    expect(accountIsBoundTo({ boundTwitterIds: ['7', '8'] }, '8')).toBe(true)
    expect(accountIsBoundTo({ boundTwitterId: '7' }, '8')).toBe(false)
  })

  it('collects operator-known X ids from vault, sync, blobs, and signed-in', () => {
    expect(
      collectOperatorKnownTwitterIds({
        vaultTwitterIds: ['2', '1'],
        syncTwitterIds: ['1', 'abc'],
        blobTwitterIds: ['3'],
        signedInTwitterId: '4',
      }),
    ).toEqual(['1', '2', '3', '4'])
  })

  it('enforces 1 X → 1 Nostr and cap on distinct twitterIds', () => {
    const accounts = [
      acct({
        id: 'a',
        pubkey: 'aa'.repeat(32),
        boundTwitterIds: ['1'],
        boundTwitterId: '1',
        boundUpdatedAt: 10,
      }),
      acct({ id: 'b', pubkey: 'bb'.repeat(32) }),
    ]
    expect(canBindAccountToX(accounts, 'b', '1').ok).toBe(false)
    expect(canBindAccountToX(accounts, 'a', '2').ok).toBe(true)
    expect(canBindAccountToX(accounts, 'b', '2').ok).toBe(true)
    expect(canBindAccountToX(accounts, 'missing', '3').ok).toBe(false)
    expect(
      canBindAccountToX(accounts, 'b', '1', { reassign: true }).ok,
    ).toBe(true)

    const many: BoundAccountView[] = []
    for (let i = 0; i < MAX_BOUND_X_ACCOUNTS; i++) {
      many.push(
        acct({
          id: `id${i}`,
          pubkey: i.toString(16).padStart(64, '0'),
          boundTwitterIds: [String(1000 + i)],
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

  it('counts distinct twitterIds when one Nostr holds many X', () => {
    const accounts = [
      acct({
        id: 'a',
        pubkey: 'aa'.repeat(32),
        boundTwitterIds: ['1', '2', '3'],
        boundTwitterId: '3',
      }),
    ]
    expect(countBoundAccounts(accounts)).toBe(3)
  })

  it('picks first unbound writable account', () => {
    const accounts = [
      acct({ id: 'ro', pubkey: '11'.repeat(32), readOnly: true }),
      acct({
        id: 'bound',
        pubkey: '22'.repeat(32),
        boundTwitterIds: ['9'],
        boundTwitterId: '9',
      }),
      { ...acct({ id: 'npub', pubkey: '33'.repeat(32) }), type: 'npub' },
      acct({ id: 'free', pubkey: '44'.repeat(32) }),
      acct({ id: 'free2', pubkey: '55'.repeat(32) }),
    ]
    expect(firstBindableNostrAccount(accounts)?.id).toBe('free')
    expect(isBindableNostrAccount(accounts[0]!)).toBe(false)
    expect(isBindableNostrAccount(accounts[3]!)).toBe(true)
  })

  it('finds by bound twitter id across a multi-X account', () => {
    const accounts = [
      acct({
        id: 'a',
        pubkey: 'aa'.repeat(32),
        boundTwitterIds: ['7', '8'],
        boundTwitterId: '8',
      }),
    ]
    expect(findAccountByBoundTwitterId(accounts, '7')?.id).toBe('a')
    expect(findAccountByBoundTwitterId(accounts, '8')?.id).toBe('a')
    expect(findAccountByBoundTwitterId(accounts, '9')).toBeUndefined()
  })

  it('merges sync and local with latest updatedAt wins per twitterId', () => {
    const local = [
      acct({
        id: 'a',
        pubkey: 'aa'.repeat(32),
        boundTwitterIds: ['1'],
        boundTwitterId: '1',
        boundUpdatedAt: 100,
      }),
      acct({
        id: 'b',
        pubkey: 'bb'.repeat(32),
        boundTwitterIds: [],
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
    expect(merged.accounts.find((a) => a.id === 'b')?.boundTwitterIds).toEqual([
      '1',
    ])
    expect(merged.accounts.find((a) => a.id === 'a')?.boundTwitterIds).toEqual(
      [],
    )
    expect(merged.syncByTwitterId['1']?.pubkey).toBe('bb'.repeat(32))
  })

  it('keeps two X ids on one pubkey through merge', () => {
    const local = [
      acct({
        id: 'a',
        pubkey: 'aa'.repeat(32),
        boundTwitterIds: ['1'],
        boundTwitterId: '1',
        boundUpdatedAt: 100,
      }),
    ]
    const merged = mergeBindingsLatestWins({
      local,
      syncByTwitterId: {
        '1': { pubkey: 'aa'.repeat(32), updatedAt: 100 },
        '2': { pubkey: 'aa'.repeat(32), updatedAt: 150 },
      },
      now: 150,
    })
    const row = merged.accounts.find((a) => a.id === 'a')
    expect(row?.boundTwitterIds.sort()).toEqual(['1', '2'])
    expect(merged.syncByTwitterId['1']?.pubkey).toBe('aa'.repeat(32))
    expect(merged.syncByTwitterId['2']?.pubkey).toBe('aa'.repeat(32))
  })

  it('toBoundAccountView migrates a legacy single field', () => {
    const view = toBoundAccountView({
      id: 'a',
      pubkey: 'aa'.repeat(32),
      boundTwitterId: '42',
      boundUpdatedAt: 9,
    })
    expect(view.boundTwitterIds).toEqual(['42'])
    expect(view.boundTwitterId).toBe('42')
  })
})
