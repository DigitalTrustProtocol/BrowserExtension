import { describe, expect, it } from 'vitest'
import { npubFromPubkey } from '../identity/x-identity-row.ts'
import {
  defaultKeyTitleNumber,
  KEY_TITLE_MAX_LENGTH,
  accountIsReadOnly,
  formatKeyTitle,
  keyTitleFromXIdentities,
  nextDefaultKeyName,
  normalizeKeyTitle,
  resolveNewKeyName,
} from './key-title.ts'

const PUBKEY = 'aa'.repeat(32)

describe('nextDefaultKeyName', () => {
  it('starts at Nostr Key 1', () => {
    expect(nextDefaultKeyName([])).toBe('Nostr Key 1')
    expect(nextDefaultKeyName(['Main', 'Work'])).toBe('Nostr Key 1')
  })

  it('uses max matching N plus one, not count plus one', () => {
    expect(nextDefaultKeyName(['Nostr Key 1', 'Nostr Key 2'])).toBe('Nostr Key 3')
    expect(nextDefaultKeyName(['Nostr Key 2'])).toBe('Nostr Key 3')
    expect(nextDefaultKeyName(['Main Key 1', 'Derivative key 2'])).toBe(
      'Nostr Key 3',
    )
    expect(nextDefaultKeyName(['Nostr Key 1 backup', 'Nostr Key 1'])).toBe(
      'Nostr Key 2',
    )
  })

  it('is case-insensitive on the factory pattern', () => {
    expect(nextDefaultKeyName(['nostr key 4'])).toBe('Nostr Key 5')
  })
})

describe('defaultKeyTitleNumber', () => {
  it('reads the factory sequence and ignores renamed titles', () => {
    expect(defaultKeyTitleNumber('Nostr Key 1')).toBe(1)
    expect(defaultKeyTitleNumber('nostr key 12')).toBe(12)
    expect(defaultKeyTitleNumber('Main Key 1')).toBe(1)
    expect(defaultKeyTitleNumber('Derivative key 2')).toBe(2)
    expect(defaultKeyTitleNumber('Work')).toBeUndefined()
    expect(defaultKeyTitleNumber('Nostr Key 1 backup')).toBeUndefined()
  })
})

describe('normalizeKeyTitle', () => {
  it('trims and rejects empty or too-long names', () => {
    expect(normalizeKeyTitle('  Work  ')).toEqual({ ok: true, name: 'Work' })
    expect(normalizeKeyTitle('   ')).toEqual({ ok: false, error: 'empty' })
    expect(normalizeKeyTitle('x'.repeat(KEY_TITLE_MAX_LENGTH + 1))).toEqual({
      ok: false,
      error: 'tooLong',
    })
  })
})

describe('resolveNewKeyName', () => {
  it('prefers a non-empty override and caps length', () => {
    expect(resolveNewKeyName(['Nostr Key 1'], 'Alt')).toBe('Alt')
    expect(resolveNewKeyName([], '  ')).toBe('Nostr Key 1')
    expect(resolveNewKeyName([], 'y'.repeat(KEY_TITLE_MAX_LENGTH + 3))).toHaveLength(
      KEY_TITLE_MAX_LENGTH,
    )
  })
})

describe('formatKeyTitle', () => {
  it('appends a generated read-only suffix', () => {
    expect(formatKeyTitle('Nostr Key 1', false, 'Read only')).toBe('Nostr Key 1')
    expect(formatKeyTitle('Nostr Key 1', true, 'Read only')).toBe(
      'Nostr Key 1 - (Read only)',
    )
    expect(formatKeyTitle('  ', true, 'Read only', 'npub1abc')).toBe(
      'npub1abc - (Read only)',
    )
  })
})

describe('accountIsReadOnly', () => {
  it('treats npub type as read-only', () => {
    expect(accountIsReadOnly({ readOnly: true })).toBe(true)
    expect(accountIsReadOnly({ type: 'npub' })).toBe(true)
    expect(accountIsReadOnly({ type: 'nsec', readOnly: false })).toBe(false)
  })
})

describe('keyTitleFromXIdentities', () => {
  it('uses displayName when the winning npub matches', () => {
    const npub = npubFromPubkey(PUBKEY)
    expect(npub).toBeTruthy()
    expect(
      keyTitleFromXIdentities(PUBKEY, [
        { twitterId: '1', xNpub: npub, displayName: 'Alice' },
      ]),
    ).toBe('Alice')
  })

  it('ignores rows whose winning npub is a different key', () => {
    expect(
      keyTitleFromXIdentities(PUBKEY, [
        {
          twitterId: '1',
          xNpub: 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq5s8x3',
          displayName: 'Other',
        },
      ]),
    ).toBeUndefined()
  })
})
