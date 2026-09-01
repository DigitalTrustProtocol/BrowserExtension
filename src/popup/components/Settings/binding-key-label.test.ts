import { describe, expect, it } from 'vitest'
import {
  boundHandlesForAccount,
  nostrBindingOptionLabel,
} from './binding-key-label.ts'

const NPUB_HEX = 'aa'.repeat(32)

describe('nostrBindingOptionLabel', () => {
  it('returns truncated npub when the key is unbound and unnamed', () => {
    const account = { id: '1', pubkey: NPUB_HEX }
    expect(nostrBindingOptionLabel(account, [])).toMatch(/^npub1/)
    expect(nostrBindingOptionLabel(account, [])).not.toContain('·')
  })

  it('uses the local key title when present', () => {
    const account = { id: '1', pubkey: NPUB_HEX, name: 'Nostr Key 1' }
    expect(nostrBindingOptionLabel(account, [])).toBe('Nostr Key 1')
  })

  it('appends a generated read-only suffix', () => {
    const account = {
      id: '1',
      pubkey: NPUB_HEX,
      name: 'Nostr Key 1',
      readOnly: true,
    }
    const label = nostrBindingOptionLabel(account, [])
    expect(label.startsWith('Nostr Key 1 - (')).toBe(true)
    expect(label.endsWith(')')).toBe(true)
  })

  it('appends bound handles when the key is already paired', () => {
    const account = {
      id: '1',
      pubkey: NPUB_HEX,
      boundTwitterIds: ['42', '99'],
    }
    const rows = [
      { twitterId: '42', handle: 'alice', accountId: '1' },
      { twitterId: '99', handle: 'bob', accountId: '1' },
    ]
    const label = nostrBindingOptionLabel(
      { ...account, name: 'Nostr Key 1' },
      rows,
    )
    expect(label).toContain('Nostr Key 1')
    expect(label).toContain('@alice')
    expect(label).toContain('@bob')
    expect(boundHandlesForAccount(account, rows)).toEqual(['@alice', '@bob'])
  })
})
