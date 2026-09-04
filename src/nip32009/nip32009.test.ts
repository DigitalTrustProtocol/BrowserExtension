import { describe, expect, it } from 'vitest'
import {
  asTrustEvent,
  asTrustSlotEvent,
  isTrustEventValid,
  KIND_TRUST,
  slotAddressableId,
  statementToTrustEvent,
} from './nip32009'
import type { EventRecord } from '../storage/types'

function record(
  overrides: Partial<EventRecord> & Pick<EventRecord, 'tags'>,
): EventRecord {
  return {
    id: 'aa'.repeat(32),
    pubkey: 'bb'.repeat(32),
    created_at: 10,
    kind: KIND_TRUST,
    content: '',
    sig: 'cc'.repeat(64),
    firstSeenAt: 1,
    addressKey: 'k',
    ...overrides,
  }
}

describe('asTrustEvent', () => {
  it('fills heap fields from a stored 32009 winner', () => {
    const pubkey = 'ab'.repeat(32)
    const subject = 'cd'.repeat(32)
    const event = asTrustEvent(
      record({
        pubkey,
        tags: [
          ['d', 'ff'.repeat(32)],
          ['p', subject],
          ['v', '1'],
          ['c', 'identity'],
        ],
      }),
    )
    expect(event).toMatchObject({
      kind: KIND_TRUST,
      pubkey,
      value: 1,
      c_tag: 'identity',
      eventId: 'aa'.repeat(32),
      subjects: [{ tag: 'p', value: subject }],
    })
    expect(event?.addressableId).toBe(
      slotAddressableId(pubkey, { type: 'p', value: subject }, 'identity'),
    )
    expect(event && isTrustEventValid(event)).toBe(true)
  })

  it('skips tombstones with empty v', () => {
    const tombstone = record({
      tags: [
        ['d', 'ff'.repeat(32)],
        ['p', 'cd'.repeat(32)],
        ['v', ''],
      ],
    })
    expect(asTrustEvent(tombstone)).toBeUndefined()
    const slot = asTrustSlotEvent(tombstone)
    expect(slot?.addressableId).toBe(
      slotAddressableId(
        tombstone.pubkey,
        { type: 'p', value: 'cd'.repeat(32) },
        '',
      ),
    )
    expect(slot?.eventId).toBe(tombstone.id)
  })

  it('statementToTrustEvent is heap-assignable', () => {
    const trust = statementToTrustEvent({
      eventId: 'evt',
      author: 'aa'.repeat(32),
      subject: { type: 'i', value: 'user:id:1' },
      context: 'identity',
      value: -1,
      createdAt: 5,
    })
    expect(trust.kind).toBe(KIND_TRUST)
    expect(trust.value).toBe(-1)
    expect(trust.subjects[0]).toEqual({ tag: 'i', value: 'user:id:1' })
    expect(isTrustEventValid(trust)).toBe(true)
  })
})
