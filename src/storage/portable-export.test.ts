import { describe, expect, it } from 'vitest'
import { DEMO_EVENT_STATE } from './demo-event-state'
import {
  exportedSettings,
  localDataExportManifest,
  portableTables,
  toPortableEvent,
  LOCAL_DATA_EXPORT_FORMAT,
} from './portable-export'
import type { EventRecord } from './types'

function record(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: 'ab'.repeat(32),
    pubkey: 'cd'.repeat(32),
    created_at: 100,
    kind: 32009,
    tags: [['d', 'slot'], ['i', 'user:id:1']],
    content: '',
    sig: 'ef'.repeat(64),
    firstSeenAt: 1_700_000_000_000,
    addressKey: '32009:cd:slot',
    subject: 'user:id:1',
    subjectType: 'i',
    ...overrides,
  }
}

describe('portable event export', () => {
  it('keeps the signed fields and drops local columns', () => {
    const portable = toPortableEvent(record())
    expect(portable).toEqual({
      id: 'ab'.repeat(32),
      pubkey: 'cd'.repeat(32),
      created_at: 100,
      kind: 32009,
      tags: [['d', 'slot'], ['i', 'user:id:1']],
      content: '',
      sig: 'ef'.repeat(64),
    })
    expect(portable).not.toHaveProperty('firstSeenAt')
    expect(portable).not.toHaveProperty('addressKey')
    expect(portable).not.toHaveProperty('subject')
  })

  it('omits demo rows', () => {
    const tables = portableTables({
      events: [record(), record({ id: '11'.repeat(32), state: DEMO_EVENT_STATE })],
      xIdentities: [],
      xPosts: [],
    })
    expect(tables.skippedDemo).toBe(1)
    expect(tables.events).toHaveLength(1)
    expect(tables.events[0]?.id).toBe('ab'.repeat(32))
  })
})

describe('exported settings', () => {
  it('drops the legacy secret and keeps the Network relay selection', () => {
    const settings = exportedSettings(
      {
        relays: ['wss://nos.lol'],
        mode: 'production',
        secretKeyHex: 'ab'.repeat(32),
      },
      {
        syncRelays: 'wss://nos.lol,wss://relay.damus.io/, https://not-a-relay',
        inactiveRelays: ['wss://example.custom'],
        relayFlags: {
          'wss://nos.lol': { read: true, write: false },
          'wss://relay.damus.io': { read: 'yes', write: true },
          'wss://example.custom': { read: false },
        },
      },
    )
    expect(settings).not.toHaveProperty('secretKeyHex')
    expect(settings.relays).toEqual(['wss://nos.lol'])
    expect(settings.relaySelection).toEqual({
      active: ['wss://nos.lol', 'wss://relay.damus.io'],
      inactive: ['wss://example.custom'],
      flags: { 'wss://nos.lol': { read: true, write: false } },
    })
  })

  it('writes manifest counts from the portable tables', () => {
    const manifest = localDataExportManifest({
      exportedAt: 10,
      events: [record()],
      skippedDemo: 2,
      xIdentities: [],
      xPosts: [],
    })
    expect(manifest).toEqual({
      format: LOCAL_DATA_EXPORT_FORMAT,
      version: 1,
      exportedAt: 10,
      counts: { events: 1, skippedDemo: 2, xIdentities: 0, xPosts: 0 },
    })
  })
})
