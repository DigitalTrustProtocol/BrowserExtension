import { describe, expect, it } from 'vitest'
import { parseSeedDocument } from './seed.ts'

const older = {
  id: 'bb'.repeat(32),
  pubkey: 'aa'.repeat(32),
  created_at: 20,
  kind: 1,
  tags: [] as string[][],
  content: 'later-id',
  sig: 'cc'.repeat(64),
  firstSeenAt: 9,
  addressKey: 'local',
}

const newer = {
  id: 'aa'.repeat(32),
  pubkey: 'aa'.repeat(32),
  created_at: 10,
  kind: 1,
  tags: [['t', 'x']],
  content: 'earlier',
  sig: 'dd'.repeat(64),
}

describe('parseSeedDocument', () => {
  it('reads a JSON array, drops local fields, and sorts by time then id', () => {
    const parsed = parseSeedDocument(JSON.stringify([older, newer]))
    expect(parsed.malformed).toBe(0)
    expect(parsed.events.map((event) => event.id)).toEqual([newer.id, older.id])
    expect(parsed.events[1]).toEqual({
      id: older.id,
      pubkey: older.pubkey,
      created_at: older.created_at,
      kind: older.kind,
      tags: [],
      content: older.content,
      sig: older.sig,
    })
    expect(parsed.events[1]).not.toHaveProperty('firstSeenAt')
    expect(parsed.events[1]).not.toHaveProperty('addressKey')
  })

  it('reads an events wrapper and counts malformed rows', () => {
    const parsed = parseSeedDocument(
      JSON.stringify({ events: [newer, { id: 'nope' }, null] }),
    )
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]?.content).toBe('earlier')
    expect(parsed.malformed).toBe(2)
  })

  it('rejects a document that is not an event list', () => {
    expect(() => parseSeedDocument('{"users":[]}')).toThrow(/JSON array/)
    expect(() => parseSeedDocument('not json')).toThrow(/JSON/)
  })
})
