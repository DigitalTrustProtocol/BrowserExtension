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
      'addresses',
      'events',
      'handleAliases',
      'identityObservations',
      'identityResolutionCache',
      'outbox',
      'relayErrorLog',
      'relayHealth',
      'relayObservations',
      'syncCursors',
      'tagIndex',
      'xIdentities',
    ])
    const events = database.transaction('events').store
    expect(Array.from(events.indexNames)).toEqual([
      'created_at',
      'kind',
      'pubkey',
    ])
    expect((await events.get('legacy'))?.firstSeenAt).toBe(50)
    database.close()

    const reopened = await openAttentionXDatabase({ name })
    expect(reopened.version).toBe(ATTENTIONX_DB_VERSION)
    expect(await reopened.get('events', 'legacy')).toBeDefined()
    reopened.close()
  })

  it('rebuilds collision-free tag keys while migrating v2 data', async () => {
    const name = databaseName('tag-key-migration')
    await createV2DatabaseWithCollidingTagKeys(name)

    const repository = await openRepository(name)
    expect(await repository.getEventIdsByTag(32009, 'a', 'b:c')).toEqual([
      'collision',
    ])
    expect(await repository.getEventIdsByTag(32009, 'a:b', 'c')).toEqual([
      'collision',
    ])
  })
})

describe('AttentionXRepository events and identity records', () => {
  it('persists events, secondary indexes, replacements, and observations', async () => {
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
      address,
    })
    await repository.ingestEvent({
      event: first,
      firstSeenAt: 30,
      relayUrl: 'wss://relay.example',
      observedAt: 40,
    })
    await repository.ingestEvent({ event: second, firstSeenAt: 25 })

    expect((await repository.getEvent('one'))?.firstSeenAt).toBe(20)
    expect(await repository.getEventsByKind(32009)).toHaveLength(1)
    expect(await repository.getEventsByPubkey('bob')).toEqual([
      expect.objectContaining({ id: 'two' }),
    ])
    expect(await repository.getEventsCreatedBetween(90, 150)).toEqual([
      expect.objectContaining({ id: 'one' }),
    ])
    expect(await repository.getEventIdsByTag(32009, 'p', 'bob')).toEqual([
      'one',
    ])
    expect(await repository.getAddressWinner(address)).toBe('one')
    expect(
      await repository.getRelayObservation(
        'wss://relay.example',
        first.id,
      ),
    ).toMatchObject({ firstSeenAt: 20, lastSeenAt: 40 })

    await repository.setAddressWinner(address, second.id, 50)
    expect(await repository.getAddressWinner(address)).toBe('two')

    expect(await repository.deleteEvent('one')).toBe(true)
    expect(await repository.getEvent('one')).toBeUndefined()
    expect(await repository.getEventIdsByTag(32009, 'p', 'bob')).toEqual([])
    expect(
      await repository.getRelayObservation(
        'wss://relay.example',
        first.id,
      ),
    ).toBeUndefined()
    await repository.deleteAddress(address)
    expect(await repository.getAddressWinner(address)).toBeUndefined()
  })

  it('stores identities and resolves normalized, expiring aliases', async () => {
    const repository = await openRepository(databaseName('identity'))
    await repository.putXIdentity({
      twitterId: '11348282',
      handles: ['NASA'],
      xProofNpub: 'npub1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      xProofPostId: 'post-1',
      nip39Npub: 'npub1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      nip39XId: '11348282',
      nip39PostId: 'post-1',
      state: 'verified',
      verifiedAt: 100,
      createdAt: 100,
      updatedAt: 100,
    })
    await repository.putHandleAlias({
      handle: '@NASA',
      twitterId: '11348282',
      source: 'nip39',
      observedAt: 100,
      expiresAt: 200,
    })

    expect(await repository.getXIdentity('11348282')).toMatchObject({
      handles: ['nasa'],
      state: 'verified',
    })
    expect(await repository.getHandleAlias('NaSa', 199)).toMatchObject({
      handle: 'nasa',
      twitterId: '11348282',
    })
    expect(await repository.getHandleAlias('nasa', 200)).toBeUndefined()
    expect(await repository.deleteExpiredHandleAliases(200)).toBe(1)
    await repository.deleteXIdentity('11348282')
    expect(await repository.getXIdentity('11348282')).toBeUndefined()
  })

  it('updates aliases atomically without lowering source or time precedence', async () => {
    const repository = await openRepository(databaseName('alias-precedence'))
    await repository.putHandleAlias({
      handle: 'NASA',
      twitterId: 'one',
      source: 'page-response',
      observedAt: 200,
    })
    await repository.putHandleAlias({
      handle: 'nasa',
      twitterId: 'two',
      source: 'dom',
      observedAt: 300,
    })
    expect((await repository.getHandleAlias('nasa'))?.twitterId).toBe('two')
    await repository.putHandleAlias({
      handle: 'nasa',
      twitterId: 'equal-time',
      source: 'page-response',
      observedAt: 300,
    })
    expect((await repository.getHandleAlias('nasa'))?.twitterId).toBe('two')

    await repository.putHandleAlias({
      handle: 'nasa',
      twitterId: 'stale-profile',
      source: 'profile-jsonld',
      observedAt: 299,
    })
    expect((await repository.getHandleAlias('nasa'))?.twitterId).toBe('two')

    await Promise.all([
      repository.putHandleAlias({
        handle: 'nasa',
        twitterId: 'profile',
        source: 'profile-jsonld',
        observedAt: 400,
      }),
      repository.putHandleAlias({
        handle: 'nasa',
        twitterId: 'lower',
        source: 'page-response',
        observedAt: 500,
      }),
    ])
    expect(await repository.getHandleAlias('nasa')).toMatchObject({
      twitterId: 'profile',
      source: 'profile-jsonld',
      observedAt: 400,
    })

    await repository.putHandleAlias({
      handle: 'nasa',
      twitterId: 'proof',
      source: 'nip39',
      observedAt: 450,
    })
    await repository.putHandleAlias({
      handle: 'nasa',
      twitterId: 'stale-proof',
      source: 'nip39',
      observedAt: 449,
    })
    expect(await repository.getHandleAlias('nasa')).toMatchObject({
      twitterId: 'proof',
      source: 'nip39',
      observedAt: 450,
    })
  })

  it('preserves identity candidates and resolution cache across restarts', async () => {
    const name = databaseName('identity-history')
    const repository = await openRepository(name)
    await repository.putIdentityObservations([
      {
        handle: '@NASA',
        twitterId: 'one',
        observedAt: 100,
        receivedAt: 110,
        sourceOperation: 'UserByScreenName',
        postIds: ['10'],
      },
      {
        handle: 'nasa',
        twitterId: 'two',
        observedAt: 120,
        receivedAt: 130,
        sourceOperation: 'TweetDetail',
      },
    ])
    await repository.putIdentityResolutionCache({
      state: 'conflict',
      handle: 'NASA',
      resolvedAt: 130,
      expiresAt: 500,
      candidates: [
        {
          twitterId: 'one',
          source: 'page-response',
          observedAt: 100,
        },
        {
          twitterId: 'two',
          source: 'profile-jsonld',
          observedAt: 120,
        },
      ],
    })
    repository.close()

    const reopened = await openRepository(name)
    expect(await reopened.getIdentityObservations('NaSa', 0)).toEqual([
      expect.objectContaining({
        twitterId: 'one',
        sourceOperation: 'UserByScreenName',
        receivedAt: 110,
      }),
      expect.objectContaining({
        twitterId: 'two',
        sourceOperation: 'TweetDetail',
        receivedAt: 130,
      }),
    ])
    expect(await reopened.getIdentityObservations('nasa', 110)).toEqual([
      expect.objectContaining({ twitterId: 'two', observedAt: 120 }),
    ])
    expect(
      await reopened.getIdentityResolutionCache('nasa', 499),
    ).toMatchObject({
      state: 'conflict',
      candidates: [{ twitterId: 'one' }, { twitterId: 'two' }],
    })
    expect(
      await reopened.getIdentityResolutionCache('nasa', 500),
    ).toBeUndefined()
  })

  it('lists flat identities and clears or revokes nip39 bindings by npub', async () => {
    const repository = await openRepository(databaseName('identity-flat'))
    const npubTarget =
      'npub1targetaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const npubOther =
      'npub1otheraaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const baseIdentity = {
      handles: ['handle'],
      createdAt: 100,
      updatedAt: 100,
    }
    await repository.putXIdentity({
      ...baseIdentity,
      twitterId: 'one',
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

  it('stores an address winner in the event and outbox transaction', async () => {
    const repository = await openRepository(databaseName('atomic-address'))
    const signed = event('addressed')
    const address = eventAddress(signed.kind, signed.pubkey, 'subject-addressed')
    await repository.storeEventAndEnqueue(
      signed,
      ['wss://relay.example'],
      {
        now: 100,
        addressWinner: { address, updatedAt: 99 },
      },
    )

    expect(await repository.getEvent('addressed')).toBeDefined()
    expect(await repository.getOutbox('addressed')).toBeDefined()
    expect(await repository.getAddressWinner(address)).toBe('addressed')
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
      }),
    )
    expect(
      await destination.getEventIdsByTag(
        32009,
        'p',
        TEST_SUBJECT_PUBKEY,
      ),
    ).toEqual([portable.id])
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
      ],
    })

    expect(result).toEqual({ imported: 2, duplicates: 0, rejected: 5 })
    expect((await repository.getAllEvents()).map(({ id }) => id).sort()).toEqual(
      [valid.id, validNip39.id].sort(),
    )
  })
})
