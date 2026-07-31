import 'fake-indexeddb/auto'
import { finalizeEvent } from 'nostr-tools'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ATTENTIONX_DB_VERSION,
  AttentionXRepository,
  deleteAttentionXDatabase,
  eventAddress,
  openAttentionXDatabase,
  type SignedNostrEvent,
} from './index'

const databaseNames: string[] = []
const repositories: AttentionXRepository[] = []
let databaseSequence = 0

function databaseName(label: string): string {
  const name = `attentionx-storage-${label}-${databaseSequence++}`
  databaseNames.push(name)
  return name
}

async function openRepository(name: string): Promise<AttentionXRepository> {
  const repository = await AttentionXRepository.open({ name })
  repositories.push(repository)
  return repository
}

function event(
  id: string,
  options: {
    kind?: number
    pubkey?: string
    createdAt?: number
    tags?: string[][]
  } = {},
): SignedNostrEvent {
  return {
    id,
    pubkey: options.pubkey ?? 'alice',
    created_at: options.createdAt ?? 100,
    kind: options.kind ?? 32009,
    tags: options.tags ?? [['d', `subject-${id}`]],
    content: '',
    sig: id.padEnd(128, '0'),
  }
}

const TEST_SECRET_KEY = new Uint8Array(32).fill(1)
const TEST_SUBJECT_PUBKEY = '1'.repeat(64)
const TEST_TRUST_D =
  '89593026e54980be87e62f12699023e54aa8dc00c726297c5d1ee1ddf85006bd'

function validEvent(
  options: {
    kind?: number
    createdAt?: number
    tags?: string[][]
    content?: string
  } = {},
): SignedNostrEvent {
  return finalizeEvent(
    {
      kind: options.kind ?? 32009,
      created_at: options.createdAt ?? 100,
      tags:
        options.tags ??
        (options.kind === 10011
          ? []
          : [
              ['d', TEST_TRUST_D],
              ['p', TEST_SUBJECT_PUBKEY],
              ['v', '1'],
            ]),
      content: options.content ?? '',
    },
    TEST_SECRET_KEY,
  )
}

function createLegacyDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => {
      const events = request.result.createObjectStore('events', {
        keyPath: 'id',
      })
      events.put({ ...event('legacy'), firstSeenAt: 50 })
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Legacy database open blocked'))
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
  })
}

function createV2DatabaseWithCollidingTagKeys(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 2)
    request.onupgradeneeded = () => {
      const database = request.result
      const events = database.createObjectStore('events', { keyPath: 'id' })
      events.createIndex('kind', 'kind')
      events.createIndex('pubkey', 'pubkey')
      events.createIndex('created_at', 'created_at')
      events.put({
        ...event('collision', {
          tags: [
            ['a', 'b:c'],
            ['a:b', 'c'],
          ],
        }),
        firstSeenAt: 50,
      })

      const addresses = database.createObjectStore('addresses', {
        keyPath: 'address',
      })
      addresses.createIndex('eventId', 'eventId')
      const tagIndex = database.createObjectStore('tagIndex', {
        keyPath: 'key',
      })
      tagIndex.createIndex('byTag', ['kind', 'tagName', 'tagValue'])
      tagIndex.createIndex('eventId', 'eventId')
      tagIndex.put({
        key: '32009:a:b:c:collision',
        eventId: 'collision',
        kind: 32009,
        tagName: 'a:b',
        tagValue: 'c',
      })
      const observations = database.createObjectStore('relayObservations', {
        keyPath: 'key',
      })
      observations.createIndex('relayUrl', 'relayUrl')
      observations.createIndex('eventId', 'eventId')
      const cursors = database.createObjectStore('syncCursors', {
        keyPath: 'key',
      })
      cursors.createIndex('relayUrl', 'relayUrl')
      cursors.createIndex('nextRetryAt', 'retry.nextRetryAt')
      database.createObjectStore('xIdentities', { keyPath: 'twitterId' })
      const aliases = database.createObjectStore('handleAliases', {
        keyPath: 'handle',
      })
      aliases.createIndex('twitterId', 'twitterId')
      aliases.createIndex('expiresAt', 'expiresAt')
      const outbox = database.createObjectStore('outbox', {
        keyPath: 'eventId',
      })
      outbox.createIndex('updatedAt', 'updatedAt')
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('V2 database open blocked'))
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
  })
}

afterEach(async () => {
  for (const repository of repositories.splice(0)) {
    repository.close()
  }
  for (const name of databaseNames.splice(0)) {
    await deleteAttentionXDatabase(name)
  }
})

describe('AttentionX IndexedDB schema', () => {
  it('migrates a v1 database and can be reopened safely', async () => {
    const name = databaseName('migration')
    await createLegacyDatabase(name)

    const database = await openAttentionXDatabase({ name })
    expect(database.version).toBe(ATTENTIONX_DB_VERSION)
    expect(Array.from(database.objectStoreNames)).toEqual([
      'events',
      'outbox',
      'relayErrorLog',
      'relayHealth',
      'relayObservations',
      'syncCursors',
      'xIdentities',
    ])
    const events = database.transaction('events').store
    expect(Array.from(events.indexNames).sort()).toEqual([
      'addressKey',
      'created_at',
      'kind',
      'pubkey',
      'state',
    ])
    const legacy = await events.get('legacy')
    expect(legacy?.firstSeenAt).toBe(50)
    expect(legacy?.addressKey).toBe(eventAddress(32009, 'alice', 'subject-legacy'))
    database.close()

    const reopened = await openAttentionXDatabase({ name })
    expect(reopened.version).toBe(ATTENTIONX_DB_VERSION)
    expect(await reopened.get('events', 'legacy')).toBeDefined()
    reopened.close()
  })

  it('backfills addressKey and demo state while dropping legacy stores', async () => {
    const name = databaseName('v6-migration')
    await createV2DatabaseWithCollidingTagKeys(name)

    const repository = await openRepository(name)
    const stored = await repository.getEvent('collision')
    expect(stored?.addressKey).toBe(eventAddress(32009, 'alice', ''))
    expect(await repository.getEventIdByAddressKey(stored!.addressKey)).toBe(
      'collision',
    )
  })

  it('drops handle-keyed alias, observation, and resolution-cache stores at v7', async () => {
    const name = databaseName('v7-migration')
    await createV2DatabaseWithCollidingTagKeys(name)

    const database = await openAttentionXDatabase({ name })
    expect(database.version).toBe(ATTENTIONX_DB_VERSION)
    expect(Array.from(database.objectStoreNames).sort()).toEqual([
      'events',
      'outbox',
      'relayErrorLog',
      'relayHealth',
      'relayObservations',
      'syncCursors',
      'xIdentities',
    ])
    const identities = database.transaction('xIdentities').store
    expect(Array.from(identities.indexNames).sort()).toEqual([
      'handle',
      'lastSeen',
      'nip39Npub',
    ])
    database.close()
  })
})

describe('AttentionXRepository events and identity records', () => {
  it('persists events, addressKey slots, replacements, and observations', async () => {
    const repository = await openRepository(databaseName('events'))
    const first = event('one', {
      kind: 32009,
      pubkey: 'alice',
      createdAt: 100,
      tags: [
        ['d', 'subject'],
        ['p', 'bob'],
      ],
    })
    const second = event('two', {
      kind: 10011,
      pubkey: 'bob',
      createdAt: 200,
    })
    const address = eventAddress(first.kind, first.pubkey, 'subject')

    await repository.ingestEvent({
      event: first,
      firstSeenAt: 20,
      relayUrl: 'wss://relay.example',
      observedAt: 20,
    })
    await repository.ingestEvent({
      event: first,
      firstSeenAt: 30,
      relayUrl: 'wss://relay.example',
      observedAt: 40,
    })
    await repository.ingestEvent({ event: second, firstSeenAt: 25 })

    expect((await repository.getEvent('one'))?.firstSeenAt).toBe(20)
    expect((await repository.getEvent('one'))?.addressKey).toBe(address)
    expect(await repository.getEventsByKind(32009)).toHaveLength(1)
    expect(await repository.getEventsByPubkey('bob')).toEqual([
      expect.objectContaining({ id: 'two' }),
    ])
    expect(await repository.getEventsCreatedBetween(90, 150)).toEqual([
      expect.objectContaining({ id: 'one' }),
    ])
    expect(await repository.getEventIdByAddressKey(address)).toBe('one')
    expect(
      await repository.getRelayObservation(
        'wss://relay.example',
        first.id,
      ),
    ).toMatchObject({ firstSeenAt: 20, lastSeenAt: 40 })

    const replacement = event('one-newer', {
      kind: 32009,
      pubkey: 'alice',
      createdAt: 150,
      tags: [
        ['d', 'subject'],
        ['p', 'bob'],
      ],
    })
    await repository.ingestEvent({ event: replacement, firstSeenAt: 50 })
    expect(await repository.getEvent('one')).toBeUndefined()
    expect(await repository.getEventIdByAddressKey(address)).toBe('one-newer')

    expect(await repository.deleteEvent('one-newer')).toBe(true)
    expect(await repository.getEvent('one-newer')).toBeUndefined()
    expect(await repository.getEventIdByAddressKey(address)).toBeUndefined()
    expect(
      await repository.getRelayObservation(
        'wss://relay.example',
        first.id,
      ),
    ).toBeUndefined()
  })

  it('stores demo state and lists demo events by state index', async () => {
    const repository = await openRepository(databaseName('demo-state'))
    const demo = event('demo-1', {
      tags: [
        ['d', 'demo-slot'],
        ['test', 'attentionx-demo'],
      ],
    })
    await repository.ingestEvent({ event: demo, state: 'demo' })
    expect((await repository.getEvent('demo-1'))?.state).toBe('demo')
    expect(await repository.getEventIdsByState('demo')).toEqual(['demo-1'])
    expect((await repository.getEvent('demo-1'))?.addressKey).toMatch(/:demo$/)
  })

  it('keeps demo and production events on distinct addressable slots', async () => {
    const repository = await openRepository(databaseName('demo-slot-ns'))
    const production = event('prod-1', {
      pubkey: 'aa'.repeat(32),
      tags: [['d', 'same-slot']],
    })
    const demo = event('demo-2', {
      pubkey: 'aa'.repeat(32),
      createdAt: 200,
      tags: [
        ['d', 'same-slot'],
        ['test', 'attentionx-demo'],
      ],
    })
    await repository.ingestEvent({ event: production })
    await repository.ingestEvent({ event: demo, state: 'demo' })
    expect(await repository.getEvent('prod-1')).toBeDefined()
    expect(await repository.getEvent('demo-2')).toBeDefined()
    expect((await repository.getEvent('prod-1'))?.addressKey).not.toMatch(
      /:demo$/,
    )
    expect((await repository.getEvent('demo-2'))?.addressKey).toMatch(/:demo$/)
  })

  it('stores identities keyed by twitterId with a normalized handle', async () => {
    const repository = await openRepository(databaseName('identity'))
    await repository.putXIdentity({
      twitterId: '11348282',
      handle: 'NASA',
      xProofNpub: 'npub1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      xProofPostId: 'post-1',
      nip39Npub: 'npub1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      nip39XId: '11348282',
      nip39PostId: 'post-1',
      state: 'verified',
      verifiedAt: 100,
      createdAt: 100,
      updatedAt: 100,
      lastSeen: 100,
    })

    expect(await repository.getXIdentity('11348282')).toMatchObject({
      handle: 'nasa',
      state: 'verified',
    })
    await repository.deleteXIdentity('11348282')
    expect(await repository.getXIdentity('11348282')).toBeUndefined()
  })

  it('clears the handle from the previous owner when it is reclaimed', async () => {
    const repository = await openRepository(databaseName('handle-reclaim'))
    await repository.putXIdentity({
      twitterId: 'one',
      handle: 'nasa',
      state: 'unverified',
      createdAt: 100,
      updatedAt: 100,
      lastSeen: 100,
    })

    await repository.putXIdentity({
      twitterId: 'two',
      handle: 'nasa',
      state: 'unverified',
      createdAt: 200,
      updatedAt: 200,
      lastSeen: 200,
    })

    expect(await repository.getXIdentity('one')).toMatchObject({
      handle: '',
      updatedAt: 200,
    })
    expect(await repository.getXIdentity('two')).toMatchObject({
      handle: 'nasa',
    })
  })

  it('bumps lastSeen on every touch without requiring updatedAt to change', async () => {
    const repository = await openRepository(databaseName('last-seen'))
    await repository.putXIdentity({
      twitterId: 'one',
      handle: 'nasa',
      state: 'unverified',
      createdAt: 100,
      updatedAt: 100,
      lastSeen: 100,
    })

    await repository.putXIdentity({
      twitterId: 'one',
      handle: 'nasa',
      state: 'unverified',
      createdAt: 100,
      updatedAt: 100,
      lastSeen: 200,
    })

    expect(await repository.getXIdentity('one')).toMatchObject({
      updatedAt: 100,
      lastSeen: 200,
    })
  })

  it('lists flat identities and clears or revokes nip39 bindings by npub', async () => {
    const repository = await openRepository(databaseName('identity-flat'))
    const npubTarget =
      'npub1targetaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const npubOther =
      'npub1otheraaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const baseIdentity = {
      createdAt: 100,
      updatedAt: 100,
      lastSeen: 100,
    }
    await repository.putXIdentity({
      ...baseIdentity,
      twitterId: 'one',
      handle: 'handle-one',
      xProofNpub: npubTarget,
      xProofPostId: 'post-one',
      nip39Npub: npubTarget,
      nip39XId: 'one',
      nip39PostId: 'post-one',
      nip39EventId: 'event-one',
      state: 'verified',
      verifiedAt: 100,
    })
    await repository.putXIdentity({
      ...baseIdentity,
      twitterId: 'two',
      handle: 'handle-two',
      xProofNpub: npubTarget,
      xProofPostId: 'post-two',
      nip39Npub: npubTarget,
      nip39XId: 'two',
      nip39PostId: 'post-two',
      nip39EventId: 'event-two',
      state: 'verified',
      verifiedAt: 100,
    })
    await repository.putXIdentity({
      ...baseIdentity,
      twitterId: 'three',
      handle: 'handle-three',
      xProofNpub: npubOther,
      xProofPostId: 'post-three',
      nip39Npub: npubOther,
      nip39XId: 'three',
      nip39PostId: 'post-three',
      state: 'verified',
      verifiedAt: 100,
    })

    expect(await repository.getAllXIdentities()).toHaveLength(3)
    expect(
      await repository.getXIdentitiesByNip39Npub(npubTarget),
    ).toHaveLength(2)

    expect(await repository.revokeXIdentityByNip39Npub(npubTarget, 200)).toBe(2)
    expect(await repository.getXIdentity('one')).toMatchObject({
      state: 'revoked',
      nip39Npub: npubTarget,
      updatedAt: 200,
    })
    expect(await repository.getXIdentity('two')).toMatchObject({
      state: 'revoked',
      updatedAt: 200,
    })
    expect(await repository.getXIdentity('three')).toMatchObject({
      state: 'verified',
    })

    expect(await repository.clearNip39BindingByNpub(npubTarget, 300)).toBe(2)
    expect(await repository.getXIdentity('one')).toMatchObject({
      // Status is left for callers to re-derive via sync.
      state: 'revoked',
      updatedAt: 300,
      xProofNpub: npubTarget,
      xProofPostId: 'post-one',
    })
    expect(await repository.getXIdentity('one')).not.toHaveProperty('nip39Npub')
    expect(await repository.getXIdentitiesByNip39Npub(npubTarget)).toHaveLength(
      0,
    )
    expect(await repository.getXIdentity('three')).toMatchObject({
      nip39Npub: npubOther,
      state: 'verified',
    })
  })
})

describe('AttentionXRepository durable synchronization state', () => {
  it('restores due outbox work after a repository restart', async () => {
    const name = databaseName('outbox')
    const firstRepository = await openRepository(name)
    await firstRepository.storeEventAndEnqueue(
      event('publish'),
      ['wss://one.example', 'wss://two.example'],
      100,
    )
    await firstRepository.recordOutboxAttempt(
      'publish',
      'wss://one.example',
      { ok: true },
      110,
    )
    await firstRepository.recordOutboxAttempt(
      'publish',
      'wss://two.example',
      { ok: false, error: 'offline', nextAttemptAt: 200 },
      120,
    )
    firstRepository.close()

    const recovered = await openRepository(name)
    expect(await recovered.getDueOutbox(199)).toEqual([])
    expect(await recovered.getDueOutbox(200)).toEqual([
      expect.objectContaining({
        eventId: 'publish',
        relays: {
          'wss://one.example': expect.objectContaining({
            status: 'published',
          }),
          'wss://two.example': expect.objectContaining({
            status: 'failed',
            attempts: 1,
            nextAttemptAt: 200,
          }),
        },
      }),
    ])
    expect(await recovered.getEvent('publish')).toBeDefined()
  })

  it('stores addressKey on the event during the outbox transaction', async () => {
    const repository = await openRepository(databaseName('atomic-address'))
    const signed = event('addressed')
    const address = eventAddress(signed.kind, signed.pubkey, 'subject-addressed')
    await repository.storeEventAndEnqueue(
      signed,
      ['wss://relay.example'],
      { now: 100 },
    )

    expect(await repository.getEvent('addressed')).toMatchObject({
      id: 'addressed',
      addressKey: address,
    })
    expect(await repository.getOutbox('addressed')).toBeDefined()
    expect(await repository.getEventIdByAddressKey(address)).toBe('addressed')
  })

  it('excludes exhausted relays and orders due work deterministically', async () => {
    const repository = await openRepository(databaseName('outbox-order'))
    await repository.enqueueOutbox('exhausted', ['wss://relay.example'], 1)
    await repository.recordOutboxAttempt(
      'exhausted',
      'wss://relay.example',
      { ok: false, exhausted: true, error: 'retry limit' },
      2,
    )
    await repository.enqueueOutbox('z-event', ['wss://relay.example'], 10)
    await repository.enqueueOutbox('a-event', ['wss://relay.example'], 10)
    await repository.enqueueOutbox('future', ['wss://relay.example'], 100)
    await repository.recordOutboxAttempt(
      'z-event',
      'wss://relay.example',
      { ok: false, nextAttemptAt: 50 },
      20,
    )
    await repository.recordOutboxAttempt(
      'a-event',
      'wss://relay.example',
      { ok: false, nextAttemptAt: 50 },
      20,
    )

    expect(
      (await repository.getOutbox('exhausted'))?.relays[
        'wss://relay.example'
      ],
    ).toMatchObject({ status: 'exhausted', attempts: 1 })
    expect((await repository.getDueOutbox(50)).map(({ eventId }) => eventId)).toEqual(
      ['a-event', 'z-event'],
    )
  })

  it('round-trips cursor retry state', async () => {
    const repository = await openRepository(databaseName('cursor'))
    await repository.putSyncCursor({
      relayUrl: 'wss://relay.example',
      scopeHash: 'following',
      lastSeenCreatedAt: 1234,
      lastEoseAt: 1300,
      retry: {
        attempts: 2,
        nextRetryAt: 1400,
        lastError: 'timeout',
      },
      updatedAt: 1350,
    })

    expect(
      await repository.getSyncCursor(
        'wss://relay.example',
        'following',
      ),
    ).toMatchObject({
      lastSeenCreatedAt: 1234,
      retry: { attempts: 2, nextRetryAt: 1400 },
    })
    expect(
      await repository.getSyncCursorsForRelay('wss://relay.example'),
    ).toHaveLength(1)
    await repository.deleteSyncCursor(
      'wss://relay.example',
      'following',
    )
    expect(
      await repository.getSyncCursor(
        'wss://relay.example',
        'following',
      ),
    ).toBeUndefined()
  })
})

describe('AttentionXRepository raw event portability', () => {
  it('exports and imports raw signed events with their first-seen time', async () => {
    const source = await openRepository(databaseName('export-source'))
    const portable = validEvent()
    await source.ingestEvent({
      event: portable,
      firstSeenAt: 77,
    })
    const rawExport = await source.exportRawEvents(1000)

    const destination = await openRepository(
      databaseName('export-destination'),
    )
    expect(await destination.importRawEvents(rawExport)).toEqual({
      imported: 1,
      duplicates: 0,
      rejected: 0,
    })
    expect(await destination.importRawEvents(rawExport)).toEqual({
      imported: 0,
      duplicates: 1,
      rejected: 0,
    })
    expect(await destination.getEvent(portable.id)).toEqual(
      expect.objectContaining({
        id: portable.id,
        sig: portable.sig,
        firstSeenAt: 77,
        addressKey: eventAddress(32009, portable.pubkey, TEST_TRUST_D),
      }),
    )
  })

  it('rejects malformed, tampered, unsigned, and unsupported raw events', async () => {
    const repository = await openRepository(databaseName('invalid-import'))
    const valid = validEvent()
    const validNip39 = validEvent({ kind: 10011, tags: [] })
    const unsupported = validEvent({ kind: 1 })
    const tamperedHash = {
      ...valid,
      id: '0'.repeat(64),
    }
    const invalidSignature = {
      ...valid,
      sig: '0'.repeat(128),
    }
    const invalidProtocol = validEvent({
      tags: [['d', TEST_SUBJECT_PUBKEY]],
    })
    const result = await repository.importRawEvents({
      format: 'attentionx-raw-events',
      version: 1,
      exportedAt: 1000,
      events: [
        { ...valid, firstSeenAt: 10 },
        { ...validNip39, firstSeenAt: 10 },
        { ...tamperedHash, firstSeenAt: 11 },
        { ...invalidSignature, firstSeenAt: 12 },
        { ...unsupported, firstSeenAt: 13 },
        { ...invalidProtocol, firstSeenAt: 14 },
        { id: 'malformed' } as never,
      ] as never,
    })

    expect(result).toEqual({ imported: 2, duplicates: 0, rejected: 5 })
    expect((await repository.getAllEvents()).map(({ id }) => id).sort()).toEqual(
      [valid.id, validNip39.id].sort(),
    )
  })
})
