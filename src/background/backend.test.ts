import 'fake-indexeddb/auto'
import { emitTabRemoved, setChromeQueriedTabs } from './test-chrome-mock'
import './test-setup'
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  type Event,
} from 'nostr-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  RelayQueryRequest,
} from '../relay'
import { OUTBOX_HOLD_MS } from '../relay'
import {
  AttentionXRepository,
  deleteAttentionXDatabase,
  eventAddress,
} from '../storage'
import { buildKind10011Event } from '../lib/nostr/kind-10011'
import { buildKind32009Event } from '../lib/nostr/kind-32009'
import { buildKind32014Event } from '../lib/nostr/kind-32014'
import {
  BACKGROUND_API_VERSION,
  PROFILE_METADATA_UPDATED_MESSAGE,
  type StorageRetentionState,
} from '../shared/contracts'
import {
  STORAGE_PRUNE_ALARM,
  STORAGE_PRUNE_PERIOD_MIN,
  STORAGE_RETENTION_DEFAULTS,
} from '../shared/storage-retention'
import { demoActorPubkey, demoOperatorPubkey } from '../shared/demo-actor-key.ts'
import { DEMO_WOT_CHAIN } from '../shared/demo-wot'
import {
  VIEWER_BOUND_ERROR,
  VIEWER_NO_IDENTITY_ERROR,
} from '../shared/session-actor.ts'
import { getActivePublicKey } from '../lib/nostr/nip07/signer.ts'
import { GRAPH_VIEW_MESSAGE } from '../shared/graph-deeplink'
import { OPEN_NOTES_ON_LAUNCH_KEY } from '../shared/selected-subject'
import { MAINTENANCE_ALARM, WOT_SYNC_INTERVAL_DEFAULT_MINUTES } from '../shared/wot-sync-interval'
import {
  LIVE_SYNC_KEEPALIVE_ALARM,
  LIVE_SYNC_KEEPALIVE_PERIOD_MIN,
} from '../shared/sync-strategy'
import { buildAuthorTrustSyncFilter, buildXAccountTrustDiscoveryFilter } from '../relay/filters'
import {
  AttentionXBackend,
  type BackgroundRelayTransport,
  type BackgroundSettingsStore,
  type StoredBackgroundSettings,
} from './backend'
import { resetPanelSessionControllerForTests } from './panel-session-controller.ts'
import { clearCachedFocusedProductTab } from './focused-tab-cache.ts'
import type { PanelSessionSnapshot } from '../shared/panel-session.ts'
import * as vault from '../vault/vault.ts'
import * as accounts from '../accounts/accounts.ts'
import { hexToBytes } from '../vault/crypto/utils.ts'
import { peekProfileMetadata, forgetProfileMetadata } from '../lib/nostr/nip07/bg/profile-handlers.ts'
import { handlers as vaultRpcHandlers } from '../vault/bg/vault-handlers.ts'
import {
  readXNostrBindings,
  upsertXNostrBinding,
} from '../vault/x-nostr-bindings-sync.ts'
import {
  toLocalAccountEntry,
  writeLocalAccounts,
} from '../accounts/local-account-mirror.ts'

let sequence = 0
const repositories: AttentionXRepository[] = []
const databaseNames: string[] = []

function hex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function bindActiveVaultToX(twitterId: string): Promise<void> {
  const accountId = vault.getActiveAccountId()
  if (!accountId) throw new Error('No active vault account')
  await vault.setAccountXBinding(accountId, twitterId, Date.now())
}

async function expectDemoChainDegrees(
  backend: AttentionXBackend,
): Promise<void> {
  const query = async (twitterId: string) =>
    (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: `user:id:${twitterId}` },
      bounds: { maxDepth: 5 },
    })) as { resolution: string; degree: number }
  expect(await query('44196397')).toMatchObject({
    resolution: 'trusted',
    degree: 1,
  })
  // Later hops stay at 2/3/4. Adopting a hop-1 extra as You can drop a
  // hitting-hop witness and flip SpaceX/Tesla/NASA from trusted to mixed.
  for (const [twitterId, degree] of [
    ['34743251', 2],
    ['13298072', 3],
    ['11348282', 4],
  ] as const) {
    const row = await query(twitterId)
    expect(row.degree).toBe(degree)
    expect(row.resolution).not.toBe('none')
  }
}

async function expectYouOutIncludesElon(
  backend: AttentionXBackend,
  rootIndex: number,
): Promise<void> {
  const neighborhood = (await backend.handleRequest({
    type: 'GET_GRAPH_NEIGHBORHOOD',
    version: 1,
    centerId: rootIndex,
    direction: 'out',
    valueFilter: 'trust',
  })) as {
    nodes: { subject?: { type: string; value: string } }[]
    identities: Record<string, { twitterId?: string; handle?: string }>
  }
  const elonPk = demoActorPubkey('44196397')
  expect(
    neighborhood.nodes.some(
      (node) =>
        node.subject?.value === 'user:id:44196397' ||
        node.subject?.value === elonPk,
    ) ||
      Boolean(neighborhood.identities['44196397']) ||
      Boolean(neighborhood.identities[elonPk]),
  ).toBe(true)
}

async function publishOutboxNow(
  backend: AttentionXBackend,
  eventId: string,
): Promise<unknown> {
  return backend.handleRequest({
    type: 'PUBLISH_OUTBOX_NOW',
    version: 1,
    eventId,
  })
}

class MemorySettings implements BackgroundSettingsStore {
  value: unknown

  constructor(value: unknown) {
    this.value = value
  }

  async read(): Promise<unknown> {
    return structuredClone(this.value)
  }

  async write(settings: StoredBackgroundSettings): Promise<void> {
    this.value = structuredClone(settings)
  }
}

function hangUntilAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    if (!signal) return
    signal.addEventListener('abort', () => reject(new Error('aborted')), {
      once: true,
    })
  })
}

class FakeRelay implements BackgroundRelayTransport {
  readonly published: Event[] = []
  readonly filters: RelayQueryRequest['filter'][] = []
  queryResults: Event[] = []
  queryEventBatches: Event[][] = []
  queryEventsCalls = 0
  queryEventFilters: RelayQueryRequest['filter'][] = []
  hangUntilAbort = false
  subscribeCalls = 0

  async query(request: RelayQueryRequest): Promise<void> {
    this.filters.push(structuredClone(request.filter))
    if (this.hangUntilAbort && request.signal) {
      await hangUntilAbort(request.signal)
      return
    }
    for (const event of this.queryResults) {
      await request.onEvent(event)
    }
  }

  async queryEvents(
    _relayUrls?: readonly string[],
    _filter?: RelayQueryRequest['filter'],
    signal?: AbortSignal,
  ): Promise<Event[]> {
    this.queryEventsCalls += 1
    if (_filter) this.queryEventFilters.push(structuredClone(_filter))
    if (this.hangUntilAbort) {
      await hangUntilAbort(signal)
      return []
    }
    const events = this.queryEventBatches.shift() ?? this.queryResults
    return events.map((event) => structuredClone(event))
  }

  subscribe = (request: {
    relayUrl: string
    filter: RelayQueryRequest['filter']
    onEvent: (event: Event) => void | Promise<void>
    onEose?: () => void
    onClose?: (reason: string) => void
    signal?: AbortSignal
  }) => {
    this.subscribeCalls += 1
    this.filters.push(structuredClone(request.filter))
    let closed = false
    queueMicrotask(() => {
      if (!closed) request.onEose?.()
    })
    request.signal?.addEventListener(
      'abort',
      () => {
        closed = true
      },
      { once: true },
    )
    return {
      close: () => {
        closed = true
      },
    }
  }

  async publish(_relayUrl: string, event: Event): Promise<void> {
    this.published.push(structuredClone(event))
  }
}

async function repository(label: string): Promise<AttentionXRepository> {
  const name = `attentionx-background-${label}-${sequence++}`
  databaseNames.push(name)
  const opened = await AttentionXRepository.open({ name })
  repositories.push(opened)
  return opened
}

afterEach(async () => {
  for (const opened of repositories.splice(0)) opened.close()
  for (const name of databaseNames.splice(0)) {
    await deleteAttentionXDatabase(name)
  }
  await resetPanelSessionControllerForTests()
})

describe('AttentionXBackend integration', () => {
  it('migrates only valid supported events and removes the legacy cache', async () => {
    const secretKey = generateSecretKey()
    const trust = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'post:id:123' },
        value: '1',
        scopes: ['x.com'],
        createdAt: 100,
      }),
      secretKey,
    )
    const identity = finalizeEvent(
      buildKind10011Event({
        handle: 'nasa',
        twitterId: '11348282',
        proofPostId: '456',
        createdAt: 101,
      }),
      secretKey,
    )
    const unsupported = finalizeEvent(
      { kind: 1, created_at: 99, content: '', tags: [] },
      secretKey,
    )
    const settings = new MemorySettings({
      secretKeyHex: hex(secretKey),
      relays: ['wss://relay.example'],
      cachedEvents: [unsupported, trust, identity, { ...trust, sig: '0'.repeat(128) }],
    })
    const storage = await repository('migration')

    await AttentionXBackend.create({
      repository: storage,
      settingsStore: settings,
      relay: new FakeRelay(),
    })

    expect((await storage.getAllEvents()).map(({ kind }) => kind).sort()).toEqual([
      10011,
      32009,
    ])
    expect(settings.value).toEqual({
      relays: ['wss://relay.example'],
      mode: 'production',
      wotMaxDegree: 4,
      followTrustRed: 25,
      followTrustGreen: 75,
      syncIntervalMinutes: 15,
      wotAutoLower: true,
      syncStrategy: 'frontier-interval',
      externalProfilesEnabled: true,
      storageRetention: STORAGE_RETENTION_DEFAULTS,
    })
  })

  it('publishes stable kind-32009 subjects and queries the rebuilt graph', async () => {
    const secretKey = generateSecretKey()
    const storage = await repository('trust')
    const relay = new FakeRelay()
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 200_000,
    })

    const published = await backend.handleRequest({
      type: 'PUBLISH_TRUST_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'post:id:123' },
      value: '1',
    })
    const event = (await storage.getEventsByKind(32009))[0]!

    expect(published).toMatchObject({
      eventId: event.id,
      deliveredTo: 0,
      attemptedRelays: 0,
      deliveryStatus: 'pending',
      heldUntil: 200_000 + OUTBOX_HOLD_MS,
    })
    expect(event.tags).toContainEqual(['i', 'post:id:123'])
    expect(event.tags).toContainEqual(['k', 'post:id'])
    expect(event.tags).toContainEqual(['s', 'x.com'])
    expect(event.tags.some((tag) => tag[0] === 'c')).toBe(false)
    expect(relay.published).toHaveLength(0)

    const flushed = await publishOutboxNow(backend, event.id)
    expect(flushed).toMatchObject({
      eventId: event.id,
      deliveredTo: 1,
      attemptedRelays: 1,
    })
    expect(relay.published).toHaveLength(1)

    const query = await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'post:id:123' },
    })
    expect(query).toMatchObject({
      resolution: 'trusted',
      direct: {
        author: getPublicKey(secretKey),
        value: 1,
        connectionKey: (await storage.getEvent(event.id))?.addressKey,
      },
    })

    expect(
      await backend.handleRequest({
        type: 'UPSERT_X_POST_CHROME',
        version: 1,
        posts: [
          {
            postId: '123',
            authorTwitterId: '44196397',
            authorHandle: 'elonmusk',
            headline: 'post trust chrome',
          },
        ],
      }),
    ).toMatchObject({ upserted: 1 })
    expect(
      await backend.handleRequest({
        type: 'GET_X_POST_DISPLAYS',
        version: 1,
        postIds: ['123'],
      }),
    ).toMatchObject({
      '123': {
        headline: 'post trust chrome',
        authorHandle: 'elonmusk',
        authorTwitterId: '44196397',
      },
    })

    await expect(
      backend.handleRequest({
        type: 'PUBLISH_TRUST_STATEMENT',
        version: 1,
        subject: { type: 'i', value: 'user:id:nasa' },
        value: '1',
      }),
    ).rejects.toThrow('decimal digits')

    await backend.handleRequest({
      type: 'CANCEL_TRUST_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'post:id:123' },
    })
    const cancelledEvent = (await storage.getEventsByKind(32009)).find(
      (event) => event.tags.some((tag) => tag[0] === 'v' && tag[1] === ''),
    )
    expect(cancelledEvent).toBeDefined()
    const cancelled = await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'post:id:123' },
    })
    expect(cancelled).toMatchObject({
      context: 'identity',
      resolution: 'none',
    })

    await backend.handleRequest({
      type: 'PUBLISH_TRUST_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'post:id:123' },
      value: '0',
      content: 'Neither endorsed nor opposed.',
    })
    const neutral = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'post:id:123' },
      format: 'path',
    })) as { direct?: { value: number; content?: string }; resolution: string }
    expect(neutral).toMatchObject({
      resolution: 'none',
      direct: { value: 0, content: 'Neither endorsed nor opposed.' },
    })
  })

  it('lists inbound user statements when WoT resolve has no hitting degree', async () => {
    const rootKey = generateSecretKey()
    const witnessKey = generateSecretKey()
    const witnessPubkey = getPublicKey(witnessKey)
    const witnessNpub = nip19.npubEncode(witnessPubkey)
    const storage = await repository('incoming-fallback')
    await storage.putXIdentity({
      twitterId: '7',
      handle: 'witness',
      postNpub: witnessNpub.toLowerCase(),
      state: 'verified',
      verifiedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })
    const witnessEvent = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:1290800267441532928' },
        value: '1',
        context: 'identity',
        scopes: ['x.com'],
        k: 'user:id',
        content: 'graph neighbor',
        createdAt: 10,
      }),
      witnessKey,
    )
    await storage.ingestEvent({ event: witnessEvent })
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(rootKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
    })
    const queried = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:1290800267441532928' },
    })) as {
      resolution: string
      connected: boolean
      statements: { author: string; value: number; content?: string }[]
    }
    expect(queried.resolution).toBe('none')
    expect(queried.connected).toBe(false)
    expect(queried.statements).toEqual([
      expect.objectContaining({
        author: witnessPubkey,
        value: 1,
        content: 'graph neighbor',
      }),
    ])
    const incoming = (await backend.handleRequest({
      type: 'QUERY_INCOMING_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:1290800267441532928' },
    })) as { statements: { author: string; value: number; content?: string }[] }
    expect(incoming.statements).toEqual(queried.statements)
  })

  it('lists all Graph.in authors on QUERY_INCOMING_TRUST when WoT has a hitting degree', async () => {
    const rootKey = generateSecretKey()
    const witnessKey = generateSecretKey()
    const outsiderKey = generateSecretKey()
    const neutralKey = generateSecretKey()
    const witnessPubkey = getPublicKey(witnessKey)
    const outsiderPubkey = getPublicKey(outsiderKey)
    const neutralPubkey = getPublicKey(neutralKey)
    const storage = await repository('incoming-all-inbound')
    const hop = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'p', value: witnessPubkey },
        value: '1',
        context: 'identity',
        createdAt: 9,
      }),
      rootKey,
    )
    const witnessEvent = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:1290800267441532928' },
        value: '1',
        context: 'identity',
        scopes: ['x.com'],
        k: 'user:id',
        content: 'on path',
        createdAt: 10,
      }),
      witnessKey,
    )
    const outsiderEvent = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:1290800267441532928' },
        value: '-1',
        context: 'identity',
        scopes: ['x.com'],
        k: 'user:id',
        content: 'off path',
        createdAt: 11,
      }),
      outsiderKey,
    )
    const neutralEvent = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:1290800267441532928' },
        value: '0',
        context: 'identity',
        scopes: ['x.com'],
        k: 'user:id',
        content: 'neutral off path',
        createdAt: 12,
      }),
      neutralKey,
    )
    await storage.ingestEvent({ event: hop })
    await storage.ingestEvent({ event: witnessEvent })
    await storage.ingestEvent({ event: outsiderEvent })
    await storage.ingestEvent({ event: neutralEvent })
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(rootKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
    })
    const queried = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:1290800267441532928' },
    })) as {
      resolution: string
      connected: boolean
      statements: { author: string; value: number; content?: string }[]
    }
    expect(queried.connected).toBe(true)
    expect(queried.statements).toEqual([
      expect.objectContaining({
        author: witnessPubkey,
        value: 1,
        content: 'on path',
      }),
    ])
    const incoming = (await backend.handleRequest({
      type: 'QUERY_INCOMING_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:1290800267441532928' },
    })) as { statements: { author: string; value: number; content?: string }[] }
    expect(incoming.statements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          author: witnessPubkey,
          value: 1,
          content: 'on path',
        }),
        expect.objectContaining({
          author: outsiderPubkey,
          value: -1,
          content: 'off path',
        }),
        expect.objectContaining({
          author: neutralPubkey,
          value: 0,
          content: 'neutral off path',
        }),
      ]),
    )
    expect(incoming.statements).toHaveLength(3)
  })

  it('lists hop-mesh Trust and user:id distrust from the same author on QUERY_INCOMING_TRUST', async () => {
    const rootKey = generateSecretKey()
    const witnessKey = generateSecretKey()
    const teslaKey = generateSecretKey()
    const witnessPubkey = getPublicKey(witnessKey)
    const teslaPubkey = getPublicKey(teslaKey)
    const teslaNpub = nip19.npubEncode(teslaPubkey)
    const storage = await repository('incoming-dual-edge')
    await storage.putXIdentity({
      twitterId: '13298072',
      handle: 'tesla',
      postNpub: teslaNpub.toLowerCase(),
      state: 'verified',
      verifiedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })
    const hopToWitness = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'p', value: witnessPubkey },
        value: '1',
        context: 'identity',
        createdAt: 8,
      }),
      rootKey,
    )
    const hopMesh = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'p', value: teslaPubkey },
        value: '1',
        context: 'identity',
        createdAt: 9,
      }),
      witnessKey,
    )
    const userDistrust = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:13298072' },
        value: '-1',
        context: 'identity',
        scopes: ['x.com'],
        k: 'user:id',
        content: 'user slot distrust',
        createdAt: 10,
      }),
      witnessKey,
    )
    const userNeutral = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:13298072' },
        value: '0',
        context: 'identity',
        scopes: ['x.com'],
        k: 'user:id',
        content: 'would collide on author key',
        createdAt: 11,
      }),
      generateSecretKey(),
    )
    await storage.ingestEvent({ event: hopToWitness })
    await storage.ingestEvent({ event: hopMesh })
    await storage.ingestEvent({ event: userDistrust })
    await storage.ingestEvent({ event: userNeutral })
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(rootKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
    })
    const incoming = (await backend.handleRequest({
      type: 'QUERY_INCOMING_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:13298072' },
    })) as { statements: { author: string; value: number; content?: string }[] }
    expect(incoming.statements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          author: witnessPubkey,
          value: 1,
        }),
        expect.objectContaining({
          author: witnessPubkey,
          value: -1,
          content: 'user slot distrust',
        }),
        expect.objectContaining({
          value: 0,
          content: 'would collide on author key',
        }),
      ]),
    )
    expect(incoming.statements.filter((row) => row.author === witnessPubkey)).toHaveLength(
      2,
    )
  })

  it('publishes and queries kind 32014 ratings without treating them as trust hops', async () => {
    const secretKey = generateSecretKey()
    const storage = await repository('rating-32014')
    const relay = new FakeRelay()
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 200_000,
    })

    const published = await backend.handleRequest({
      type: 'PUBLISH_RATING_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'post:id:555' },
      score: '80',
      labels: ['genuine'],
      content: 'worth a look',
    })
    const event = (await storage.getEventsByKind(32014))[0]!

    expect(published).toMatchObject({
      eventId: event.id,
      deliveredTo: 0,
      attemptedRelays: 0,
      deliveryStatus: 'pending',
      heldUntil: 200_000 + OUTBOX_HOLD_MS,
    })
    expect(event.tags).toContainEqual(['i', 'post:id:555'])
    expect(event.tags).toContainEqual(['k', 'post:id'])
    expect(event.tags).toContainEqual(['s', 'x.com'])
    expect(event.tags).toContainEqual(['score', '80'])
    expect(event.tags).toContainEqual(['l', 'genuine'])
    expect(event.tags.some((tag) => tag[0] === 'c')).toBe(false)
    expect(event.content).toBe('worth a look')
    expect(relay.published).toHaveLength(0)

    const query = (await backend.handleRequest({
      type: 'QUERY_RATING',
      version: 1,
      subject: { type: 'i', value: 'post:id:555' },
    })) as { averageScore: number | null; claimCount: number; own?: { score: number } }
    expect(query.claimCount).toBe(1)
    expect(query.averageScore).toBe(80)
    expect(query.own?.score).toBe(80)

    expect(
      await backend.handleRequest({
        type: 'UPSERT_X_POST_CHROME',
        version: 1,
        posts: [
          {
            postId: '555',
            authorTwitterId: '44196397',
            authorHandle: 'elonmusk',
            headline: 'worth a look',
          },
        ],
      }),
    ).toMatchObject({ upserted: 1 })
    expect(
      await backend.handleRequest({
        type: 'GET_X_POST_DISPLAYS',
        version: 1,
        postIds: ['555'],
      }),
    ).toMatchObject({
      '555': {
        headline: 'worth a look',
        authorHandle: 'elonmusk',
        authorTwitterId: '44196397',
      },
    })

    await backend.handleRequest({
      type: 'PUBLISH_RATING_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'post:id:555' },
      score: '80',
      labels: ['genuine'],
      content: 'still worth a look',
    })
    const reissued = (await backend.handleRequest({
      type: 'QUERY_RATING',
      version: 1,
      subject: { type: 'i', value: 'post:id:555' },
    })) as {
      claimCount: number
      averageScore: number | null
      own?: { score: number; content?: string }
    }
    expect(reissued.claimCount).toBe(1)
    expect(reissued.averageScore).toBe(80)
    expect(reissued.own).toMatchObject({
      score: 80,
      content: 'still worth a look',
    })
    expect(await storage.getEventsByKind(32014)).toHaveLength(1)

    const zero = await backend.handleRequest({
      type: 'PUBLISH_RATING_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'post:id:555' },
      score: '0',
      labels: ['spam'],
    })
    expect(zero).toMatchObject({ eventId: expect.any(String) })
    const afterZero = (await backend.handleRequest({
      type: 'QUERY_RATING',
      version: 1,
      subject: { type: 'i', value: 'post:id:555' },
    })) as { averageScore: number | null; own?: { score: number } }
    expect(afterZero.averageScore).toBe(0)
    expect(afterZero.own?.score).toBe(0)

    await backend.handleRequest({
      type: 'CANCEL_RATING_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'post:id:555' },
    })
    const cancelled = (await backend.handleRequest({
      type: 'QUERY_RATING',
      version: 1,
      subject: { type: 'i', value: 'post:id:555' },
    })) as { claimCount: number; averageScore: number | null }
    expect(cancelled.claimCount).toBe(0)
    expect(cancelled.averageScore).toBeNull()

    const leftoverTrust = await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'post:id:555' },
    })
    expect(leftoverTrust).toMatchObject({ resolution: 'none' })
  })

  it('fans out trust and rating mutations while keeping viewer runtime-only', async () => {
    const secretKey = generateSecretKey()
    const backend = await AttentionXBackend.create({
      repository: await repository('state-topic-fanout'),
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 200_000,
    })
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome
    const runtimeMessages: unknown[] = []
    const tabMessages: unknown[] = []
    const originalRuntimeSend = chromeApi.runtime.sendMessage
    const originalTabSend = chromeApi.tabs.sendMessage
    chromeApi.runtime.sendMessage = (async (message: unknown) => {
      runtimeMessages.push(message)
      return undefined
    }) as unknown as typeof chrome.runtime.sendMessage
    chromeApi.tabs.sendMessage = (async (
      _tabId: number,
      message: unknown,
    ) => {
      tabMessages.push(message)
      return undefined
    }) as unknown as typeof chrome.tabs.sendMessage

    const messageType = (value: unknown): string | undefined => {
      if (!value || typeof value !== 'object') return undefined
      const type = (value as { type?: unknown }).type
      return typeof type === 'string' ? type : undefined
    }
    const count = (messages: readonly unknown[], type: string): number =>
      messages.filter((message) => messageType(message) === type).length

    try {
      await backend.handleRequest({
        type: 'PUBLISH_TRUST_STATEMENT',
        version: 1,
        subject: { type: 'i', value: 'post:id:700' },
        value: '1',
      })
      await backend.handleRequest({
        type: 'CANCEL_TRUST_STATEMENT',
        version: 1,
        subject: { type: 'i', value: 'post:id:700' },
      })
      await backend.handleRequest({
        type: 'PUBLISH_RATING_STATEMENT',
        version: 1,
        subject: { type: 'i', value: 'post:id:700' },
        score: '60',
      })
      await backend.handleRequest({
        type: 'CANCEL_RATING_STATEMENT',
        version: 1,
        subject: { type: 'i', value: 'post:id:700' },
      })
      await backend.handleRequest({
        type: 'SET_VIEWER',
        version: 1,
        twitterId: null,
      })

      await vi.waitFor(() => {
        expect(count(tabMessages, 'TRUST_GRAPH_UPDATED')).toBeGreaterThanOrEqual(
          4,
        )
      })
      expect(count(runtimeMessages, 'TRUST_GRAPH_UPDATED')).toBeGreaterThanOrEqual(
        4,
      )
      expect(count(runtimeMessages, 'VIEWER_CHANGED')).toBe(1)
      expect(count(tabMessages, 'VIEWER_CHANGED')).toBe(0)
      expect(count(runtimeMessages, 'ACTIVITY_CHANGED')).toBeGreaterThanOrEqual(
        4,
      )
      expect(count(tabMessages, 'ACTIVITY_CHANGED')).toBe(0)
    } finally {
      chromeApi.runtime.sendMessage = originalRuntimeSend
      chromeApi.tabs.sendMessage = originalTabSend
    }
  })

  it('persists OPEN_SIDE_PANEL selected subject for Notes', async () => {
    const secretKey = generateSecretKey()
    const backend = await AttentionXBackend.create({
      repository: await repository('side-panel-subject'),
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
    })
    const open = vi.fn(async () => undefined)
    const chromeApi = chrome as unknown as {
      sidePanel: { open: typeof open }
    }
    chromeApi.sidePanel.open = open

    const opened = await backend.handleRequest(
      {
        type: 'OPEN_SIDE_PANEL',
        version: 1,
        subject: { type: 'i', value: 'user:id:99' },
      },
      { senderTabId: 7 },
    )
    expect(opened).toMatchObject({
      opened: true,
      subject: { type: 'i', value: 'user:id:99' },
    })
    expect(open).not.toHaveBeenCalled()

    const selected = (await backend.handleRequest({
      type: 'GET_PANEL_SESSION',
    })) as PanelSessionSnapshot
    expect(selected.intent.selected).toEqual({
      subject: { type: 'i', value: 'user:id:99' },
    })
    expect(selected.intent.canBack).toBe(false)
    expect(selected.intent.canForward).toBe(false)
    expect(
      await chrome.storage.session.get(OPEN_NOTES_ON_LAUNCH_KEY),
    ).toEqual({ [OPEN_NOTES_ON_LAUNCH_KEY]: true })
  })

  it('SELECT_SUBJECT focuses Notes without calling sidePanel.open', async () => {
    const secretKey = generateSecretKey()
    const backend = await AttentionXBackend.create({
      repository: await repository('select-subject-no-open'),
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
    })
    const open = vi.fn(async () => undefined)
    const chromeApi = chrome as unknown as {
      sidePanel: { open: typeof open }
    }
    chromeApi.sidePanel.open = open

    const focused = await backend.handleRequest({
      type: 'SELECT_SUBJECT',
      version: 1,
      subject: { type: 'i', value: 'user:id:11348282' },
    })
    expect(focused).toEqual({
      subject: { type: 'i', value: 'user:id:11348282' },
    })
    expect(open).not.toHaveBeenCalled()

    const selected = (await backend.handleRequest({
      type: 'GET_PANEL_SESSION',
    })) as PanelSessionSnapshot
    expect(selected.intent.selected).toMatchObject({
      subject: { type: 'i', value: 'user:id:11348282' },
    })
    expect(
      await chrome.storage.session.get(OPEN_NOTES_ON_LAUNCH_KEY),
    ).toEqual({ [OPEN_NOTES_ON_LAUNCH_KEY]: true })
  })

  it('walks OPEN_SIDE_PANEL subject history back and forward', async () => {
    const secretKey = generateSecretKey()
    const backend = await AttentionXBackend.create({
      repository: await repository('side-panel-history'),
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
    })
    const open = vi.fn(async () => undefined)
    const chromeApi = chrome as unknown as {
      sidePanel: { open: typeof open }
    }
    chromeApi.sidePanel.open = open

    await backend.handleRequest(
      {
        type: 'OPEN_SIDE_PANEL',
        version: 1,
        subject: { type: 'i', value: 'user:id:1' },
      },
      { senderTabId: 7 },
    )
    await backend.handleRequest(
      {
        type: 'OPEN_SIDE_PANEL',
        version: 1,
        subject: { type: 'i', value: 'post:id:2' },
      },
      { senderTabId: 7 },
    )
    await backend.handleRequest(
      {
        type: 'OPEN_SIDE_PANEL',
        version: 1,
        subject: { type: 'i', value: 'user:id:1' },
      },
      { senderTabId: 7 },
    )

    expect(
      ((await backend.handleRequest({
        type: 'GET_PANEL_SESSION',
      })) as PanelSessionSnapshot).intent,
    ).toMatchObject({
      notesRequested: true,
      selected: { subject: { type: 'i', value: 'user:id:1' } },
      canBack: true,
      canForward: false,
    })

    expect(
      await backend.handleRequest({
        type: 'SELECT_SUBJECT_HISTORY',
        version: 1,
        direction: 'back',
      }),
    ).toEqual({
      selected: { subject: { type: 'i', value: 'post:id:2' } },
      canBack: true,
      canForward: true,
    })

    expect(
      await backend.handleRequest({
        type: 'SELECT_SUBJECT_HISTORY',
        version: 1,
        direction: 'back',
      }),
    ).toEqual({
      selected: { subject: { type: 'i', value: 'user:id:1' } },
      canBack: false,
      canForward: true,
    })

    expect(
      await backend.handleRequest({
        type: 'SELECT_SUBJECT_HISTORY',
        version: 1,
        direction: 'forward',
      }),
    ).toMatchObject({
      selected: { subject: { type: 'i', value: 'post:id:2' } },
      canBack: true,
      canForward: true,
    })
  })

  it('publishes X user trust with identity and keeps post ratings global', async () => {
    const secretKey = generateSecretKey()
    const storage = await repository('trust-x-context')
    const relay = new FakeRelay()
    const globalTemplate = await buildKind32009Event({
      subject: { type: 'i', value: 'user:id:424244' },
      value: '1',
      context: '',
      scopes: ['x.com'],
      k: 'user:id',
      content: '',
      createdAt: 100,
    })
    const globalEvent = finalizeEvent(globalTemplate, secretKey)
    await storage.ingestEvent({ event: globalEvent })
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 200_000,
    })

    const fallback = await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:424244' },
    })
    expect(fallback).toMatchObject({
      context: 'identity',
      resolution: 'trusted',
    })

    await backend.handleRequest({
      type: 'PUBLISH_TRUST_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'user:id:424242' },
      value: '1',
    })
    const identityEvent = (await storage.getEventsByKind(32009)).find((event) =>
      event.tags.some(
        (tag) => tag[0] === 'i' && tag[1] === 'user:id:424242',
      ),
    )!
    expect(identityEvent.tags).toContainEqual(['c', 'identity'])
    expect(identityEvent.tags).toContainEqual(['k', 'user:id'])
    expect(identityEvent.tags).toContainEqual(['s', 'x.com'])

    await backend.handleRequest({
      type: 'PUBLISH_TRUST_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'user:id:424243' },
      value: '1',
      context: 'news:accuracy',
    })
    const remapped = (await storage.getEventsByKind(32009)).find((event) =>
      event.tags.some(
        (tag) => tag[0] === 'i' && tag[1] === 'user:id:424243',
      ),
    )!
    expect(remapped.tags).toContainEqual(['c', 'identity'])
    expect(remapped.tags.some((tag) => tag[0] === 'c' && tag[1] === 'news:accuracy')).toBe(
      false,
    )

    const queried = await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:424242' },
      context: '',
    })
    expect(queried).toMatchObject({
      context: 'identity',
      resolution: 'trusted',
    })

    await backend.handleRequest({
      type: 'CANCEL_TRUST_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'user:id:424242' },
      context: 'identity',
    })
    const identityCancelled = await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:424242' },
    })
    expect(identityCancelled).toMatchObject({ resolution: 'none' })

    await backend.handleRequest({
      type: 'CANCEL_TRUST_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'user:id:424244' },
    })
    const globalCancelled = await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:424244' },
    })
    expect(globalCancelled).toMatchObject({ resolution: 'none' })
  })

  it('persists observations and verifies NIP-39 before publishing identity', async () => {
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)
    const npub = nip19.npubEncode(pubkey)
    const storage = await repository('identity')
    const relay = new FakeRelay()
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 300_000,
      queryProofPost: async (postId) => ({
        status: 'found',
        post: {
          postId,
          authorHandle: 'nasa',
          text: `Linking my account to Nostr: ${npub}`,
        },
      }),
      fetch: async () =>
        new Response(
          '<script type="application/ld+json">{"mainEntity":{"identifier":"11348282"}}</script>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        ),
    })

    await backend.handleRequest({
      type: 'INGEST_X_IDENTITIES',
      version: 1,
      observations: [{
        handle: 'nasa',
        twitterId: '11348282',
        observedAt: 0,
        sourceOperation: 'UserByScreenName',
      }],
    })
    expect(await storage.getXIdentity('11348282')).toMatchObject({
      handle: 'nasa',
      updatedAt: 300_000,
      lastSeen: 300_000,
    })

    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: 1,
      account: {
        handle: 'nasa',
        twitterId: '11348282',
        detectedAt: 300_000,
      },
    })
    await bindActiveVaultToX('11348282')

    // Found proof must exist before publish can become verified.
    await storage.putXIdentity({
      twitterId: '11348282',
      handle: 'nasa',
      postNpub: npub.toLowerCase(),
      postId: '456',
      postHandle: 'nasa',
      postObservedAt: 300_000,
      state: 'verified',
      proofSource: 'post',
      createdAt: 300_000,
      updatedAt: 300_000,
      lastSeen: 300_000,
    })

    const result = await backend.handleRequest({
      type: 'PUBLISH_X_IDENTITY',
      version: 1,
      handle: 'nasa',
      twitterId: '11348282',
      proofTweetId: '456',
    })
    expect(result).toMatchObject({
      deliveredTo: 0,
      deliveryStatus: 'pending',
      heldUntil: expect.any(Number),
    })
    const identityEvent = (await storage.getEventsByKind(10011))[0]!
    await publishOutboxNow(backend, identityEvent.id)
    expect(await storage.getEventsByKind(10011)).toHaveLength(1)
    expect(await storage.getXIdentity('11348282')).toMatchObject({
      state: 'verified',
      postId: '456',
      nip39PostId: '456',
    })
  })

  it('rebuilds tied kind-10011 winners and removes stale claims on restart', async () => {
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)
    const first = finalizeEvent(
      buildKind10011Event({
        handle: 'first',
        twitterId: '111',
        proofPostId: '1001',
        createdAt: 50,
      }),
      secretKey,
    )
    const second = finalizeEvent(
      buildKind10011Event({
        handle: 'second',
        twitterId: '222',
        proofPostId: '1002',
        createdAt: 50,
      }),
      secretKey,
    )
    const winner = first.id < second.id ? first : second
    const loser = winner.id === first.id ? second : first
    const loserIdentity = loser === first ? '111' : '222'
    const storage = await repository('nip39-restart')
    await storage.ingestEvent({ event: first })
    await storage.ingestEvent({ event: second })
    const npub = nip19.npubEncode(pubkey).toLowerCase()
    await storage.putXIdentity({
      twitterId: loserIdentity,
      handle: 'stale',
      nip39Npub: npub,
      nip39XId: loserIdentity,
      nip39Handle: 'stale',
      nip39PostId: '1000',
      nip39Date: 1,
      state: 'verified',
      proofSource: 'nip39',
      verifiedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })

    await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({ relays: ['wss://relay.example'] }),
      relay: new FakeRelay(),
      now: () => 100_000,
    })

    expect(await storage.getEventIdByAddressKey(`10011:${pubkey}:`)).toBe(
      winner.id,
    )
    expect(await storage.getEvent(loser.id)).toBeUndefined()
    expect((await storage.getXIdentity(loserIdentity))?.nip39Npub).toBeUndefined()
  })

  it('rejects unknown runtime request types', async () => {
    const backend = await AttentionXBackend.create({
      repository: await repository('unknown-request'),
      settingsStore: new MemorySettings({ relays: ['wss://relay.example'] }),
      relay: new FakeRelay(),
    })

    await expect(
      backend.handleRequest({ type: 'UNKNOWN' } as never),
    ).rejects.toThrow('Unknown Attention background request type')
  })

  it('opens the graph page with opener tracking and restores focus on close', async () => {
    const chromeApi = chrome as unknown as {
      tabs: {
        create: typeof chrome.tabs.create
        update: typeof chrome.tabs.update
        remove: typeof chrome.tabs.remove
        query: typeof chrome.tabs.query
      }
    }
    const originalCreate = chromeApi.tabs.create
    const originalUpdate = chromeApi.tabs.update
    const originalRemove = chromeApi.tabs.remove
    const originalQuery = chromeApi.tabs.query

    chromeApi.tabs.create = (async () => ({
      id: 42,
      status: 'complete',
      url: 'chrome-extension://attentionx-test/src/cockpit/index.html?mode=graph',
    })) as unknown as typeof chrome.tabs.create
    chromeApi.tabs.update = vi.fn(async () => ({
      id: 7,
      status: 'complete',
    })) as unknown as typeof chrome.tabs.update
    chromeApi.tabs.remove = vi.fn(async () => undefined) as unknown as typeof chrome.tabs.remove
    chromeApi.tabs.query = (async () => [
      { id: 7, status: 'complete', url: 'https://x.com/home' },
    ]) as unknown as typeof chrome.tabs.query

    const backend = await AttentionXBackend.create({
      repository: await repository('graph-page'),
      settingsStore: new MemorySettings({ relays: ['wss://relay.example'] }),
      relay: new FakeRelay(),
    })

    try {
      await backend.handleRequest(
        {
          type: 'OPEN_GRAPH_PAGE',
          version: BACKGROUND_API_VERSION,
          url: '?mode=graph',
        },
        { senderTabId: 7 },
      )
      await backend.handleRequest(
        {
          type: 'CLOSE_GRAPH_PAGE',
          version: BACKGROUND_API_VERSION,
        },
        { senderTabId: 42 },
      )
      expect(chromeApi.tabs.update).toHaveBeenCalledWith(7, { active: true })
      expect(chromeApi.tabs.remove).toHaveBeenCalledWith(42)
    } finally {
      chromeApi.tabs.create = originalCreate
      chromeApi.tabs.update = originalUpdate
      chromeApi.tabs.remove = originalRemove
      chromeApi.tabs.query = originalQuery
    }
  })

  it('reuses the focused Graph tab and applies the view in place', async () => {
    const chromeApi = chrome as unknown as {
      runtime: { sendMessage: typeof chrome.runtime.sendMessage }
      tabs: {
        create: typeof chrome.tabs.create
        update: typeof chrome.tabs.update
        query: typeof chrome.tabs.query
      }
    }
    const originalCreate = chromeApi.tabs.create
    const originalUpdate = chromeApi.tabs.update
    const originalQuery = chromeApi.tabs.query
    const originalSend = chromeApi.runtime.sendMessage
    const create = vi.fn(async () => ({
      id: 99,
      status: 'complete',
    }))
    const update = vi.fn(async () => ({
      id: 42,
      status: 'complete',
    }))
    const sendMessage = vi.fn(async () => undefined)
    const graphHref =
      'chrome-extension://attentionx-test/src/cockpit/index.html?mode=graph'
    const tabs = [
      { id: 7, active: false, url: 'https://x.com/home' },
      { id: 42, active: true, url: graphHref },
    ]

    chromeApi.tabs.create = create as unknown as typeof chrome.tabs.create
    chromeApi.tabs.update = update as unknown as typeof chrome.tabs.update
    chromeApi.tabs.query = (async (queryInfo?: chrome.tabs.QueryInfo) => {
      if (queryInfo?.active) return tabs.filter((tab) => tab.active)
      return tabs
    }) as unknown as typeof chrome.tabs.query
    chromeApi.runtime.sendMessage =
      sendMessage as unknown as typeof chrome.runtime.sendMessage

    const backend = await AttentionXBackend.create({
      repository: await repository('graph-page-reuse-focused'),
      settingsStore: new MemorySettings({ relays: ['wss://relay.example'] }),
      relay: new FakeRelay(),
    })

    try {
      await backend.handleRequest(
        {
          type: 'OPEN_GRAPH_PAGE',
          version: BACKGROUND_API_VERSION,
          url: '?mode=graph&focus=i:user:id:11348282',
        },
        { senderTabId: 7 },
      )
      expect(create).not.toHaveBeenCalled()
      expect(update).toHaveBeenCalledWith(42, { active: true })
      expect(sendMessage).toHaveBeenCalledWith({
        type: GRAPH_VIEW_MESSAGE,
        mode: 'graph',
        tabId: 42,
        focus: 'i:user:id:11348282',
      })

      await backend.handleRequest(
        {
          type: 'OPEN_GRAPH_PAGE',
          version: BACKGROUND_API_VERSION,
          url: '?mode=path&subjectType=i&subjectValue=user:id:11348282',
        },
        { senderTabId: 7 },
      )
      expect(create).not.toHaveBeenCalled()
      expect(update).toHaveBeenCalledWith(42, { active: true })
      expect(sendMessage).toHaveBeenCalledWith({
        type: GRAPH_VIEW_MESSAGE,
        mode: 'path',
        tabId: 42,
        subject: { type: 'i', value: 'user:id:11348282' },
      })
    } finally {
      chromeApi.tabs.create = originalCreate
      chromeApi.tabs.update = originalUpdate
      chromeApi.tabs.query = originalQuery
      chromeApi.runtime.sendMessage = originalSend
    }
  })

  it('opens a new Graph tab when the focused tab is not Graph chrome', async () => {
    const chromeApi = chrome as unknown as {
      tabs: {
        create: typeof chrome.tabs.create
        update: typeof chrome.tabs.update
        query: typeof chrome.tabs.query
      }
    }
    const originalCreate = chromeApi.tabs.create
    const originalUpdate = chromeApi.tabs.update
    const originalQuery = chromeApi.tabs.query
    const create = vi.fn(async () => ({
      id: 99,
      status: 'complete',
    }))
    const update = vi.fn(async () => ({
      id: 42,
      status: 'complete',
    }))
    const tabs = [
      { id: 7, active: true, url: 'https://x.com/home' },
      {
        id: 42,
        active: false,
        url: 'chrome-extension://attentionx-test/src/cockpit/index.html?mode=graph',
      },
    ]

    chromeApi.tabs.create = create as unknown as typeof chrome.tabs.create
    chromeApi.tabs.update = update as unknown as typeof chrome.tabs.update
    chromeApi.tabs.query = (async (queryInfo?: chrome.tabs.QueryInfo) => {
      if (queryInfo?.active) return tabs.filter((tab) => tab.active)
      return tabs
    }) as unknown as typeof chrome.tabs.query

    const backend = await AttentionXBackend.create({
      repository: await repository('graph-page-new-tab'),
      settingsStore: new MemorySettings({ relays: ['wss://relay.example'] }),
      relay: new FakeRelay(),
    })

    try {
      await backend.handleRequest(
        {
          type: 'OPEN_GRAPH_PAGE',
          version: BACKGROUND_API_VERSION,
          url: '?mode=graph&focus=i:user:id:11348282',
        },
        { senderTabId: 7 },
      )
      expect(create).toHaveBeenCalledWith({
        url: new URL(
          '?mode=graph&focus=i:user:id:11348282',
          'chrome-extension://attentionx-test/src/cockpit/index.html',
        ).href,
      })
      expect(update).not.toHaveBeenCalled()
    } finally {
      chromeApi.tabs.create = originalCreate
      chromeApi.tabs.update = originalUpdate
      chromeApi.tabs.query = originalQuery
    }
  })

  it('reuses a Graph tab that sent OPEN_GRAPH_PAGE even without tab.url', async () => {
    const chromeApi = chrome as unknown as {
      runtime: { sendMessage: typeof chrome.runtime.sendMessage }
      tabs: {
        create: typeof chrome.tabs.create
        update: typeof chrome.tabs.update
        query: typeof chrome.tabs.query
      }
    }
    const originalCreate = chromeApi.tabs.create
    const originalUpdate = chromeApi.tabs.update
    const originalQuery = chromeApi.tabs.query
    const originalSend = chromeApi.runtime.sendMessage
    const create = vi.fn(async () => ({
      id: 99,
      status: 'complete',
    }))
    const update = vi.fn(async () => ({
      id: 42,
      status: 'complete',
    }))
    const sendMessage = vi.fn(async () => undefined)

    chromeApi.tabs.create = create as unknown as typeof chrome.tabs.create
    chromeApi.tabs.update = update as unknown as typeof chrome.tabs.update
    chromeApi.tabs.query = (async () => [
      { id: 42, active: true },
    ]) as unknown as typeof chrome.tabs.query
    chromeApi.runtime.sendMessage =
      sendMessage as unknown as typeof chrome.runtime.sendMessage

    const backend = await AttentionXBackend.create({
      repository: await repository('graph-page-reuse-sender'),
      settingsStore: new MemorySettings({ relays: ['wss://relay.example'] }),
      relay: new FakeRelay(),
    })

    try {
      await backend.handleRequest(
        {
          type: 'OPEN_GRAPH_PAGE',
          version: BACKGROUND_API_VERSION,
          url: '?mode=path&subjectType=i&subjectValue=user:id:2385654727',
        },
        {
          senderTabId: 42,
          senderUrl:
            'chrome-extension://attentionx-test/src/cockpit/index.html?mode=graph',
        },
      )
      expect(create).not.toHaveBeenCalled()
      expect(update).toHaveBeenCalledWith(42, { active: true })
      expect(sendMessage).toHaveBeenCalledWith({
        type: GRAPH_VIEW_MESSAGE,
        mode: 'path',
        tabId: 42,
        subject: { type: 'i', value: 'user:id:2385654727' },
      })
    } finally {
      chromeApi.tabs.create = originalCreate
      chromeApi.tabs.update = originalUpdate
      chromeApi.tabs.query = originalQuery
      chromeApi.runtime.sendMessage = originalSend
    }
  })

  it('closes an application page without opener by focusing the latest x.com tab', async () => {
    const chromeApi = chrome as unknown as {
      tabs: {
        update: typeof chrome.tabs.update
        remove: typeof chrome.tabs.remove
        query: typeof chrome.tabs.query
      }
    }
    const originalUpdate = chromeApi.tabs.update
    const originalRemove = chromeApi.tabs.remove
    const originalQuery = chromeApi.tabs.query

    chromeApi.tabs.update = vi.fn(async () => ({
      id: 9,
      status: 'complete',
    })) as unknown as typeof chrome.tabs.update
    chromeApi.tabs.remove = vi.fn(async () => undefined) as unknown as typeof chrome.tabs.remove
    chromeApi.tabs.query = (async () => [
      {
        id: 8,
        status: 'complete',
        url: 'https://x.com/home',
        lastAccessed: 100,
      },
      {
        id: 9,
        status: 'complete',
        url: 'https://x.com/explore',
        lastAccessed: 200,
      },
    ]) as unknown as typeof chrome.tabs.query

    const backend = await AttentionXBackend.create({
      repository: await repository('app-page-close'),
      settingsStore: new MemorySettings({ relays: ['wss://relay.example'] }),
      relay: new FakeRelay(),
    })

    try {
      await backend.handleRequest(
        {
          type: 'CLOSE_GRAPH_PAGE',
          version: BACKGROUND_API_VERSION,
        },
        { senderTabId: 42 },
      )
      expect(chromeApi.tabs.update).toHaveBeenCalledWith(9, { active: true })
      expect(chromeApi.tabs.remove).toHaveBeenCalledWith(42)
    } finally {
      chromeApi.tabs.update = originalUpdate
      chromeApi.tabs.remove = originalRemove
      chromeApi.tabs.query = originalQuery
    }
  })

  it('restores opener focus when the application tab is closed in the browser', async () => {
    const chromeApi = chrome as unknown as {
      tabs: {
        create: typeof chrome.tabs.create
        update: typeof chrome.tabs.update
        query: typeof chrome.tabs.query
      }
    }
    const originalCreate = chromeApi.tabs.create
    const originalUpdate = chromeApi.tabs.update
    const originalQuery = chromeApi.tabs.query

    chromeApi.tabs.create = (async () => ({
      id: 42,
      status: 'complete',
      url: 'chrome-extension://attentionx-test/src/cockpit/index.html?mode=graph',
    })) as unknown as typeof chrome.tabs.create
    chromeApi.tabs.update = vi.fn(async () => ({
      id: 7,
      status: 'complete',
    })) as unknown as typeof chrome.tabs.update
    chromeApi.tabs.query = (async () => [
      { id: 7, status: 'complete', url: 'https://x.com/home' },
    ]) as unknown as typeof chrome.tabs.query

    const backend = await AttentionXBackend.create({
      repository: await repository('graph-page-browser-close'),
      settingsStore: new MemorySettings({ relays: ['wss://relay.example'] }),
      relay: new FakeRelay(),
    })

    try {
      await backend.handleRequest(
        {
          type: 'OPEN_GRAPH_PAGE',
          version: BACKGROUND_API_VERSION,
          url: '?mode=graph',
        },
        { senderTabId: 7 },
      )
      emitTabRemoved(42)
      await vi.waitFor(() => {
        expect(chromeApi.tabs.update).toHaveBeenCalledWith(7, { active: true })
      })
    } finally {
      chromeApi.tabs.create = originalCreate
      chromeApi.tabs.update = originalUpdate
      chromeApi.tabs.query = originalQuery
    }
  })

  it('runs bounded WoT sync from the local root and exposes status', async () => {
    const secretKey = generateSecretKey()
    const relay = new FakeRelay()
    const backend = await AttentionXBackend.create({
      repository: await repository('sync'),
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 400_000,
    })

    expect(await backend.handleRequest({
      type: 'START_WOT_SYNC',
      version: 1,
      limits: {
        maxDepth: 0,
        maxAuthorsPerLevel: 1,
        maxTotalAuthors: 1,
        maxEvents: 10,
      },
    })).toMatchObject({ state: 'running' })

    let status: unknown
    for (let attempt = 0; attempt < 50; attempt += 1) {
      status = await backend.handleRequest({
        type: 'GET_WOT_SYNC_STATUS',
        version: 1,
      })
      if (
        typeof status === 'object' &&
        status !== null &&
        'state' in status &&
        status.state !== 'running'
      ) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(status).toMatchObject({
      state: 'complete',
      result: { authors: [getPublicKey(secretKey)] },
    })
    expect(relay.filters).toContainEqual(
      expect.objectContaining(buildAuthorTrustSyncFilter(getPublicKey(secretKey))),
    )
  })

  it('includes X subject discovery filters when identities are observed', async () => {
    const secretKey = generateSecretKey()
    const relay = new FakeRelay()
    const storage = await repository('sync-x-subjects')
    await storage.putXIdentity({
      twitterId: '424242',
      handle: 'demo',
      state: 'unverified',
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 400_000,
    })

    await backend.handleRequest({
      type: 'START_WOT_SYNC',
      version: 1,
      limits: {
        maxDepth: 0,
        maxAuthorsPerLevel: 1,
        maxTotalAuthors: 1,
        maxEvents: 10,
      },
    })

    let status: unknown
    for (let attempt = 0; attempt < 50; attempt += 1) {
      status = await backend.handleRequest({
        type: 'GET_WOT_SYNC_STATUS',
        version: 1,
      })
      if (
        typeof status === 'object' &&
        status !== null &&
        'state' in status &&
        status.state !== 'running'
      ) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(status).toMatchObject({ state: 'complete' })
    expect(relay.filters).toContainEqual(
      expect.objectContaining(
        buildXAccountTrustDiscoveryFilter(['424242']),
      ),
    )
  })

  it('broadcasts TRUST_GRAPH_UPDATED when a sync stores new events', async () => {
    const secretKey = generateSecretKey()
    const relay = new FakeRelay()
    // Root-authored statement that is not stored locally yet.
    relay.queryResults = [
      finalizeEvent(
        await buildKind32009Event({
          subject: { type: 'i', value: 'user:id:100' },
          value: '1',
          context: '',
          scopes: ['x.com'],
          k: 'user:id',
          content: '',
          createdAt: 10,
        }),
        secretKey,
      ),
    ]
    const backend = await AttentionXBackend.create({
      repository: await repository('sync-broadcast'),
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 400_000,
    })

    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome
    const broadcasts: Array<{ type?: string }> = []
    const originalRuntimeSend = chromeApi.runtime.sendMessage
    chromeApi.runtime.sendMessage = (async (message: { type?: string }) => {
      broadcasts.push(message)
      return undefined
    }) as unknown as typeof chrome.runtime.sendMessage

    try {
      await backend.handleRequest({
        type: 'START_WOT_SYNC',
        version: 1,
        limits: {
          maxDepth: 0,
          maxAuthorsPerLevel: 1,
          maxTotalAuthors: 1,
          maxEvents: 10,
        },
      })

      let status: unknown
      for (let attempt = 0; attempt < 50; attempt += 1) {
        status = await backend.handleRequest({
          type: 'GET_WOT_SYNC_STATUS',
          version: 1,
        })
        if (
          typeof status === 'object' &&
          status !== null &&
          'state' in status &&
          status.state !== 'running'
        ) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      expect(status).toMatchObject({
        state: 'complete',
        result: { eventsStored: 1 },
      })
      expect(
        broadcasts.some((message) => message?.type === 'TRUST_GRAPH_UPDATED'),
      ).toBe(true)
    } finally {
      chromeApi.runtime.sendMessage = originalRuntimeSend
    }
  })

  it('does not broadcast TRUST_GRAPH_UPDATED when a sync stores nothing', async () => {
    const secretKey = generateSecretKey()
    const relay = new FakeRelay()
    const backend = await AttentionXBackend.create({
      repository: await repository('sync-no-broadcast'),
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 400_000,
    })

    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome
    const broadcasts: Array<{ type?: string }> = []
    const originalRuntimeSend = chromeApi.runtime.sendMessage
    chromeApi.runtime.sendMessage = (async (message: { type?: string }) => {
      broadcasts.push(message)
      return undefined
    }) as unknown as typeof chrome.runtime.sendMessage

    try {
      await backend.handleRequest({
        type: 'START_WOT_SYNC',
        version: 1,
        limits: {
          maxDepth: 0,
          maxAuthorsPerLevel: 1,
          maxTotalAuthors: 1,
          maxEvents: 10,
        },
      })

      let status: unknown
      for (let attempt = 0; attempt < 50; attempt += 1) {
        status = await backend.handleRequest({
          type: 'GET_WOT_SYNC_STATUS',
          version: 1,
        })
        if (
          typeof status === 'object' &&
          status !== null &&
          'state' in status &&
          status.state !== 'running'
        ) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      expect(status).toMatchObject({
        state: 'complete',
        result: { eventsStored: 0 },
      })
      expect(
        broadcasts.some((message) => message?.type === 'TRUST_GRAPH_UPDATED'),
      ).toBe(false)
    } finally {
      chromeApi.runtime.sendMessage = originalRuntimeSend
    }
  })

  it('does not broadcast TRUST_GRAPH_UPDATED when a running sync is aborted', async () => {
    const secretKey = generateSecretKey()
    const relay = new FakeRelay()
    relay.hangUntilAbort = true
    const backend = await AttentionXBackend.create({
      repository: await repository('sync-abort-no-broadcast'),
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 400_000,
    })

    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome
    const broadcasts: Array<{ type?: string }> = []
    const originalRuntimeSend = chromeApi.runtime.sendMessage
    chromeApi.runtime.sendMessage = (async (message: { type?: string }) => {
      broadcasts.push(message)
      return undefined
    }) as unknown as typeof chrome.runtime.sendMessage

    try {
      await backend.handleRequest({
        type: 'START_WOT_SYNC',
        version: 1,
        limits: {
          maxDepth: 0,
          maxAuthorsPerLevel: 1,
          maxTotalAuthors: 1,
          maxEvents: 10,
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      await backend.handleRequest({ type: 'STOP_WOT_SYNC', version: 1 })

      let status: unknown
      for (let attempt = 0; attempt < 50; attempt += 1) {
        status = await backend.handleRequest({
          type: 'GET_WOT_SYNC_STATUS',
          version: 1,
        })
        if (
          typeof status === 'object' &&
          status !== null &&
          'state' in status &&
          status.state !== 'running'
        ) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      expect(status).toMatchObject({ state: 'stopped' })
      expect(
        broadcasts.some((message) => message?.type === 'TRUST_GRAPH_UPDATED'),
      ).toBe(false)
    } finally {
      chromeApi.runtime.sendMessage = originalRuntimeSend
    }
  })

  it('persists and validates the network refresh interval', async () => {
    const settings = new MemorySettings({
      secretKeyHex: hex(generateSecretKey()),
      relays: ['wss://relay.example'],
    })
    const backend = await AttentionXBackend.create({
      repository: await repository('sync-interval'),
      settingsStore: settings,
      relay: new FakeRelay(),
      now: () => 400_000,
    })

    expect(
      await backend.handleRequest({ type: 'GET_WOT_SYNC_INTERVAL', version: 1 }),
    ).toEqual({ intervalMinutes: 15 })

    expect(
      await backend.handleRequest({
        type: 'SET_WOT_SYNC_INTERVAL',
        version: 1,
        intervalMinutes: 30,
      }),
    ).toEqual({ intervalMinutes: 30 })
    expect(settings.value).toMatchObject({ syncIntervalMinutes: 30 })

    // Off-list values fall back to the default; 0 means paused.
    expect(
      await backend.handleRequest({
        type: 'SET_WOT_SYNC_INTERVAL',
        version: 1,
        intervalMinutes: 7,
      }),
    ).toEqual({ intervalMinutes: 15 })
    expect(
      await backend.handleRequest({
        type: 'SET_WOT_SYNC_INTERVAL',
        version: 1,
        intervalMinutes: 0,
      }),
    ).toEqual({ intervalMinutes: 0 })
    expect(settings.value).toMatchObject({ syncIntervalMinutes: 0 })
  })

  it('migrates missing sync strategy to interval and persists strategy changes', async () => {
    const settings = new MemorySettings({
      secretKeyHex: hex(generateSecretKey()),
      relays: ['wss://relay.example'],
    })
    const backend = await AttentionXBackend.create({
      repository: await repository('sync-strategy'),
      settingsStore: settings,
      relay: new FakeRelay(),
      now: () => 400_000,
    })

    expect(
      await backend.handleRequest({ type: 'GET_SYNC_STRATEGY', version: 1 }),
    ).toEqual({ strategy: 'frontier-interval' })
    expect(settings.value).toMatchObject({
      syncStrategy: 'frontier-interval',
      externalProfilesEnabled: true,
    })

    expect(
      await backend.handleRequest({
        type: 'SET_SYNC_STRATEGY',
        version: 1,
        strategy: 'frontier-continuous',
      }),
    ).toEqual({ strategy: 'frontier-continuous' })
    expect(settings.value).toMatchObject({
      syncStrategy: 'frontier-continuous',
    })
    await backend.handleRequest({ type: 'STOP_WOT_SYNC', version: 1 })

    await expect(
      backend.handleRequest({
        type: 'SET_SYNC_STRATEGY',
        version: 1,
        strategy: 'firehose' as never,
      }),
    ).rejects.toThrow('Invalid synchronization strategy')
  })

  it('keeps the worker warm for continuous sync and honors Stop', async () => {
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome
    const createSpy = vi.spyOn(chromeApi.alarms, 'create').mockResolvedValue()
    const clearSpy = vi.spyOn(chromeApi.alarms, 'clear').mockResolvedValue()
    const getSpy = vi.spyOn(chromeApi.storage.local, 'get')

    try {
      const backend = await AttentionXBackend.create({
        repository: await repository('sync-keepalive'),
        settingsStore: new MemorySettings({
          secretKeyHex: hex(generateSecretKey()),
          relays: ['wss://relay.example'],
          syncIntervalMinutes: 0,
        }),
        relay: new FakeRelay(),
        now: () => 400_000,
      })

      await backend.handleRequest({
        type: 'SET_SYNC_STRATEGY',
        version: 1,
        strategy: 'frontier-continuous',
      })
      expect(createSpy).toHaveBeenCalledWith(LIVE_SYNC_KEEPALIVE_ALARM, {
        periodInMinutes: LIVE_SYNC_KEEPALIVE_PERIOD_MIN,
      })
      expect(createSpy).toHaveBeenCalledWith(MAINTENANCE_ALARM, {
        periodInMinutes: WOT_SYNC_INTERVAL_DEFAULT_MINUTES,
      })
      const started = await backend.handleRequest({
        type: 'GET_WOT_SYNC_STATUS',
        version: 1,
      })
      expect(started).toMatchObject({ strategy: 'frontier-continuous' })
      expect(
        started &&
          typeof started === 'object' &&
          'state' in started &&
          (started.state === 'connecting' || started.state === 'live'),
      ).toBe(true)

      await backend.handleRequest({ type: 'STOP_WOT_SYNC', version: 1 })
      expect(clearSpy).toHaveBeenCalledWith(LIVE_SYNC_KEEPALIVE_ALARM)

      getSpy.mockClear()
      await backend.keepLiveSyncWarm()
      expect(
        await backend.handleRequest({
          type: 'GET_WOT_SYNC_STATUS',
          version: 1,
        }),
      ).toMatchObject({ state: 'stopped' })
    } finally {
      createSpy.mockRestore()
      clearSpy.mockRestore()
      getSpy.mockRestore()
    }
  })

  it('reconnects continuous sync after a worker-style idle wake', async () => {
    const backend = await AttentionXBackend.create({
      repository: await repository('sync-keepalive-idle'),
      settingsStore: new MemorySettings({
        secretKeyHex: hex(generateSecretKey()),
        relays: ['wss://relay.example'],
        syncStrategy: 'global-continuous',
      }),
      relay: new FakeRelay(),
      now: () => 400_000,
    })

    await backend.keepLiveSyncWarm()
    const status = await backend.handleRequest({
      type: 'GET_WOT_SYNC_STATUS',
      version: 1,
    })
    expect(status).toMatchObject({ strategy: 'global-continuous' })
    expect(
      status &&
        typeof status === 'object' &&
        'state' in status &&
        (status.state === 'connecting' || status.state === 'live'),
    ).toBe(true)
  })

  it('persists the external Nostr profiles toggle', async () => {
    const settings = new MemorySettings({
      secretKeyHex: hex(generateSecretKey()),
      relays: ['wss://relay.example'],
    })
    const backend = await AttentionXBackend.create({
      repository: await repository('external-profiles'),
      settingsStore: settings,
      relay: new FakeRelay(),
      now: () => 400_000,
    })

    expect(
      await backend.handleRequest({
        type: 'GET_EXTERNAL_PROFILES',
        version: 1,
      }),
    ).toEqual({ enabled: true })
    expect(
      await backend.handleRequest({
        type: 'SET_EXTERNAL_PROFILES',
        version: 1,
        enabled: false,
      }),
    ).toEqual({ enabled: false })
    expect(settings.value).toMatchObject({ externalProfilesEnabled: false })
  })

  it('defaults, clamps, and persists storage retention knobs', async () => {
    const settings = new MemorySettings({
      secretKeyHex: hex(generateSecretKey()),
      relays: ['wss://relay.example'],
    })
    const backend = await AttentionXBackend.create({
      repository: await repository('retention-knobs'),
      settingsStore: settings,
      relay: new FakeRelay(),
      now: () => 400_000,
      storageManager: {
        estimate: async () => ({ usage: 1024, quota: 10 * 1024 ** 3 }),
        persisted: async () => true,
        persist: async () => true,
      },
    })

    const initial = (await backend.handleRequest({
      type: 'GET_STORAGE_RETENTION',
      version: 1,
    })) as StorageRetentionState
    expect(initial.settings).toEqual(STORAGE_RETENTION_DEFAULTS)
    expect(initial.stats).toMatchObject({
      usageBytes: 1024,
      quotaBytes: 10 * 1024 ** 3,
      persisted: true,
      budgetStatus: 'ok',
    })

    const next = (await backend.handleRequest({
      type: 'SET_STORAGE_RETENTION',
      version: 1,
      settings: {
        softBudgetMb: 900,
        hardBudgetMb: 100,
        postIdleDays: 1,
        userIdleDays: 400,
      } as never,
    })) as StorageRetentionState
    expect(next.settings).toEqual({
      softBudgetMb: 900,
      hardBudgetMb: 900,
      postIdleDays: 7,
      prunePostEvents: false,
      pruneUserEvents: false,
    })
    expect(settings.value).toMatchObject({ storageRetention: next.settings })

    await expect(
      backend.handleRequest({
        type: 'SET_STORAGE_RETENTION',
        version: 1,
        settings: null as never,
      }),
    ).rejects.toThrow('Invalid storage retention settings')
  })

  it('keeps the prune alarm only while a prune toggle is on', async () => {
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome
    const createSpy = vi.spyOn(chromeApi.alarms, 'create').mockResolvedValue()
    const clearSpy = vi.spyOn(chromeApi.alarms, 'clear').mockResolvedValue()
    try {
      const backend = await AttentionXBackend.create({
        repository: await repository('retention-alarm'),
        settingsStore: new MemorySettings({ relays: ['wss://relay.example'] }),
        relay: new FakeRelay(),
        now: () => 400_000,
        storageManager: {
          estimate: async () => ({}),
          persisted: async () => true,
          persist: async () => true,
        },
      })
      await backend.handleRequest({
        type: 'SET_STORAGE_RETENTION',
        version: 1,
        settings: { ...STORAGE_RETENTION_DEFAULTS, prunePostEvents: true },
      })
      expect(createSpy).toHaveBeenCalledWith(STORAGE_PRUNE_ALARM, {
        periodInMinutes: STORAGE_PRUNE_PERIOD_MIN,
      })

      clearSpy.mockClear()
      await backend.handleRequest({
        type: 'SET_STORAGE_RETENTION',
        version: 1,
        settings: { ...STORAGE_RETENTION_DEFAULTS },
      })
      expect(clearSpy).toHaveBeenCalledWith(STORAGE_PRUNE_ALARM)
    } finally {
      createSpy.mockRestore()
      clearSpy.mockRestore()
    }
  })

  it('prunes old outside-WoT events on a tick and reports them in stats first', async () => {
    const day = 24 * 60 * 60 * 1000
    const now = 400 * day
    const store = await repository('retention-prune-tick')
    const outside = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:900' },
        value: '1',
        context: 'identity',
        scopes: ['x.com'],
        k: 'user:id',
        content: '',
        createdAt: 10,
      }),
      generateSecretKey(),
    )
    await store.ingestEvent({ event: outside, firstSeenAt: 1 })
    const backend = await AttentionXBackend.create({
      repository: store,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(generateSecretKey()),
        relays: ['wss://relay.example'],
        storageRetention: { pruneUserEvents: true },
      }),
      relay: new FakeRelay(),
      now: () => now,
      storageManager: {
        estimate: async () => ({ usage: 600 * 1024 * 1024 }),
        persisted: async () => true,
        persist: async () => true,
      },
    })

    const before = (await backend.handleRequest({
      type: 'GET_STORAGE_RETENTION',
      version: 1,
    })) as StorageRetentionState
    expect(before.stats.outsideWot).toMatchObject({ authors: 1, events: 1 })

    expect(await backend.runStoragePrune()).toMatchObject({ lastDeleted: 1 })
    expect(await store.getEvent(outside.id)).toBeUndefined()

    const after = (await backend.handleRequest({
      type: 'GET_STORAGE_RETENTION',
      version: 1,
    })) as StorageRetentionState
    expect(after.stats.outsideWot).toMatchObject({ authors: 0, events: 0 })
    expect(after.stats.prune).toMatchObject({ lastRunAt: now, totalDeleted: 1 })
  })

  it('keeps pruned post skeletons through orphan cleanup and clears them on sighting', async () => {
    const store = await repository('retention-skeleton')
    await store.upsertXPostChrome({ postId: '99', headline: 'kept' }, 1)
    await store.markXPostsPruned(['99'], 2)
    const backend = await AttentionXBackend.create({
      repository: store,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(generateSecretKey()),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 400_000,
    })

    await backend.handleRequest({
      type: 'PUBLISH_TRUST_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'post:id:88' },
      value: '1',
    })
    expect(await store.getXPost('99')).toMatchObject({ prunedAt: 2 })

    expect(
      await backend.handleRequest({
        type: 'UPSERT_X_POST_CHROME',
        version: 1,
        posts: [{ postId: '99', headline: 'seen again' }],
      }),
    ).toMatchObject({ upserted: 1 })
    const row = await store.getXPost('99')
    expect(row?.prunedAt).toBeUndefined()
    expect(row?.headline).toBe('seen again')
  })

  it('requests persistent storage only when not yet persisted', async () => {
    const persist = vi.fn(async () => true)
    await AttentionXBackend.create({
      repository: await repository('retention-persist'),
      settingsStore: new MemorySettings({ relays: ['wss://relay.example'] }),
      relay: new FakeRelay(),
      storageManager: {
        estimate: async () => ({}),
        persisted: async () => false,
        persist,
      },
    })
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1))

    const alreadyPersisted = vi.fn(async () => true)
    await AttentionXBackend.create({
      repository: await repository('retention-persisted'),
      settingsStore: new MemorySettings({ relays: ['wss://relay.example'] }),
      relay: new FakeRelay(),
      storageManager: {
        estimate: async () => ({}),
        persisted: async () => true,
        persist: alreadyPersisted,
      },
    })
    await Promise.resolve()
    expect(alreadyPersisted).not.toHaveBeenCalled()
  })

  it('counts idle post events and excludes the operator’s own statements', async () => {
    const day = 24 * 60 * 60 * 1000
    const now = 400 * day
    const ownKey = generateSecretKey()
    const store = await repository('retention-stats')
    const postTrust = async (key: Uint8Array, createdAt: number) =>
      finalizeEvent(
        await buildKind32009Event({
          subject: { type: 'i', value: 'post:id:77' },
          value: '1',
          context: '',
          scopes: ['x.com'],
          k: 'post:id',
          content: '',
          createdAt,
        }),
        key,
      )
    await store.ingestEvent({ event: await postTrust(generateSecretKey(), 10) })
    await store.ingestEvent({ event: await postTrust(ownKey, 11) })
    await store.upsertXPostChrome({ postId: '77' }, now - 200 * day)
    await store.upsertXPostChrome({ postId: '88' }, now - day)
    await store.putXIdentity({
      twitterId: '500',
      handle: 'quiet',
      state: 'unverified',
      createdAt: 1,
      updatedAt: 1,
      lastSeen: now - 400 * day,
    })
    await store.ingestEvent({
      event: finalizeEvent(
        await buildKind32009Event({
          subject: { type: 'i', value: 'user:id:500' },
          value: '1',
          context: 'identity',
          scopes: ['x.com'],
          k: 'user:id',
          content: '',
          createdAt: 12,
        }),
        generateSecretKey(),
      ),
    })

    const backend = await AttentionXBackend.create({
      repository: store,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(ownKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => now,
      storageManager: {
        estimate: async () => ({ usage: 600 * 1024 * 1024 }),
        persisted: async () => false,
        persist: async () => false,
      },
    })

    const { stats } = (await backend.handleRequest({
      type: 'GET_STORAGE_RETENTION',
      version: 1,
    })) as StorageRetentionState
    expect(stats.budgetStatus).toBe('overSoft')
    expect(stats.persisted).toBe(false)
    expect(stats.eventCount).toBe(3)
    expect(stats.avgEventBytes).toBeGreaterThan(0)
    expect(stats.idlePosts).toMatchObject({ rows: 1, seenOnce: 1, events: 1 })
    expect(stats.idlePosts.estimatedBytes).toBe(stats.avgEventBytes)
    expect(stats).not.toHaveProperty('idleUsers')

    const cockpit = await backend.getCockpitState()
    expect(cockpit.storage.retention?.stats.idlePosts.events).toBe(1)
    expect(cockpit.storage.idleBuckets).toHaveLength(4)
    expect(
      cockpit.storage.idleBuckets.find((bucket) => bucket.days === 365)?.users,
    ).toBe(1)
  })

  it('starts interval sync from the public local-account mirror while locked', async () => {
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)
    await chrome.storage.local.set({
      accounts: [
        {
          id: 'acct-1',
          name: 'Locked',
          pubkey,
          type: 'generated',
          readOnly: false,
        },
      ],
      activeAccountId: 'acct-1',
    })
    const relay = new FakeRelay()
    const backend = await AttentionXBackend.create({
      repository: await repository('sync-locked'),
      settingsStore: new MemorySettings({
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 400_000,
    })

    expect(vault.isLocked()).toBe(true)
    expect(
      await backend.handleRequest({
        type: 'START_WOT_SYNC',
        version: 1,
        limits: {
          maxDepth: 0,
          maxAuthorsPerLevel: 1,
          maxTotalAuthors: 1,
          maxEvents: 10,
        },
      }),
    ).toMatchObject({ state: 'running' })

    let status: unknown
    for (let attempt = 0; attempt < 50; attempt += 1) {
      status = await backend.handleRequest({
        type: 'GET_WOT_SYNC_STATUS',
        version: 1,
      })
      if (
        typeof status === 'object' &&
        status !== null &&
        'state' in status &&
        status.state !== 'running'
      ) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(status).toMatchObject({
      state: 'complete',
      result: { authors: [pubkey] },
    })
  })

  it('opens live frontier subscriptions after EOSE for continuous strategy', async () => {
    const secretKey = generateSecretKey()
    const relay = new FakeRelay()
    const backend = await AttentionXBackend.create({
      repository: await repository('sync-live'),
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
        syncStrategy: 'frontier-continuous',
      }),
      relay,
      now: () => 400_000,
    })

    const started = await backend.handleRequest({
      type: 'START_WOT_SYNC',
      version: 1,
    })
    expect(started).toMatchObject({
      state: 'connecting',
      strategy: 'frontier-continuous',
    })

    let status: unknown
    for (let attempt = 0; attempt < 50; attempt += 1) {
      status = await backend.handleRequest({
        type: 'GET_WOT_SYNC_STATUS',
        version: 1,
      })
      if (
        typeof status === 'object' &&
        status !== null &&
        'state' in status &&
        status.state === 'live'
      ) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(status).toMatchObject({
      state: 'live',
      strategy: 'frontier-continuous',
    })
    expect(relay.subscribeCalls).toBeGreaterThan(0)

    expect(
      await backend.handleRequest({ type: 'STOP_WOT_SYNC', version: 1 }),
    ).toMatchObject({ state: 'stopped' })
  })

  it('opens author-unfiltered global subscriptions for subscribe-all', async () => {
    const secretKey = generateSecretKey()
    const relay = new FakeRelay()
    const backend = await AttentionXBackend.create({
      repository: await repository('sync-global'),
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
        syncStrategy: 'global-continuous',
      }),
      relay,
      now: () => 400_000,
    })

    await backend.handleRequest({ type: 'START_WOT_SYNC', version: 1 })
    let status: unknown
    for (let attempt = 0; attempt < 50; attempt += 1) {
      status = await backend.handleRequest({
        type: 'GET_WOT_SYNC_STATUS',
        version: 1,
      })
      if (
        typeof status === 'object' &&
        status !== null &&
        'state' in status &&
        status.state === 'live'
      ) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(status).toMatchObject({
      state: 'live',
      strategy: 'global-continuous',
    })
    expect(relay.filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kinds: [32009] }),
        expect.objectContaining({ kinds: [32014], '#s': ['x.com'] }),
        expect.objectContaining({ kinds: [10011] }),
      ]),
    )
    expect(
      relay.filters.some(
        (filter) =>
          Array.isArray(filter.authors) && filter.authors.length > 0,
      ),
    ).toBe(false)
    await backend.handleRequest({ type: 'STOP_WOT_SYNC', version: 1 })
  })

  it('reconciles the maintenance alarm when the refresh interval changes', async () => {
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome
    const createSpy = vi.spyOn(chromeApi.alarms, 'create').mockResolvedValue()
    const clearSpy = vi.spyOn(chromeApi.alarms, 'clear').mockResolvedValue()

    try {
      const backend = await AttentionXBackend.create({
        repository: await repository('sync-interval-alarm'),
        settingsStore: new MemorySettings({
          secretKeyHex: hex(generateSecretKey()),
          relays: ['wss://relay.example'],
        }),
        relay: new FakeRelay(),
        now: () => 400_000,
      })

      await backend.handleRequest({
        type: 'SET_WOT_SYNC_INTERVAL',
        version: 1,
        intervalMinutes: 30,
      })
      expect(createSpy).toHaveBeenCalledWith(MAINTENANCE_ALARM, {
        periodInMinutes: 30,
      })

      await backend.handleRequest({
        type: 'SET_WOT_SYNC_INTERVAL',
        version: 1,
        intervalMinutes: 0,
      })
      expect(clearSpy).toHaveBeenCalledWith(MAINTENANCE_ALARM)

      await backend.handleRequest({
        type: 'SET_WOT_SYNC_INTERVAL',
        version: 1,
        intervalMinutes: 5,
      })
      expect(createSpy).toHaveBeenCalledWith(MAINTENANCE_ALARM, {
        periodInMinutes: 5,
      })
    } finally {
      createSpy.mockRestore()
      clearSpy.mockRestore()
    }
  })

  it('skips periodic sync when the refresh interval is paused', async () => {
    const secretKey = generateSecretKey()
    const relay = new FakeRelay()
    const backend = await AttentionXBackend.create({
      repository: await repository('sync-paused'),
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
        syncIntervalMinutes: 0,
      }),
      relay,
      now: () => 400_000,
    })

    await backend.runMaintenance()
    expect(relay.filters).toEqual([])
    expect(relay.queryEventsCalls).toBe(0)
  })

  it('runs periodic sync during maintenance with the default interval', async () => {
    const secretKey = generateSecretKey()
    const relay = new FakeRelay()
    const backend = await AttentionXBackend.create({
      repository: await repository('sync-default-interval'),
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 400_000,
    })

    await backend.runMaintenance()
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const status = (await backend.handleRequest({
        type: 'GET_WOT_SYNC_STATUS',
        version: 1,
      })) as { state?: string }
      if (status.state !== 'running') break
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(relay.filters.length).toBeGreaterThan(0)
  })

  it('persists the auto-lower guard toggle', async () => {
    const settings = new MemorySettings({
      secretKeyHex: hex(generateSecretKey()),
      relays: ['wss://relay.example'],
    })
    const backend = await AttentionXBackend.create({
      repository: await repository('auto-lower-setting'),
      settingsStore: settings,
      relay: new FakeRelay(),
      now: () => 400_000,
    })

    expect(
      await backend.handleRequest({ type: 'GET_WOT_AUTO_LOWER', version: 1 }),
    ).toEqual({ enabled: true })

    expect(
      await backend.handleRequest({
        type: 'SET_WOT_AUTO_LOWER',
        version: 1,
        enabled: false,
      }),
    ).toEqual({ enabled: false })
    expect(settings.value).toMatchObject({ wotAutoLower: false })
  })

  it('gates the auto-lower guard on the wotAutoLower setting', async () => {
    const secretKey = generateSecretKey()
    const settings = new MemorySettings({
      secretKeyHex: hex(secretKey),
      relays: ['wss://relay.example'],
      wotMaxDegree: 3,
      wotAutoLower: false,
    })
    const backend = await AttentionXBackend.create({
      repository: await repository('auto-lower-gated'),
      settingsStore: settings,
      relay: new FakeRelay(),
      now: () => 400_000,
    })

    // Simulate a slow cold resolve: first call starts the timer, the rest
    // report past the auto-lower threshold.
    let call = 0
    const perfSpy = vi.spyOn(performance, 'now').mockImplementation(() => {
      call += 1
      return call === 1 ? 0 : 5_000
    })
    try {
      await backend.handleRequest({
        type: 'QUERY_TRUST',
        version: 1,
        subject: { type: 'i', value: 'user:id:100' },
      })
      // Let any (suppressed) async auto-lower settle.
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(
        await backend.handleRequest({ type: 'GET_WOT_MAX_DEGREE', version: 1 }),
      ).toEqual({ degree: 3 })
    } finally {
      perfSpy.mockRestore()
    }
  })

  it('auto-lowers max degree on a slow resolve when the guard is on', async () => {
    const secretKey = generateSecretKey()
    const settings = new MemorySettings({
      secretKeyHex: hex(secretKey),
      relays: ['wss://relay.example'],
      wotMaxDegree: 3,
    })
    const backend = await AttentionXBackend.create({
      repository: await repository('auto-lower-on'),
      settingsStore: settings,
      relay: new FakeRelay(),
      now: () => 400_000,
    })

    let call = 0
    const perfSpy = vi.spyOn(performance, 'now').mockImplementation(() => {
      call += 1
      return call === 1 ? 0 : 5_000
    })
    try {
      await backend.handleRequest({
        type: 'QUERY_TRUST',
        version: 1,
        subject: { type: 'i', value: 'user:id:100' },
      })
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const after = (await backend.handleRequest({
          type: 'GET_WOT_MAX_DEGREE',
          version: 1,
        })) as { degree: number }
        if (after.degree === 2) return
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      throw new Error('auto-lower did not apply')
    } finally {
      perfSpy.mockRestore()
    }
  })

  it('gates proof composer on active account match and publishes after capture', async () => {
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)
    const npub = nip19.npubEncode(pubkey)
    const storage = await repository('proof-composer')
    const relay = new FakeRelay()
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 500_000,
      queryProofPost: async (postId) => ({
        status: 'found',
        post: {
          postId,
          authorHandle: 'nasa',
          text: `Linking my account to Nostr: ${npub}`,
        },
      }),
      fetch: async () =>
        new Response(
          '<script type="application/ld+json">{"mainEntity":{"identifier":"11348282"}}</script>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        ),
    })

    await expect(
      backend.handleRequest({
        type: 'PREPARE_X_PROOF_COMPOSER',
        version: 1,
        handle: 'nasa',
        twitterId: '11348282',
      }),
    ).rejects.toThrow(/Active X account/)

    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: 1,
      account: {
        handle: 'nasa',
        twitterId: '11348282',
        detectedAt: 1,
      },
    })
    await bindActiveVaultToX('11348282')

    const preview = await backend.handleRequest({
      type: 'PREPARE_X_PROOF_COMPOSER',
      version: 1,
      handle: 'nasa',
      twitterId: '11348282',
    })
    expect(preview).toMatchObject({
      handle: 'nasa',
      twitterId: '11348282',
      alreadyProven: false,
      proofText: expect.stringContaining(npub),
    })
    // Prepare must stay local-only so Create proof is not blocked by relays.
    expect(relay.queryEventsCalls).toBe(0)

    const confirmed = await backend.handleRequest({
      type: 'CONFIRM_X_PROOF_COMPOSER',
      version: 1,
      handle: 'nasa',
      twitterId: '11348282',
    })
    expect(confirmed).toMatchObject({
      decision: 'needs_proof',
      intentUrl: expect.stringContaining('https://x.com/intent/post'),
    })

    const published = await backend.handleRequest({
      type: 'CAPTURE_X_PROOF_POST',
      version: 1,
      proofTweetId: 'https://x.com/nasa/status/2080659774136291424',
    })
    expect(published).toMatchObject({
      deliveredTo: 0,
      deliveryStatus: 'pending',
    })
    const identityEvent = (await storage.getEventsByKind(10011))[0]!
    await publishOutboxNow(backend, identityEvent.id)
    expect(await storage.getXIdentity('11348282')).toMatchObject({
      state: 'verified',
    })
    expect(
      await backend.handleRequest({
        type: 'GET_PROOF_COMPOSER_SESSION',
        version: 1,
      }),
    ).toBeUndefined()
  })

  it('publishes proofless kind 10011 from the active X ID without Bio evidence', async () => {
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)
    const storage = await repository('independent-10011-binding')
    const queryProofPost = vi.fn()
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 500_000,
      queryProofPost,
    })

    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: 1,
      account: {
        handle: 'nasa',
        twitterId: '11348282',
        detectedAt: 1,
      },
    })
    await bindActiveVaultToX('11348282')

    expect(await storage.getXIdentity('11348282')).not.toHaveProperty('xNpub')

    const result = await backend.handleRequest({
      type: 'PUBLISH_X_BINDING',
      version: 1,
      handle: 'nasa',
      twitterId: '11348282',
    })
    expect(result).toMatchObject({
      status: 'published',
    })
    expect(result).not.toHaveProperty('proofPostId')
    expect(queryProofPost).not.toHaveBeenCalled()

    const event = (await storage.getEventsByKind(10011))[0]
    expect(event?.tags).toEqual(
      expect.arrayContaining([
        ['i', 'twitter:nasa'],
        ['i', 'twitter_id:11348282'],
      ]),
    )
    expect(await storage.getXIdentity('11348282')).toMatchObject({
      nip39Npub: nip19.npubEncode(pubkey).toLowerCase(),
    })
    expect(await storage.getXIdentity('11348282')).not.toHaveProperty(
      'nip39PostId',
    )
    expect(await storage.getXIdentity('11348282')).not.toHaveProperty('xNpub')
  })

  it('prepares Update bio from live description and stored xNpub', async () => {
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)
    const npub = nip19.npubEncode(pubkey)
    const otherNpub = `npub1${'z'.repeat(58)}`
    const storage = await repository('prepare-x-bio-edit')
    const chromeApi = chrome as unknown as {
      tabs: {
        query: typeof chrome.tabs.query
        sendMessage: typeof chrome.tabs.sendMessage
      }
    }
    const originalQuery = chromeApi.tabs.query
    const originalSend = chromeApi.tabs.sendMessage
    chromeApi.tabs.query = (async () => [
      { id: 11, active: true, url: 'https://x.com/nasa' },
    ]) as unknown as typeof chrome.tabs.query
    chromeApi.tabs.sendMessage = (async (
      _tabId: number,
      message: { type?: string; savedBioOnly?: boolean },
    ) => {
      if (message?.type === 'READ_ACTIVE_X_BIO') {
        if (message.savedBioOnly === true) return { found: false }
        return { found: true, bio: `Space agency.\n${otherNpub} (nostr)` }
      }
      return {}
    }) as unknown as typeof chrome.tabs.sendMessage

    try {
      await storage.putXIdentity({
        twitterId: '11348282',
        handle: 'nasa',
        state: 'verified',
        proofSource: 'bio',
        xNpub: otherNpub,
        xDate: 1_700_000_000_000,
        xObservedAt: 1_700_000_000_001,
        createdAt: 1,
        updatedAt: 1,
        lastSeen: 1,
      })
      const backend = await AttentionXBackend.create({
        repository: storage,
        settingsStore: new MemorySettings({
          secretKeyHex: hex(secretKey),
          relays: ['wss://relay.example'],
        }),
        relay: new FakeRelay(),
        now: () => 500_000,
      })

      const unmatched = await backend.handleRequest({
        type: 'PREPARE_X_BIO_EDIT',
        version: 1,
        handle: 'nasa',
        twitterId: '11348282',
      })
      expect(unmatched).toMatchObject({
        handle: 'nasa',
        twitterId: '11348282',
        tabMatch: false,
        bioRead: false,
        npub,
        editProfileUrl: 'https://x.com/settings/profile',
      })

      await backend.handleRequest({
        type: 'REPORT_ACTIVE_X_ACCOUNT',
        version: 1,
        account: {
          handle: 'nasa',
          twitterId: '11348282',
          detectedAt: 1,
        },
      })

      const pending = await backend.handleRequest({
        type: 'PREPARE_X_BIO_EDIT',
        version: 1,
        handle: 'nasa',
        twitterId: '11348282',
      })
      expect(pending).toMatchObject({
        handle: 'nasa',
        twitterId: '11348282',
        mode: 'replace',
        otherNpub,
        bioRead: true,
        tabMatch: true,
        npub,
        suffixUsed: 'none',
        editProfileUrl: 'https://x.com/settings/profile',
      })
      expect((pending as { suggestedBio: string }).suggestedBio).toContain(
        'Space agency',
      )
      expect((pending as { suggestedBio: string }).suggestedBio).toContain(
        otherNpub,
      )

      const confirmed = await backend.handleRequest({
        type: 'PREPARE_X_BIO_EDIT',
        version: 1,
        handle: 'nasa',
        twitterId: '11348282',
        confirmReplace: true,
      })
      expect(confirmed).toMatchObject({
        mode: 'replace',
        suffixUsed: 'nostr',
        bioRead: true,
        tabMatch: true,
      })
      expect((confirmed as { suggestedBio: string }).suggestedBio).toContain(
        'Space agency',
      )
      expect((confirmed as { suggestedBio: string }).suggestedBio).toContain(
        npub,
      )
      expect(
        (confirmed as { suggestedBio: string }).suggestedBio,
      ).not.toContain(otherNpub)

      const savedOnly = await backend.handleRequest({
        type: 'PREPARE_X_BIO_EDIT',
        version: 1,
        handle: 'nasa',
        twitterId: '11348282',
        savedBioOnly: true,
      })
      expect(savedOnly).toMatchObject({
        bioRead: false,
        tabMatch: true,
      })
    } finally {
      chromeApi.tabs.query = originalQuery
      chromeApi.tabs.sendMessage = originalSend
    }
  })

  it('OPEN_X_PROFILE_EDIT returns not-found when the tab is missing', async () => {
    const storage = await repository('open-x-profile-edit-missing')
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 500_000,
    })
    const result = await backend.handleRequest({
      type: 'OPEN_X_PROFILE_EDIT',
      version: 1,
      tabId: 999,
      handle: 'nasa',
    })
    expect(result).toEqual({ status: 'not-found' })
  })

  it('OPEN_X_PROFILE_EDIT retries until the content script answers', async () => {
    const storage = await repository('open-x-profile-edit-retry')
    const chromeApi = chrome as unknown as {
      tabs: { sendMessage: typeof chrome.tabs.sendMessage }
    }
    const originalSend = chromeApi.tabs.sendMessage
    let calls = 0
    chromeApi.tabs.sendMessage = (async () => {
      calls += 1
      if (calls < 3) throw new Error('Receiving end does not exist')
      return { status: 'opened' }
    }) as unknown as typeof chrome.tabs.sendMessage
    try {
      const backend = await AttentionXBackend.create({
        repository: storage,
        settingsStore: new MemorySettings({
          relays: ['wss://relay.example'],
        }),
        relay: new FakeRelay(),
        now: () => 500_000,
      })
      const result = await backend.handleRequest({
        type: 'OPEN_X_PROFILE_EDIT',
        version: 1,
        tabId: 1,
        handle: 'nasa',
      })
      expect(result).toEqual({ status: 'opened' })
      expect(calls).toBe(3)
    } finally {
      chromeApi.tabs.sendMessage = originalSend
    }
  })

  it('INGEST_SAVED_X_BIO writes xNpub from the saved profile description', async () => {
    const npub = nip19.npubEncode(getPublicKey(generateSecretKey()))
    const storage = await repository('ingest-saved-x-bio')
    const chromeApi = chrome as unknown as {
      tabs: { sendMessage: typeof chrome.tabs.sendMessage }
    }
    const originalSend = chromeApi.tabs.sendMessage
    chromeApi.tabs.sendMessage = (async (
      _tabId: number,
      message: { type?: string; savedBioOnly?: boolean },
    ) => {
      if (message?.type === 'READ_ACTIVE_X_BIO' && message.savedBioOnly === true) {
        return { found: true, bio: `Hello space.\n${npub} (nostr)` }
      }
      return {}
    }) as unknown as typeof chrome.tabs.sendMessage
    try {
      const backend = await AttentionXBackend.create({
        repository: storage,
        settingsStore: new MemorySettings({
          relays: ['wss://relay.example'],
        }),
        relay: new FakeRelay(),
        now: () => 500_000,
      })
      await backend.handleRequest({
        type: 'REPORT_ACTIVE_X_ACCOUNT',
        version: 1,
        account: {
          handle: 'nasa',
          twitterId: '11348282',
          detectedAt: 1,
        },
      })
      const result = await backend.handleRequest({
        type: 'INGEST_SAVED_X_BIO',
        version: 1,
        handle: 'nasa',
        twitterId: '11348282',
      })
      expect(result).toEqual({ bioRead: true, tabMatch: true })
      expect(await storage.getXIdentity('11348282')).toMatchObject({
        xNpub: npub.toLowerCase(),
      })
    } finally {
      chromeApi.tabs.sendMessage = originalSend
    }
  })

  it('clears xNpub when the bio npub does not decode', async () => {
    const storage = await repository('clear-bio-invalid-npub')
    const bound = nip19.npubEncode(getPublicKey(generateSecretKey()))
    await storage.putXIdentity({
      twitterId: '11348282',
      handle: 'nasa',
      state: 'unverified',
      xNpub: bound,
      xDate: 1_000,
      xObservedAt: 1_000,
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 9_000,
    })
    await backend.handleRequest({
      type: 'REPORT_X_BIO_CANDIDATES',
      version: 1,
      candidates: [
        {
          twitterId: '11348282',
          handle: 'nasa',
          npubCount: 1,
          npub: `npub1${'a'.repeat(20)}`,
          observedAt: 5_000,
        },
      ],
    })
    expect(await storage.getXIdentity('11348282')).not.toHaveProperty('xNpub')

    const other = nip19.npubEncode(getPublicKey(generateSecretKey()))
    await storage.putXIdentity({
      twitterId: '11348282',
      handle: 'nasa',
      state: 'unverified',
      xNpub: bound,
      xDate: 1_000,
      xObservedAt: 1_000,
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })
    await backend.handleRequest({
      type: 'REPORT_X_BIO_CANDIDATES',
      version: 1,
      candidates: [
        {
          twitterId: '11348282',
          handle: 'nasa',
          npubCount: 1,
          npub: other,
          observedAt: 6_000,
        },
      ],
    })
    expect(await storage.getXIdentity('11348282')).toMatchObject({
      xNpub: other,
    })
  })

  it('clears xNpub when a newer profile sighting has no npub', async () => {
    const storage = await repository('clear-bio-empty-profile')
    const npub = `npub1${'a'.repeat(58)}`
    await storage.putXIdentity({
      twitterId: '11348282',
      handle: 'nasa',
      state: 'unverified',
      xNpub: npub,
      xDate: 1_000,
      xObservedAt: 1_000,
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 9_000,
    })

    await backend.handleRequest({
      type: 'REPORT_X_BIO_CANDIDATES',
      version: 1,
      candidates: [
        {
          twitterId: '11348282',
          handle: 'nasa',
          npubCount: 0,
          observedAt: 5_000,
        },
      ],
    })
    expect(await storage.getXIdentity('11348282')).not.toHaveProperty('xNpub')

    await storage.putXIdentity({
      twitterId: '11348282',
      handle: 'nasa',
      state: 'unverified',
      xNpub: npub,
      xDate: 8_000,
      xObservedAt: 8_000,
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })
    await backend.handleRequest({
      type: 'REPORT_X_BIO_CANDIDATES',
      version: 1,
      candidates: [
        {
          twitterId: '11348282',
          handle: 'nasa',
          npubCount: 0,
          postId: '100',
          postCreatedAt: 2_000,
          observedAt: 9_000,
        },
      ],
    })
    expect(await storage.getXIdentity('11348282')).toMatchObject({
      xNpub: npub,
    })
  })

  it('checks local then relay kind-10011 before offering create proof', async () => {
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)
    const npub = nip19.npubEncode(pubkey)
    const proofPostId = '2080659774136291424'
    const event = finalizeEvent(
      buildKind10011Event({
        handle: 'nasa',
        twitterId: '11348282',
        proofPostId,
        createdAt: 100,
      }),
      secretKey,
    )
    const storage = await repository('check-x-proof')
    const relay = new FakeRelay()
    relay.queryResults = [event]
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 500_000,
      queryProofPost: async (postId) => ({
        status: 'found',
        post: {
          postId,
          authorHandle: 'nasa',
          text: `Linking my account to Nostr: ${npub}`,
        },
      }),
      fetch: async () =>
        new Response(
          '<script type="application/ld+json">{"mainEntity":{"identifier":"11348282"}}</script>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        ),
    })

    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: 1,
      account: {
        handle: 'nasa',
        twitterId: '11348282',
        detectedAt: 1,
      },
    })

    const missing = await backend.handleRequest({
      type: 'CHECK_X_PROOF',
      version: 1,
      handle: 'nasa',
      twitterId: '11348282',
      queryRelays: false,
      scanPage: false,
    })
    expect(missing).toMatchObject({ status: 'not_found' })

    // A found post proof alone is already sufficient to verify.
    await storage.putXIdentity({
      twitterId: '11348282',
      handle: 'nasa',
      postNpub: npub.toLowerCase(),
      postId: proofPostId,
      postHandle: 'nasa',
      postObservedAt: 1,
      state: 'verified',
      proofSource: 'post',
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })

    const found = await backend.handleRequest({
      type: 'CHECK_X_PROOF',
      version: 1,
      handle: 'nasa',
      twitterId: '11348282',
      queryRelays: true,
      scanPage: false,
    })
    expect(found).toMatchObject({
      status: 'verified',
      proofPostId,
      source: 'local-identity',
    })
    expect(await storage.getXIdentity('11348282')).toMatchObject({
      state: 'verified',
    })
  })

  it('records revalidated GraphQL proof posts in xPosts and preserves them', async () => {
    const secretKey = generateSecretKey()
    const proofSecret = generateSecretKey()
    const proofNpub = nip19.npubEncode(getPublicKey(proofSecret))
    const proofPostId = '2080659774136291424'
    const storage = await repository('proof-post-chrome')
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 500_000,
      queryProofPost: async (postId) => ({
        status: 'found',
        post: {
          postId,
          authorHandle: 'nasa',
          text: `Linking my account to Nostr: ${proofNpub}`,
        },
      }),
    })

    const result = await backend.handleRequest({
      type: 'REPORT_X_PROOF_CANDIDATES',
      version: 1,
      candidates: [
        {
          twitterId: '11348282',
          handle: 'nasa',
          postId: proofPostId,
          npub: proofNpub,
          fullText: `Linking my account to Nostr: ${proofNpub}`,
          postedAt: 400_000,
          observedAt: 400_001,
        },
      ],
    })
    expect(result).toEqual({ recorded: 1, skipped: 0 })
    expect(await storage.getXPost(proofPostId)).toMatchObject({
      postId: proofPostId,
      authorTwitterId: '11348282',
      authorHandle: 'nasa',
    })

    await storage.putXPost({
      postId: '999999',
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })
    await backend.handleRequest({
      type: 'PUBLISH_TRUST_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'post:id:123' },
      value: '1',
    })
    await backend.handleRequest({
      type: 'CANCEL_TRUST_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'post:id:123' },
    })

    expect(await storage.getXPost(proofPostId)).toBeDefined()
    expect(await storage.getXPost('999999')).toBeUndefined()
  })

  it('fails fast when NIP-39 relays hang and returns not_found', async () => {
    const secretKey = generateSecretKey()
    const storage = await repository('check-x-proof-hang')
    const relay = new FakeRelay()
    relay.hangUntilAbort = true
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 500_000,
      nip39RelayRefreshMs: 40,
      fetch: async () =>
        new Response(
          '<script type="application/ld+json">{"mainEntity":{"identifier":"11348282"}}</script>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        ),
    })

    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: 1,
      account: {
        handle: 'nasa',
        twitterId: '11348282',
        detectedAt: 1,
      },
    })

    const started = Date.now()
    const result = await backend.handleRequest({
      type: 'CHECK_X_PROOF',
      version: 1,
      handle: 'nasa',
      twitterId: '11348282',
      queryRelays: true,
      scanPage: false,
    })
    expect(Date.now() - started).toBeLessThan(1_500)
    expect(result).toMatchObject({ status: 'not_found' })
    expect(relay.queryEventsCalls).toBe(1)
  })

  it('keeps a resolved X numeric ID when the same handle is re-reported without one', async () => {
    const secretKey = generateSecretKey()
    const storage = await repository('active-x-no-downgrade')
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 500_000,
      fetch: async () =>
        new Response(
          '<div itemType="https://schema.org/ProfilePage"><div itemType="https://schema.org/Person"><meta itemProp="identifier" content="42"/></div></div>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        ),
    })

    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: 1,
      account: {
        handle: 'keutmann',
        twitterId: '42',
        detectedAt: 1,
      },
    })
    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: 1,
      account: {
        handle: 'keutmann',
        detectedAt: 2,
      },
    })

    const active = await backend.handleRequest({
      type: 'GET_ACTIVE_X_ACCOUNT',
      version: 1,
    })
    expect(active).toMatchObject({
      handle: 'keutmann',
      twitterId: '42',
    })

    const ensured = await backend.handleRequest({
      type: 'ENSURE_ACTIVE_X_ACCOUNT',
      version: 1,
    })
    expect(ensured).toMatchObject({
      status: 'ready',
      account: { handle: 'keutmann', twitterId: '42' },
    })
  })

  it('does not lose a stored active account when the live tab is unavailable', async () => {
    const secretKey = generateSecretKey()
    const storage = await repository('active-x-tab-miss')
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 500_000,
    })

    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: 1,
      account: {
        handle: 'keutmann',
        twitterId: '22551796',
        detectedAt: 1,
      },
    })

    const ensured = await backend.handleRequest({
      type: 'ENSURE_ACTIVE_X_ACCOUNT',
      version: 1,
    })
    expect(ensured).toMatchObject({
      status: 'ready',
      account: { handle: 'keutmann', twitterId: '22551796' },
    })
  })

  it('keeps the signed-in X account while Advanced Zone is focused', async () => {
    const secretKey = generateSecretKey()
    const backend = await AttentionXBackend.create({
      repository: await repository('active-x-cockpit-focus'),
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 500_000,
    })

    await backend.handleRequest(
      {
        type: 'REPORT_ACTIVE_X_ACCOUNT',
        version: 1,
        account: {
          handle: 'TrustProtocol',
          twitterId: '22551796',
          detectedAt: 1,
        },
      },
      { senderTabId: 1, senderWindowId: 1 },
    )

    setChromeQueriedTabs([
      {
        id: 8,
        windowId: 1,
        url: 'chrome-extension://attentionx-test/src/cockpit/index.html',
      },
    ])
    clearCachedFocusedProductTab()

    const active = await backend.handleRequest({
      type: 'GET_ACTIVE_X_ACCOUNT',
      version: 1,
    })
    expect(active).toMatchObject({
      handle: 'trustprotocol',
      twitterId: '22551796',
    })
  })

  it('identifies from the twid cookie when SideNav has no handle yet', async () => {
    const secretKey = generateSecretKey()
    const backend = await AttentionXBackend.create({
      repository: await repository('ensure-twid-without-handle'),
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
    })
    const chromeApi = chrome as typeof chrome & {
      cookies?: typeof chrome.cookies
    }
    const originalCookies = chromeApi.cookies
    const originalSend = chrome.tabs.sendMessage
    chromeApi.cookies = {
      get: async () => ({ value: 'u%3D44196397' }),
    } as unknown as typeof chrome.cookies
    chrome.tabs.sendMessage = (async () => ({
      account: null,
    })) as typeof chrome.tabs.sendMessage
    try {
      const ensured = await backend.handleRequest({
        type: 'ENSURE_ACTIVE_X_ACCOUNT',
        version: 1,
      })
      expect(ensured).toMatchObject({
        status: 'ready',
        account: { twitterId: '44196397' },
      })
    } finally {
      chromeApi.cookies = originalCookies
      chrome.tabs.sendMessage = originalSend
    }
  })

  it('uses GraphQL page search only when IndexedDB has no verified proof', async () => {
    const secretKey = generateSecretKey()
    const npub = nip19.npubEncode(getPublicKey(secretKey))
    const proofPostId = '2081383361348599871'
    const storage = await repository('check-x-proof-graphql-gate')
    const relay = new FakeRelay()
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome
    const originalQuery = chromeApi.tabs.query
    const originalSend = chromeApi.tabs.sendMessage
    let searchCalls = 0

    chromeApi.tabs.query = (async () => [
      { id: 3, url: 'https://x.com/home', status: 'complete' },
    ]) as unknown as typeof chrome.tabs.query
    chromeApi.tabs.sendMessage = (async (
      _tabId: number,
      message: { type?: string },
    ) => {
      if (message?.type === 'SEARCH_PROOF_POST') {
        searchCalls += 1
        return {
          postId: proofPostId,
          fullText: `Linking my account to Nostr: ${npub}`,
        }
      }
      return {}
    }) as unknown as typeof chrome.tabs.sendMessage

    try {
      const backend = await AttentionXBackend.create({
        repository: storage,
        settingsStore: new MemorySettings({
          secretKeyHex: hex(secretKey),
          relays: ['wss://relay.example'],
        }),
        relay,
        now: () => 500_000,
        queryProofPost: async (postId) => ({
          status: 'found',
          post: {
            postId,
            authorHandle: 'keutmann',
            text: `Linking my account to Nostr: ${npub}`,
          },
        }),
        fetch: async () =>
          new Response(
            '<script type="application/ld+json">{"mainEntity":{"identifier":"22551796"}}</script>',
            { status: 200, headers: { 'content-type': 'text/html' } },
          ),
      })

      await backend.handleRequest({
        type: 'REPORT_ACTIVE_X_ACCOUNT',
        version: 1,
        account: {
          handle: 'keutmann',
          twitterId: '22551796',
          detectedAt: 1,
        },
      })

      const missing = await backend.handleRequest({
        type: 'CHECK_X_PROOF',
        version: 1,
        handle: 'keutmann',
        twitterId: '22551796',
        queryRelays: false,
        scanPage: true,
      })
      expect(missing).toMatchObject({
        status: 'verified',
        proofPostId,
        source: 'page-scan',
      })
      expect(searchCalls).toBe(1)

      expect(await storage.getEventsByKind(10011)).toHaveLength(0)
      expect(await storage.getXIdentity('22551796')).toMatchObject({
        state: 'verified',
        proofSource: 'post',
        postId: proofPostId,
      })

      // xIdentity binding is already verified — GraphQL must not run again.
      const again = await backend.handleRequest({
        type: 'CHECK_X_PROOF',
        version: 1,
        handle: 'keutmann',
        twitterId: '22551796',
        queryRelays: false,
        scanPage: true,
      })
      expect(again).toMatchObject({
        status: 'verified',
        proofPostId,
        source: 'local-identity',
      })
      expect(searchCalls).toBe(1)

      // Local X-proof must also win without scanPage (post-publish UI refresh).
      const withoutScan = await backend.handleRequest({
        type: 'CHECK_X_PROOF',
        version: 1,
        handle: 'keutmann',
        twitterId: '22551796',
        queryRelays: false,
        scanPage: false,
      })
      expect(withoutScan).toMatchObject({
        status: 'verified',
        proofPostId,
        source: 'local-identity',
      })
      expect(searchCalls).toBe(1)
      expect(await storage.getEventsByKind(10011)).toHaveLength(0)
    } finally {
      chromeApi.tabs.query = originalQuery
      chromeApi.tabs.sendMessage = originalSend
    }
  })

  it('SEARCH_X_PROOF force-rescans self and discovers other-user proofs', async () => {
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)
    const npub = nip19.npubEncode(pubkey)
    const otherSecret = generateSecretKey()
    const otherNpub = nip19.npubEncode(getPublicKey(otherSecret))
    const selfPostId = '2080659774136291424'
    const otherPostId = '2081383361348599871'
    const storage = await repository('search-x-proof-force')
    const relay = new FakeRelay()
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome
    const originalQuery = chromeApi.tabs.query
    const originalSend = chromeApi.tabs.sendMessage
    let searchCalls = 0

    chromeApi.tabs.query = (async () => [
      { id: 7, url: 'https://x.com/home', status: 'complete' },
    ]) as unknown as typeof chrome.tabs.query
    chromeApi.tabs.sendMessage = (async (
      _tabId: number,
      message: { type?: string; handle?: string; npub?: string },
    ) => {
      if (message?.type === 'SEARCH_PROOF_POST') {
        searchCalls += 1
        if (message.handle === 'otheruser') {
          return {
            postId: otherPostId,
            fullText: `Linking my account to Nostr: ${otherNpub}`,
          }
        }
        return {
          postId: selfPostId,
          fullText: `Linking my account to Nostr: ${npub}`,
        }
      }
      return {}
    }) as unknown as typeof chrome.tabs.sendMessage

    try {
      const backend = await AttentionXBackend.create({
        repository: storage,
        settingsStore: new MemorySettings({
          secretKeyHex: hex(secretKey),
          relays: ['wss://relay.example'],
        }),
        relay,
        now: () => 500_000,
        queryProofPost: async (postId) => {
          if (postId === otherPostId) {
            return {
              status: 'found',
              post: {
                postId,
                authorHandle: 'otheruser',
                text: `Linking my account to Nostr: ${otherNpub}`,
              },
            }
          }
          return {
            status: 'found',
            post: {
              postId,
              authorHandle: 'keutmann',
              text: `Linking my account to Nostr: ${npub}`,
            },
          }
        },
        fetch: async () =>
          new Response(
            '<script type="application/ld+json">{"mainEntity":{"identifier":"22551796"}}</script>',
            { status: 200, headers: { 'content-type': 'text/html' } },
          ),
      })

      await backend.handleRequest({
        type: 'REPORT_ACTIVE_X_ACCOUNT',
        version: 1,
        account: {
          handle: 'keutmann',
          twitterId: '22551796',
          detectedAt: 1,
        },
      })

      // Seed incomplete local X-proof so plain CHECK would short-circuit.
      await backend.handleRequest({
        type: 'CHECK_X_PROOF',
        version: 1,
        handle: 'keutmann',
        twitterId: '22551796',
        queryRelays: false,
        scanPage: true,
      })
      expect(searchCalls).toBe(1)

      const forced = await backend.handleRequest({
        type: 'SEARCH_X_PROOF',
        version: 1,
        handle: 'keutmann',
        twitterId: '22551796',
        forceRescan: true,
      })
      expect(forced).toMatchObject({
        status: 'verified',
        proofPostId: selfPostId,
        source: 'explicit-search',
      })
      expect(searchCalls).toBe(2)

      const other = await backend.handleRequest({
        type: 'SEARCH_X_PROOF',
        version: 1,
        handle: 'otheruser',
        twitterId: '99900111',
        forceRescan: true,
      })
      expect(other).toMatchObject({
        status: 'verified',
        handle: 'otheruser',
        twitterId: '99900111',
        proofPostId: otherPostId,
        npub: otherNpub.toLowerCase(),
        source: 'explicit-search',
      })
      expect(searchCalls).toBe(3)
      expect(await storage.getXIdentity('99900111')).toMatchObject({
        postId: otherPostId,
        postNpub: otherNpub.toLowerCase(),
      })
    } finally {
      chromeApi.tabs.query = originalQuery
      chromeApi.tabs.sendMessage = originalSend
    }
  })

  it('self-verifies kind 10011 alone but never invents post-proof fields', async () => {
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)
    const npub = nip19.npubEncode(pubkey)
    const proofPostId = '2080659774136291999'
    const storage = await repository('nip39-does-not-write-xproof')
    const relay = new FakeRelay()

    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 500_000,
      queryProofPost: async (postId) => ({
        status: 'found',
        post: {
          postId,
          authorHandle: 'keutmann',
          text: `Linking my account to Nostr: ${npub}`,
        },
      }),
      fetch: async () =>
        new Response(
          '<script type="application/ld+json">{"mainEntity":{"identifier":"22551796"}}</script>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        ),
    })

    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: 1,
      account: {
        handle: 'keutmann',
        twitterId: '22551796',
        detectedAt: 1,
      },
    })
    await bindActiveVaultToX('22551796')

    // Publish 10011 without a prior found X proof.
    const published = await backend.handleRequest({
      type: 'PUBLISH_STAGED_X_PROOF',
      version: 1,
      handle: 'keutmann',
      twitterId: '22551796',
      proofTweetId: proofPostId,
    })
    expect(published).toMatchObject({
      deliveredTo: 0,
      deliveryStatus: 'pending',
    })
    const identityEvent = (await storage.getEventsByKind(10011))[0]!
    await publishOutboxNow(backend, identityEvent.id)

    const row = await storage.getXIdentity('22551796')
    expect(row).toMatchObject({
      nip39PostId: proofPostId,
      nip39Npub: npub.toLowerCase(),
      proofSource: 'nip39',
    })
    // 10011 self-verifies on write — but never invents post-proof columns.
    expect(row?.postId).toBeUndefined()
    expect(row?.postNpub).toBeUndefined()
    expect(row?.state).toBe('verified')
  })

  it('verifies a page-found post proof locally and can still publish kind 10011', async () => {
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)
    const npub = nip19.npubEncode(pubkey)
    const proofPostId = '2080659774136291424'
    const storage = await repository('check-x-proof-page-stage')
    const relay = new FakeRelay()
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome
    const originalQuery = chromeApi.tabs.query
    const originalSend = chromeApi.tabs.sendMessage

    chromeApi.tabs.query = (async () => [
      { id: 7, url: 'https://x.com/home', status: 'complete' },
    ]) as unknown as typeof chrome.tabs.query
    chromeApi.tabs.sendMessage = (async (
      _tabId: number,
      message: { type?: string },
    ) => {
      if (message?.type === 'SEARCH_PROOF_POST') {
        return {
          postId: proofPostId,
          fullText: `Linking my account to Nostr: ${npub}`,
        }
      }
      return {}
    }) as unknown as typeof chrome.tabs.sendMessage

    try {
      const backend = await AttentionXBackend.create({
        repository: storage,
        settingsStore: new MemorySettings({
          secretKeyHex: hex(secretKey),
          relays: ['wss://relay.example'],
        }),
        relay,
        now: () => 500_000,
        queryProofPost: async (postId) => ({
          status: 'found',
          post: {
            postId,
            authorHandle: 'nasa',
            text: `Linking my account to Nostr: ${npub}`,
          },
        }),
        fetch: async () =>
          new Response(
            '<script type="application/ld+json">{"mainEntity":{"identifier":"11348282"}}</script>',
            { status: 200, headers: { 'content-type': 'text/html' } },
          ),
      })

      await backend.handleRequest({
        type: 'REPORT_ACTIVE_X_ACCOUNT',
        version: 1,
        account: {
          handle: 'nasa',
          twitterId: '11348282',
          detectedAt: 1,
        },
      })
      await bindActiveVaultToX('11348282')

      const staged = await backend.handleRequest({
        type: 'CHECK_X_PROOF',
        version: 1,
        handle: 'nasa',
        twitterId: '11348282',
        queryRelays: true,
        scanPage: true,
      })
      expect(staged).toMatchObject({
        status: 'verified',
        proofPostId,
        source: 'page-scan',
      })
      expect(relay.published).toHaveLength(0)
      expect(await storage.getEventsByKind(10011)).toHaveLength(0)
      expect(await storage.getXIdentity('11348282')).toMatchObject({
        state: 'verified',
        proofSource: 'post',
        postId: proofPostId,
      })

      const published = await backend.handleRequest({
        type: 'PUBLISH_STAGED_X_PROOF',
        version: 1,
        handle: 'nasa',
        twitterId: '11348282',
        proofTweetId: proofPostId,
      })
      expect(published).toMatchObject({
        deliveredTo: 0,
        deliveryStatus: 'pending',
      })
      expect(relay.published).toHaveLength(0)
      const identityEvent = (await storage.getEventsByKind(10011))[0]!
      await publishOutboxNow(backend, identityEvent.id)
      expect(relay.published.length).toBeGreaterThan(0)
      expect(await storage.getEventsByKind(10011)).toHaveLength(1)
    } finally {
      chromeApi.tabs.query = originalQuery
      chromeApi.tabs.sendMessage = originalSend
    }
  })

  it('searches for a proof once when trusting an X account without xIdentity', async () => {
    const secretKey = generateSecretKey()
    const otherSecret = generateSecretKey()
    const otherPubkey = getPublicKey(otherSecret)
    const otherNpub = nip19.npubEncode(otherPubkey)
    const proofPostId = '2081383361348599871'
    const twitterId = '22551796'
    const storage = await repository('trust-triggers-proof-search')
    const relay = new FakeRelay()
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome
    const originalQuery = chromeApi.tabs.query
    const originalSend = chromeApi.tabs.sendMessage
    let searchCalls = 0
    let lastNpub: string | undefined

    chromeApi.tabs.query = (async () => [
      { id: 11, url: 'https://x.com/home', status: 'complete' },
    ]) as unknown as typeof chrome.tabs.query
    chromeApi.tabs.sendMessage = (async (
      _tabId: number,
      message: { type?: string; npub?: string },
    ) => {
      if (message?.type === 'SEARCH_PROOF_POST') {
        searchCalls += 1
        lastNpub = message.npub
        return {
          postId: proofPostId,
          fullText: `Linking my account to Nostr: ${otherNpub}`,
        }
      }
      return {}
    }) as unknown as typeof chrome.tabs.sendMessage

    try {
      const backend = await AttentionXBackend.create({
        repository: storage,
        settingsStore: new MemorySettings({
          secretKeyHex: hex(secretKey),
          relays: ['wss://relay.example'],
        }),
        relay,
        now: () => 600_000,
        queryProofPost: async (postId) => ({
          status: 'found',
          post: {
            postId,
            authorHandle: 'keutmann',
            text: `Linking my account to Nostr: ${otherNpub}`,
          },
        }),
      })

      await backend.handleRequest({
        type: 'PUBLISH_TRUST_STATEMENT',
        version: 1,
        subject: { type: 'i', value: `user:id:${twitterId}` },
        value: '1',
        hintHandle: 'keutmann',
      })

      expect(searchCalls).toBe(1)
      expect(lastNpub).toBeUndefined()
      expect(await storage.getXIdentity(twitterId)).toMatchObject({
        state: 'verified',
        proofSource: 'post',
        postId: proofPostId,
        postNpub: otherNpub.toLowerCase(),
      })
      const trustEvent = (await storage.getEventsByKind(32009))[0]!
      expect(trustEvent.tags).toContainEqual(['s', 'x.com'])
      expect(trustEvent.tags).toContainEqual([
        'i',
        `user:id:${twitterId}`,
        otherNpub.toLowerCase(),
      ])

      // Second trust must not re-search once xIdentity has an X-proof side.
      await backend.handleRequest({
        type: 'PUBLISH_TRUST_STATEMENT',
        version: 1,
        subject: { type: 'i', value: `user:id:${twitterId}` },
        value: '1',
        hintHandle: 'keutmann',
      })
      expect(searchCalls).toBe(1)
    } finally {
      chromeApi.tabs.query = originalQuery
      chromeApi.tabs.sendMessage = originalSend
    }
  })

  it('does not GraphQL-search when trusting a post subject', async () => {
    const secretKey = generateSecretKey()
    const storage = await repository('trust-post-no-search')
    const relay = new FakeRelay()
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome
    const originalQuery = chromeApi.tabs.query
    const originalSend = chromeApi.tabs.sendMessage
    let searchCalls = 0

    chromeApi.tabs.query = (async () => [
      { id: 12, url: 'https://x.com/home', status: 'complete' },
    ]) as unknown as typeof chrome.tabs.query
    chromeApi.tabs.sendMessage = (async (
      _tabId: number,
      message: { type?: string },
    ) => {
      if (message?.type === 'SEARCH_PROOF_POST') {
        searchCalls += 1
        return {}
      }
      return {}
    }) as unknown as typeof chrome.tabs.sendMessage

    try {
      const backend = await AttentionXBackend.create({
        repository: storage,
        settingsStore: new MemorySettings({
          secretKeyHex: hex(secretKey),
          relays: ['wss://relay.example'],
        }),
        relay,
        now: () => 600_000,
      })

      await backend.handleRequest({
        type: 'PUBLISH_TRUST_STATEMENT',
        version: 1,
        subject: { type: 'i', value: 'post:id:123' },
        value: '1',
        hintHandle: 'nasa',
      })
      expect(searchCalls).toBe(0)
    } finally {
      chromeApi.tabs.query = originalQuery
      chromeApi.tabs.sendMessage = originalSend
    }
  })

  it('previews and confirms kind 10011 publish with add, replace, and stale checks', async () => {
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)
    const npub = nip19.npubEncode(pubkey)
    const proofPostId = '2081383361348599870'
    const old = finalizeEvent(
      {
        kind: 10011,
        created_at: 1,
        content: 'keep me',
        tags: [
          ['i', 'github:octocat', 'proof-a'],
          ['client', 'attentionx'],
          ['i', 'twitter:old_handle', '111'],
          ['i', 'twitter_id:999', '111'],
        ],
      },
      secretKey,
    )
    const storage = await repository('identity-publish-preview')
    const relay = new FakeRelay()
    await storage.ingestEvent({
      event: old,
      observedAt: 1,
    })
    await storage.putXIdentity({
      twitterId: '11348282',
      handle: 'nasa',
      postNpub: npub.toLowerCase(),
      postId: proofPostId,
      postHandle: 'nasa',
      postObservedAt: 1,
      state: 'unverified',
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })

    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 10_000,
      queryProofPost: async (postId) => ({
        status: 'found',
        post: {
          postId,
          authorHandle: 'nasa',
          text: `Linking my account to Nostr: ${npub}`,
        },
      }),
      fetch: async () =>
        new Response(
          '<script type="application/ld+json">{"mainEntity":{"identifier":"11348282"}}</script>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        ),
    })

    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: 1,
      account: {
        handle: 'nasa',
        twitterId: '11348282',
        detectedAt: 1,
      },
    })

    const preview = (await backend.handleRequest({
      type: 'PREPARE_X_IDENTITY_PUBLISH',
      version: 1,
      handle: 'nasa',
      twitterId: '11348282',
      proofTweetId: proofPostId,
    })) as {
      change: string
      existingEventId: string | null
      existingTwitter?: { handle: string; twitterId: string }
      preservedTagCount: number
      preservesContent: boolean
      eventPreview: { content: string; tags: string[][] }
    }
    expect(preview).toMatchObject({
      change: 'replace',
      existingEventId: old.id,
      existingTwitter: { handle: 'old_handle', twitterId: '999' },
      preservedTagCount: 2,
      preservesContent: true,
    })
    expect(preview.eventPreview.content).toBe('keep me')
    expect(preview.eventPreview.tags).toEqual(
      expect.arrayContaining([
        ['i', 'github:octocat', 'proof-a'],
        ['client', 'attentionx'],
        ['i', 'twitter:nasa', proofPostId, `post:id:${proofPostId}`],
        [
          'i',
          `twitter_id:11348282`,
          proofPostId,
          `post:id:${proofPostId}`,
        ],
      ]),
    )
    expect(preview.eventPreview.tags).not.toEqual(
      expect.arrayContaining([['i', 'twitter:old_handle', '111']]),
    )

    const refused = await backend.handleRequest({
      type: 'CONFIRM_X_IDENTITY_PUBLISH',
      version: 1,
      handle: 'nasa',
      twitterId: '11348282',
      proofTweetId: proofPostId,
      existingEventId: old.id,
      confirmReplacement: false,
    })
    expect(refused).toMatchObject({ status: 'replacement-required' })
    expect(relay.published).toHaveLength(0)

    const newer = finalizeEvent(
      buildKind10011Event({
        handle: 'someone',
        twitterId: '1',
        proofPostId: '2',
        createdAt: 5,
        existingEvent: old,
      }),
      secretKey,
    )
    await storage.ingestEvent({
      event: newer,
      observedAt: 5,
    })

    const stale = await backend.handleRequest({
      type: 'CONFIRM_X_IDENTITY_PUBLISH',
      version: 1,
      handle: 'nasa',
      twitterId: '11348282',
      proofTweetId: proofPostId,
      existingEventId: old.id,
      confirmReplacement: true,
    })
    expect(stale).toMatchObject({
      status: 'stale-preview',
      preview: { existingEventId: newer.id },
    })
    expect(relay.published).toHaveLength(0)

    const published = await backend.handleRequest({
      type: 'CONFIRM_X_IDENTITY_PUBLISH',
      version: 1,
      handle: 'nasa',
      twitterId: '11348282',
      proofTweetId: proofPostId,
      existingEventId: newer.id,
      confirmReplacement: true,
    })
    expect(published).toMatchObject({
      status: 'published',
      identityState: 'verified',
      deliveredTo: 0,
      deliveryStatus: 'pending',
      handle: 'nasa',
      twitterId: '11348282',
      proofPostId,
    })
    expect(relay.published).toHaveLength(0)
    const identityEvent = (await storage.getEventsByKind(10011)).at(-1)!
    await publishOutboxNow(backend, identityEvent.id)
    expect(relay.published.length).toBeGreaterThan(0)
    const stored = relay.published.at(-1)!
    expect(stored.tags).toEqual(
      expect.arrayContaining([
        ['i', 'github:octocat', 'proof-a'],
        ['client', 'attentionx'],
        ['i', 'twitter:nasa', proofPostId, `post:id:${proofPostId}`],
        [
          'i',
          `twitter_id:11348282`,
          proofPostId,
          `post:id:${proofPostId}`,
        ],
      ]),
    )
    expect(stored.content).toBe('keep me')
    expect(await storage.getXIdentity('11348282')).toMatchObject({
      state: 'verified',
      nip39XId: '11348282',
      postId: proofPostId,
    })
  })

  it('prepares an add preview when no kind 10011 exists yet', async () => {
    const secretKey = generateSecretKey()
    const npub = nip19.npubEncode(getPublicKey(secretKey))
    const proofPostId = '2081383361348599888'
    const storage = await repository('identity-publish-add')
    await storage.putXIdentity({
      twitterId: '11348282',
      handle: 'nasa',
      postNpub: npub.toLowerCase(),
      postId: proofPostId,
      postHandle: 'nasa',
      postObservedAt: 1,
      state: 'unverified',
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 20_000,
      queryProofPost: async (postId) => ({
        status: 'found',
        post: {
          postId,
          authorHandle: 'nasa',
          text: `Linking my account to Nostr: ${npub}`,
        },
      }),
      fetch: async () =>
        new Response(
          '<script type="application/ld+json">{"mainEntity":{"identifier":"11348282"}}</script>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        ),
    })
    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: 1,
      account: {
        handle: 'nasa',
        twitterId: '11348282',
        detectedAt: 1,
      },
    })
    const preview = await backend.handleRequest({
      type: 'PREPARE_X_IDENTITY_PUBLISH',
      version: 1,
      handle: 'nasa',
      twitterId: '11348282',
      proofTweetId: proofPostId,
    })
    expect(preview).toMatchObject({
      change: 'add',
      existingEventId: null,
      preservedTagCount: 0,
    })

    const published = await backend.handleRequest({
      type: 'CONFIRM_X_IDENTITY_PUBLISH',
      version: 1,
      handle: 'nasa',
      twitterId: '11348282',
      proofTweetId: proofPostId,
      existingEventId: null,
    })
    expect(published).toMatchObject({
      status: 'published',
      identityState: 'verified',
    })
    expect(await storage.getXIdentity('11348282')).toMatchObject({
      state: 'verified',
    })
  })

  it('SYNC_X_IDENTITY_STATUS verifies from post/10011 columns without oEmbed', async () => {
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)
    const npub = nip19.npubEncode(pubkey).toLowerCase()
    const twitterId = '22551796'
    const proofPostId = '2081383361348599871'
    const storage = await repository('sync-status-aligned-columns')

    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 50_000,
      queryProofPost: async () => ({ status: 'not-found' }),
      fetch: async () => new Response('fail', { status: 500 }),
    })

    // Post + matching 10011 columns → verified via precedence (no live oEmbed).
    await storage.putXIdentity({
      twitterId,
      handle: 'keutmann',
      postNpub: npub,
      postId: proofPostId,
      postHandle: 'keutmann',
      postDate: 1,
      postObservedAt: 1,
      nip39Npub: npub,
      nip39XId: twitterId,
      nip39Handle: 'keutmann',
      nip39PostId: proofPostId,
      nip39Date: 2,
      state: 'unverified',
      createdAt: 1,
      updatedAt: 2,
      lastSeen: 2,
    })

    const result = (await backend.handleRequest({
      type: 'SYNC_X_IDENTITY_STATUS',
      version: 1,
      twitterId,
    })) as {
      state: string
      changed: boolean
      proofSource?: string
    }

    expect(result).toMatchObject({
      state: 'verified',
      changed: true,
      proofSource: 'nip39',
    })
    expect(await storage.getXIdentity(twitterId)).toMatchObject({
      state: 'verified',
      proofSource: 'nip39',
      postId: proofPostId,
      nip39PostId: proofPostId,
    })
  })

  it('SYNC_X_IDENTITY_STATUS promotes when both sides align and live verify passes', async () => {
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)
    const npub = nip19.npubEncode(pubkey).toLowerCase()
    const twitterId = '22551798'
    const proofPostId = '2081383361348599873'
    const storage = await repository('sync-status-live-verify')

    const event = finalizeEvent(
      buildKind10011Event({
        handle: 'keutmann',
        twitterId,
        proofPostId,
        createdAt: 40,
      }),
      secretKey,
    )
    await storage.ingestEvent({ event, observedAt: 40 })

    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 50_000,
      queryProofPost: async (postId) => ({
        status: 'found',
        post: {
          postId,
          authorHandle: 'keutmann',
          text: `Linking my account to Nostr: ${npub}`,
        },
      }),
      fetch: async () =>
        new Response(
          `<script type="application/ld+json">{"mainEntity":{"identifier":"${twitterId}"}}</script>`,
          { status: 200, headers: { 'content-type': 'text/html' } },
        ),
    })

    // Second side arrives later — sync must live-verify and promote.
    await storage.putXIdentity({
      twitterId,
      handle: 'keutmann',
      postNpub: npub,
      postId: proofPostId,
      postHandle: 'keutmann',
      postObservedAt: 1,
      nip39Npub: npub,
      nip39XId: twitterId,
      nip39Handle: 'keutmann',
      nip39PostId: proofPostId,
      // nip39EventId removed: event.id,
      nip39Date: 2,
      state: 'unverified',
      createdAt: 1,
      updatedAt: 2,
      lastSeen: 2,
    })

    const result = (await backend.handleRequest({
      type: 'SYNC_X_IDENTITY_STATUS',
      version: 1,
      twitterId,
    })) as { state: string; changed: boolean }

    expect(result).toMatchObject({ state: 'verified', changed: true })
    expect(await storage.getXIdentity(twitterId)).toMatchObject({
      state: 'verified',
      postId: proofPostId,
      nip39PostId: proofPostId,
    })
  })

  it('SYNC_X_IDENTITY_STATUS preserves an already live-verified row when aligned', async () => {
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)
    const npub = nip19.npubEncode(pubkey).toLowerCase()
    const twitterId = '22551797'
    const proofPostId = '2081383361348599872'
    const storage = await repository('sync-status-keep-verified')

    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 50_000,
      queryProofPost: async () => ({ status: 'not-found' }),
      fetch: async () => new Response('fail', { status: 500 }),
    })

    await storage.putXIdentity({
      twitterId,
      handle: 'keutmann',
      postNpub: npub,
      postId: proofPostId,
      postHandle: 'keutmann',
      postDate: 1,
      postObservedAt: 1,
      nip39Npub: npub,
      nip39XId: twitterId,
      nip39Handle: 'keutmann',
      nip39PostId: proofPostId,
      nip39Date: 2,
      state: 'verified',
      proofSource: 'nip39',
      verifiedAt: 3,
      createdAt: 1,
      updatedAt: 2,
      lastSeen: 2,
    })

    const result = (await backend.handleRequest({
      type: 'SYNC_X_IDENTITY_STATUS',
      version: 1,
      twitterId,
    })) as { state: string; changed: boolean }

    expect(result).toMatchObject({ state: 'verified', changed: false })
    expect(await storage.getXIdentity(twitterId)).toMatchObject({
      state: 'verified',
      proofSource: 'nip39',
      verifiedAt: 3,
    })
  })

  it(
    'seeds and clears local-only demo WoT without publishing',
    async () => {
    const secretKey = generateSecretKey()
    const storage = await repository('demo-wot')
    const relay = new FakeRelay()
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 300_000,
    })

    for (let i = 0; i < 16; i += 1) {
      await storage.putXIdentity({
        twitterId: String(100 + i),
        handle: `user${100 + i}`,
        state: 'unverified',
        createdAt: 1,
        updatedAt: 1,
        lastSeen: 1,
      })
    }

    await bindActiveVaultToX('100')

    // Observed chain posts: Elon's latest is 9002, SpaceX's latest is 8001.
    await storage.upsertXPostChrome(
      {
        postId: '9001',
        authorTwitterId: '44196397',
        authorHandle: 'elonmusk',
        headline: 'Older Elon post',
      },
      100,
    )
    await storage.upsertXPostChrome(
      {
        postId: '9002',
        authorTwitterId: '44196397',
        authorHandle: 'elonmusk',
        headline: 'Latest Elon post',
      },
      200,
    )
    await storage.upsertXPostChrome(
      {
        postId: '8001',
        authorTwitterId: '34743251',
        authorHandle: 'spacex',
        headline: 'Latest SpaceX post',
      },
      150,
    )

    await backend.handleRequest({
      type: 'SET_APP_MODE',
      version: 1,
      mode: 'demo',
    })

    const seeded = (await backend.handleRequest({
      type: 'SEED_DEMO_WOT',
      version: 1,
    })) as {
      eventCount: number
      fakeAuthors: number
      maxDepth: number
      identitySubjects: number
      postSubjects: number
    }

    expect(seeded.maxDepth).toBe(4)
    expect(seeded.fakeAuthors).toBe(19)
    expect(seeded.identitySubjects).toBe(20)
    expect(seeded.postSubjects).toBe(2)
    expect(seeded.eventCount).toBeGreaterThan(60)
    expect(relay.published).toHaveLength(0)
    expect(await storage.getDueOutbox(Date.now() + 60_000)).toHaveLength(0)

    for (const member of DEMO_WOT_CHAIN) {
      expect(await storage.getXIdentity(member.twitterId)).toMatchObject({
        handle: member.handle,
        displayName: member.displayName,
      })
    }
    expect(
      (await storage.getXIdentity('44196397'))?.eventNpub,
    ).toBeUndefined()
    const elonEvents = (await storage.getEventsByKind(32009)).filter(
      (event) => event.pubkey === demoActorPubkey('44196397'),
    )
    expect(elonEvents.length).toBeGreaterThan(0)
    expect(elonEvents.every((event) => event.sig === '0'.repeat(128))).toBe(
      true,
    )
    // Demo never synthesizes posts — and the non-latest Elon post (9001) is
    // pruned by #pruneOrphanXPosts since only latest posts carry trust.
    const xPosts = await storage.getAllXPosts()
    expect(xPosts.map((row) => row.postId).sort()).toEqual(['8001', '9002'])

    const events = await storage.getEventsByKind(32009)
    expect(events.every((event) =>
      event.tags.some(
        (tag) => tag[0] === 'test' && tag[1] === 'attentionx-demo',
      ),
    )).toBe(true)

    const accountEvents = events.filter((event) =>
      event.tags.some((tag) => tag[0] === 'i' && tag[1]?.startsWith('user:id:')),
    )
    expect(accountEvents.length).toBeGreaterThan(0)
    const postEvents = events.filter((event) =>
      event.tags.some((tag) => tag[0] === 'i' && tag[1]?.startsWith('post:id:')),
    )
    // Only the latest observed post per chain account is trusted.
    expect(postEvents.length).toBeGreaterThan(0)
    expect(
      postEvents.every((event) => {
        const i = event.tags.find((tag) => tag[0] === 'i')?.[1]
        return i === 'post:id:9002' || i === 'post:id:8001'
      }),
    ).toBe(true)
    const ratingEvents = await storage.getEventsByKind(32014)
    expect(ratingEvents.length).toBeGreaterThan(0)
    // Ratings only target the latest observed Elon / SpaceX posts — never
    // non-latest posts, never other users' posts, never synthetic posts.
    expect(
      ratingEvents.every((event) => {
        const i = event.tags.find((tag) => tag[0] === 'i')?.[1]
        return i === 'post:id:9002' || i === 'post:id:8001'
      }),
    ).toBe(true)
    expect(
      ratingEvents.every((event) =>
        event.tags.some(
          (tag) => tag[0] === 'test' && tag[1] === 'attentionx-demo',
        ),
      ),
    ).toBe(true)
    expect(
      ratingEvents.every((event) =>
        event.tags.some((tag) => tag[0] === 'i' && tag[1]?.startsWith('post:id:')),
      ),
    ).toBe(true)
    expect(
      accountEvents.every((event) => {
        const i = event.tags.find((tag) => tag[0] === 'i')?.[1]
        const k = event.tags.find((tag) => tag[0] === 'k')?.[1]
        const s = event.tags.find((tag) => tag[0] === 's')?.[1]
        const d = event.tags.find((tag) => tag[0] === 'd')?.[1]
        const hasContext = event.tags.some((tag) => tag[0] === 'c')
        return (
          /^user:id:\d+$/.test(i ?? '') &&
          k === 'user:id' &&
          s === 'x.com' &&
          /^[0-9a-f]{64}$/.test(d ?? '') &&
          hasContext &&
          event.tags.some((tag) => tag[0] === 'c' && tag[1] === 'identity') &&
          !event.tags.some(
            (tag) =>
              tag[0] === 'i' &&
              (tag[1]?.startsWith('ext:twitter') || tag[1]?.startsWith('ext:x')),
          )
        )
      }),
    ).toBe(true)
    expect(
      postEvents.every((event) => {
        const i = event.tags.find((tag) => tag[0] === 'i')?.[1]
        const k = event.tags.find((tag) => tag[0] === 'k')?.[1]
        const s = event.tags.find((tag) => tag[0] === 's')?.[1]
        return (
          /^post:id:\d+$/.test(i ?? '') &&
          k === 'post:id' &&
          s === 'x.com'
        )
      }),
    ).toBe(true)

    const pubkeyEvents = events.filter((event) =>
      event.tags.some((tag) => tag[0] === 'p'),
    )
    expect(pubkeyEvents.length).toBeGreaterThan(0)
    expect(
      pubkeyEvents.every((event) => {
        const s = event.tags.find((tag) => tag[0] === 's')?.[1]
        const d = event.tags.find((tag) => tag[0] === 'd')?.[1]
        return s === undefined && /^[0-9a-f]{64}$/.test(d ?? '')
      }),
    ).toBe(true)

    expect(
      events.every((event) => {
        const i = event.tags.find((tag) => tag[0] === 'i')?.[1]
        const isPost = typeof i === 'string' && i.startsWith('post:id:')
        const isUser = typeof i === 'string' && i.startsWith('user:id:')
        const hasXScope = event.tags.some(
          (tag) => tag[0] === 's' && tag[1] === 'x.com',
        )
        return isPost || isUser
          ? hasXScope
          : !event.tags.some((tag) => tag[0] === 's')
      }),
    ).toBe(true)

    expect(
      events.every((event) => event.content.trim().length > 0),
    ).toBe(true)
    expect(
      events.some((event) => event.content === 'Trusted this account.'),
    ).toBe(false)

    const kind0 = await storage.getEventsByKind(0)
    const root = (await backend.handleRequest({
      type: 'GET_GRAPH_SNAPSHOT',
      version: 1,
    })) as { rootPubkey: string }
    expect(kind0).toHaveLength(seeded.fakeAuthors + 1)
    expect(kind0.some((event) => event.pubkey === root.rootPubkey)).toBe(true)
    expect(
      kind0.every((event) =>
        event.tags.some(
          (tag) => tag[0] === 'test' && tag[1] === 'attentionx-demo',
        ),
      ),
    ).toBe(true)
    const kind0Meta = kind0.map(
      (event) =>
        JSON.parse(event.content) as {
          name?: string
          display_name?: string
          picture?: string
        },
    )
    expect(
      new Set(
        kind0Meta.map((row) => row.display_name ?? row.name),
      ).size,
    ).toBe(seeded.fakeAuthors + 1)
    expect(new Set(kind0Meta.map((row) => row.picture)).size).toBeGreaterThanOrEqual(
      seeded.fakeAuthors,
    )
    expect(
      kind0Meta.every(
        (row) =>
          typeof row.picture === 'string' &&
          row.picture.startsWith('https://') &&
          !/twimg|twitter|x\.com/i.test(row.picture),
      ),
    ).toBe(true)
    const profileKeys = kind0.map((event) => `profile_${event.pubkey}`)
    const cached = (await chrome.storage.local.get(profileKeys)) as Record<
      string,
      { metadata?: { name?: string; picture?: string } }
    >
    for (const event of kind0) {
      const parsed = JSON.parse(event.content) as {
        name: string
        picture: string
      }
      expect(cached[`profile_${event.pubkey}`]?.metadata).toMatchObject({
        name: parsed.name,
        picture: parsed.picture,
      })
    }

    const queried = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:101' },
      bounds: { maxDepth: 5 },
    })) as { resolution: string; statements: { content?: string }[] }

    expect(queried.resolution).not.toBe('none')
    expect(queried.statements.length).toBeGreaterThan(0)
    expect(
      queried.statements.every(
        (row) => (row.content ?? '').trim().length > 0,
      ),
    ).toBe(true)

    const elon = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:44196397' },
      bounds: { maxDepth: 5 },
    })) as {
      resolution: string
      degree: number
      statements: { content?: string }[]
    }
    const spacex = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:34743251' },
      bounds: { maxDepth: 5 },
    })) as {
      resolution: string
      degree: number
      trust: number
      distrust: number
      statements: { value: number }[]
    }
    const tesla = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:13298072' },
      bounds: { maxDepth: 5 },
    })) as { resolution: string; degree: number; trust: number; distrust: number }
    const nasa = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:11348282' },
      bounds: { maxDepth: 5 },
    })) as { resolution: string; degree: number }
    expect(elon).toMatchObject({ resolution: 'trusted', degree: 1 })
    expect(elon.statements.length).toBeGreaterThan(0)
    expect(
      elon.statements.every((row) => (row.content ?? '').trim().length > 0),
    ).toBe(true)
    expect(spacex).toMatchObject({ resolution: 'trusted', degree: 2 })
    expect(spacex.trust).toBeGreaterThan(spacex.distrust)
    expect(spacex.distrust).toBeGreaterThan(0)
    expect(spacex.statements.some((row) => row.value === 0)).toBe(true)
    expect(tesla).toMatchObject({ resolution: 'trusted', degree: 3 })
    expect(tesla.trust).toBeGreaterThan(tesla.distrust)
    expect(tesla.distrust).toBeGreaterThan(0)
    expect(nasa).toMatchObject({ resolution: 'trusted', degree: 4 })

    const elonIdentity = await storage.getXIdentity('44196397')
    expect(elonIdentity?.eventNpub).toBeUndefined()
    const outgoing = (await backend.handleRequest({
      type: 'QUERY_OUTGOING_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:44196397' },
    })) as {
      unavailable?: boolean
      statements: { subject: { type: string; value: string } }[]
    }
    expect(outgoing.unavailable).toBeUndefined()
    expect(
      outgoing.statements.some(
        (row) =>
          row.subject.type === 'i' &&
          row.subject.value === 'user:id:34743251',
      ),
    ).toBe(true)

    const youTrust = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:100' },
      bounds: { maxDepth: 5 },
    })) as { resolution: string; statements: unknown[] }
    expect(youTrust.resolution).toBe('none')
    expect(youTrust.statements).toEqual([])
    const youOut = (await backend.handleRequest({
      type: 'QUERY_OUTGOING_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:100' },
    })) as {
      unavailable?: boolean
      statements: { subject: { type: string; value: string } }[]
    }
    expect(youOut.unavailable).toBeUndefined()
    expect(
      youOut.statements.some(
        (row) =>
          row.subject.type === 'i' &&
          row.subject.value === 'user:id:44196397',
      ),
    ).toBe(true)

    const cleared = (await backend.handleRequest({
      type: 'CLEAR_DEMO_WOT',
      version: 1,
    })) as { deleted: number; eventCount: number }

    expect(cleared.deleted).toBeGreaterThanOrEqual(seeded.eventCount)
    expect(cleared.eventCount).toBe(0)
    expect(await storage.getEventsByKind(32009)).toHaveLength(0)
    expect(await storage.getEventsByKind(0)).toHaveLength(0)
    expect(relay.published).toHaveLength(0)
  },
    60_000,
  )

  it(
    'adopts a late signed-in X without re-seeding demo events',
    async () => {
    const secretKey = generateSecretKey()
    const storage = await repository('demo-wot-reseed')
    const relay = new FakeRelay()
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 300_000,
    })

    for (let i = 0; i < 16; i += 1) {
      await storage.putXIdentity({
        twitterId: String(100 + i),
        handle: `user${100 + i}`,
        state: 'unverified',
        createdAt: 1,
        updatedAt: 1,
        lastSeen: 1,
      })
    }

    await backend.handleRequest({
      type: 'SET_APP_MODE',
      version: 1,
      mode: 'demo',
    })
    await backend.settleDemoGrowth()

    const sentinel = demoOperatorPubkey()
    const beforeIds = (await storage.getEventsByKind(32009))
      .map((event) => event.id)
      .sort()
    expect(beforeIds.length).toBeGreaterThan(0)
    expect(
      (await storage.getEventsByKind(32009)).some(
        (event) => event.pubkey === sentinel,
      ),
    ).toBe(true)

    const lateTwitterId = '888001'
    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: 1,
      account: {
        handle: 'lateuser',
        twitterId: lateTwitterId,
        detectedAt: 300_000,
      },
    })

    await backend.settleDemoGrowth()
    const afterEvents = await storage.getEventsByKind(32009)
    const afterIds = afterEvents.map((event) => event.id).sort()
    expect(beforeIds.every((id) => afterIds.includes(id))).toBe(true)
    expect(
      afterEvents.some(
        (event) =>
          event.pubkey === demoActorPubkey(lateTwitterId) &&
          event.subject === `user:id:${lateTwitterId}`,
      ),
    ).toBe(false)
    const afterLogin = (await backend.handleRequest({
      type: 'GET_GRAPH_SNAPSHOT',
      version: 1,
    })) as { rootPubkey: string }
    expect(afterLogin.rootPubkey).toBe(demoActorPubkey(lateTwitterId))
    expect(relay.published).toHaveLength(0)

    const youTrust = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: `user:id:${lateTwitterId}` },
      bounds: { maxDepth: 5 },
    })) as { resolution: string; statements: unknown[] }
    expect(youTrust.resolution).toBe('none')
    expect(youTrust.statements).toEqual([])

    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: 1,
      account: {
        handle: 'lateuser',
        twitterId: lateTwitterId,
        detectedAt: 300_001,
      },
    })
    await backend.settleDemoGrowth()
    expect(
      (await storage.getEventsByKind(32009)).map((event) => event.id).sort(),
    ).toEqual(afterIds)
  },
    60_000,
  )

  it(
    'switches app mode, keeps production events, and publishes demo trusts locally only',
    async () => {
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)
    const storage = await repository('app-mode')
    const relay = new FakeRelay()
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 400_000,
    })

    await storage.putXIdentity({
      twitterId: '777',
      handle: 'demoUser',
      state: 'unverified',
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })
    await bindActiveVaultToX('777')

    const liveTemplate = await buildKind32009Event({
      subject: { type: 'i', value: 'user:id:888' },
      value: '1',
      context: '',
      scopes: ['x.com'],
      k: 'user:id',
      content: '',
      createdAt: 100,
    })
    const liveEvent = finalizeEvent(liveTemplate, secretKey)
    await storage.ingestEvent({ event: liveEvent })

    const entered = (await backend.handleRequest({
      type: 'SET_APP_MODE',
      version: 1,
      mode: 'demo',
    })) as { mode: string; seeded: boolean }

    expect(entered.mode).toBe('demo')
    expect(entered.seeded).toBe(true)
    expect(await storage.getEvent(liveEvent.id)).toBeDefined()
    expect(
      (await storage.getEventIdsByState('demo')).length,
    ).toBeGreaterThan(0)

    const published = (await backend.handleRequest({
      type: 'PUBLISH_TRUST_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'user:id:777' },
      value: '1',
    })) as {
      eventId: string
      localOnly?: boolean
      deliveredTo: number
      attemptedRelays: number
    }

    expect(published.localOnly).toBe(true)
    expect(published.deliveredTo).toBe(0)
    expect(published.attemptedRelays).toBe(0)
    expect(relay.published).toHaveLength(0)
    expect(await storage.getOutbox(published.eventId)).toBeUndefined()
    expect((await storage.getEvent(published.eventId))?.state).toBe('demo')
    expect((await storage.getEvent(published.eventId))?.addressKey).toMatch(
      /:demo$/,
    )

    const left = (await backend.handleRequest({
      type: 'SET_APP_MODE',
      version: 1,
      mode: 'production',
    })) as { mode: string }

    expect(left.mode).toBe('production')
    expect(await storage.getEventIdsByState('demo')).toEqual([])
    expect(await storage.getEvent(liveEvent.id)).toBeDefined()
    expect(await storage.getEvent(published.eventId)).toBeUndefined()

    // Production graph should see the live event, not demo leftovers.
    const queried = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:888' },
      rootPubkey: pubkey,
    })) as { resolution: string }

    expect(queried.resolution).not.toBe('none')
  },
    30_000,
  )

  it('production graph loads all live 32009; demo loads only demo', async () => {
    const operatorKey = generateSecretKey()
    const operatorPubkey = getPublicKey(operatorKey)
    const strangerKey = generateSecretKey()
    const verifiedKey = generateSecretKey()
    const verifiedPubkey = getPublicKey(verifiedKey)
    const verifiedNpub = nip19.npubEncode(verifiedPubkey)
    const storage = await repository('graph-author-scope')
    await storage.putXIdentity({
      twitterId: '9001',
      handle: 'verifiedUser',
      postNpub: verifiedNpub.toLowerCase(),
      nip39Npub: verifiedNpub.toLowerCase(),
      state: 'verified',
      verifiedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })

    const operatorEvent = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:100' },
        value: '1',
        context: '',
        scopes: ['x.com'],
        k: 'user:id',
        content: '',
        createdAt: 10,
      }),
      operatorKey,
    )
    const strangerEvent = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:200' },
        value: '1',
        context: '',
        scopes: ['x.com'],
        k: 'user:id',
        content: '',
        createdAt: 11,
      }),
      strangerKey,
    )
    const verifiedEvent = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:300' },
        value: '1',
        context: '',
        scopes: ['x.com'],
        k: 'user:id',
        content: '',
        createdAt: 12,
      }),
      verifiedKey,
    )
    await storage.ingestEvent({ event: operatorEvent })
    await storage.ingestEvent({ event: strangerEvent })
    await storage.ingestEvent({ event: verifiedEvent })
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(operatorKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 450_000,
    })

    const operatorHit = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:100' },
      rootPubkey: operatorPubkey,
    })) as { resolution: string }
    expect(operatorHit.resolution).toBe('trusted')

    const strangerHit = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:200' },
      rootPubkey: getPublicKey(strangerKey),
    })) as { resolution: string }
    expect(strangerHit.resolution).toBe('trusted')

    const verifiedHit = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:300' },
      rootPubkey: verifiedPubkey,
    })) as { resolution: string }
    expect(verifiedHit.resolution).toBe('trusted')

    await backend.handleRequest({
      type: 'SET_APP_MODE',
      version: 1,
      mode: 'demo',
    })

    const demoMiss = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:100' },
      rootPubkey: operatorPubkey,
    })) as { resolution: string }
    expect(demoMiss.resolution).toBe('none')
    expect(await storage.getEvent(operatorEvent.id)).toBeDefined()
  }, 30_000)

  it('skips kind 32009 WoT sync in demo mode while allowing idle status', async () => {
    const secretKey = generateSecretKey()
    const relay = new FakeRelay()
    const storage = await repository('demo-no-32009-sync')
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
        mode: 'demo',
      }),
      relay,
      now: () => 500_000,
    })

    await storage.putXIdentity({
      twitterId: '42',
      handle: 'someone',
      state: 'unverified',
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })

    expect(
      await backend.handleRequest({
        type: 'START_WOT_SYNC',
        version: 1,
        limits: {
          maxDepth: 0,
          maxAuthorsPerLevel: 1,
          maxTotalAuthors: 1,
          maxEvents: 10,
        },
      }),
    ).toMatchObject({ state: 'idle' })

    expect(relay.filters).toEqual([])
    expect(relay.queryEventsCalls).toBe(0)

    await backend.runMaintenance()
    expect(relay.filters).toEqual([])
    expect(relay.queryEventsCalls).toBe(0)
  })

  it('applies Sync and Resolve max degree to queries and sync defaults', async () => {
    const secretKey = generateSecretKey()
    const settings = new MemorySettings({
      secretKeyHex: hex(secretKey),
      relays: ['wss://relay.example'],
      wotMaxDegree: 2,
    })
    const storage = await repository('wot-max-degree')
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: settings,
      relay: new FakeRelay(),
      now: () => 600_000,
    })

    const state = (await backend.handleRequest({
      type: 'GET_STATE',
    })) as { wotMaxDegree: number }
    expect(state.wotMaxDegree).toBe(2)

    await backend.handleRequest({
      type: 'SET_WOT_MAX_DEGREE',
      version: 1,
      degree: 3,
    })
    expect(settings.value).toMatchObject({ wotMaxDegree: 3 })

    const after = (await backend.handleRequest({
      type: 'GET_WOT_MAX_DEGREE',
      version: 1,
    })) as { degree: number }
    expect(after.degree).toBe(3)

    // Lowering does not clear stored events.
    await backend.handleRequest({
      type: 'PUBLISH_TRUST_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'post:id:999' },
      value: '1',
    })
    const beforeCount = (await storage.getEventsByKind(32009)).length
    await backend.handleRequest({
      type: 'SET_WOT_MAX_DEGREE',
      version: 1,
      degree: 1,
    })
    expect((await storage.getEventsByKind(32009)).length).toBe(beforeCount)

    const cockpit = (await backend.handleRequest({
      type: 'GET_COCKPIT_STATE',
    })) as {
      resolveTiming: {
        byDegree: Record<string, { samples: number }>
        noMatch: { samples: number }
      }
      extension: { wotMaxDegree: number }
    }
    expect(cockpit.extension.wotMaxDegree).toBe(1)
    expect(cockpit.resolveTiming.byDegree['1']).toBeDefined()
    expect(cockpit.resolveTiming.noMatch).toBeDefined()
  })

  it('applies follow-trust threshold to queries and echoes it on results', async () => {
    const secretKey = generateSecretKey()
    const settings = new MemorySettings({
      secretKeyHex: hex(secretKey),
      relays: ['wss://relay.example'],
    })
    const storage = await repository('follow-trust-threshold')
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: settings,
      relay: new FakeRelay(),
      now: () => 600_000,
    })

    const state = (await backend.handleRequest({
      type: 'GET_STATE',
    })) as { followTrustRed: number; followTrustGreen: number }
    expect(state.followTrustRed).toBe(25)
    expect(state.followTrustGreen).toBe(75)

    await backend.handleRequest({
      type: 'PUBLISH_TRUST_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'post:id:55' },
      value: '1',
    })
    const first = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'post:id:55' },
    })) as { followTrustThreshold: number; followTrustRed: number }
    expect(first.followTrustThreshold).toBe(75)
    expect(first.followTrustRed).toBe(25)

    await backend.handleRequest({
      type: 'SET_WOT_FOLLOW_TRUST_BAND',
      version: 1,
      red: 25,
      green: 50,
    })
    expect(settings.value).toMatchObject({
      followTrustRed: 25,
      followTrustGreen: 50,
    })

    const after = (await backend.handleRequest({
      type: 'GET_WOT_FOLLOW_TRUST_BAND',
      version: 1,
    })) as { red: number; green: number }
    expect(after).toEqual({ red: 25, green: 50 })

    const second = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'post:id:55' },
    })) as { followTrustThreshold: number; followTrustRed: number }
    expect(second.followTrustThreshold).toBe(50)
    expect(second.followTrustRed).toBe(25)

    const cockpit = (await backend.handleRequest({
      type: 'GET_COCKPIT_STATE',
    })) as { extension: { followTrustRed: number; followTrustGreen: number } }
    expect(cockpit.extension.followTrustGreen).toBe(50)
    expect(cockpit.extension.followTrustRed).toBe(25)
  })

  it('migrates a stored single followTrustThreshold into a red/green band', async () => {
    const settings = new MemorySettings({
      secretKeyHex: hex(generateSecretKey()),
      relays: ['wss://relay.example'],
      followTrustThreshold: 50,
    })
    const storage = await repository('follow-trust-band-migrate')
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: settings,
      relay: new FakeRelay(),
      now: () => 600_000,
    })

    expect(settings.value).toMatchObject({
      followTrustRed: 25,
      followTrustGreen: 50,
    })
    const state = (await backend.handleRequest({
      type: 'GET_STATE',
    })) as { followTrustRed: number; followTrustGreen: number }
    expect(state).toMatchObject({ followTrustRed: 25, followTrustGreen: 50 })
  })

  it('merges active-account profile into xIdentities only when data changes', async () => {
    const storage = await repository('active-account-profile')
    let now = 1_000
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(generateSecretKey()),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => now,
    })

    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome
    const identityUpdates: Array<{
      type?: string
      twitterId?: string
      statusChanged?: boolean
    }> = []
    const originalRuntimeSend = chromeApi.runtime.sendMessage
    chromeApi.runtime.sendMessage = (async (message: {
      type?: string
      twitterId?: string
      statusChanged?: boolean
    }) => {
      if (message?.type === 'X_IDENTITY_UPDATED') identityUpdates.push(message)
      return undefined
    }) as unknown as typeof chrome.runtime.sendMessage

    try {
    const reported = (await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: BACKGROUND_API_VERSION,
      account: {
        handle: 'nasa',
        twitterId: '11348282',
        detectedAt: now,
        displayName: 'NASA',
        iconPath: 'profile_images/11348282/nasa',
      },
    })) as {
      handle: string
      twitterId?: string
      displayName?: string
      iconPath?: string
    }
    expect(reported).toMatchObject({
      handle: 'nasa',
      twitterId: '11348282',
      displayName: 'NASA',
      iconPath: 'profile_images/11348282/nasa',
    })
    expect(await storage.getXIdentity('11348282')).toMatchObject({
      handle: 'nasa',
      displayName: 'NASA',
      iconPath: 'profile_images/11348282/nasa',
      createdAt: 1_000,
      updatedAt: 1_000,
      lastSeen: 1_000,
    })
    // First write (new row / chrome) may include a status sync broadcast plus a
    // chrome-only ping — never claim statusChanged on lastSeen-only later.
    expect(
      identityUpdates.some(
        (m) => m.twitterId === '11348282' && m.statusChanged === false,
      ),
    ).toBe(true)

    identityUpdates.length = 0
    now = 2_000
    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: BACKGROUND_API_VERSION,
      account: {
        handle: 'nasa',
        twitterId: '11348282',
        detectedAt: now,
        displayName: 'NASA',
        iconPath: 'profile_images/11348282/nasa',
      },
    })
    expect(await storage.getXIdentity('11348282')).toMatchObject({
      updatedAt: 1_000,
      lastSeen: 2_000,
    })
    // lastSeen-only must not broadcast (was flashing timeline chip spinners).
    expect(identityUpdates).toHaveLength(0)

    now = 3_000
    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: BACKGROUND_API_VERSION,
      account: {
        handle: 'nasa',
        twitterId: '11348282',
        detectedAt: now,
        displayName: 'National Aeronautics',
        iconPath: 'profile_images/11348282/nasa_new',
      },
    })
    expect(await storage.getXIdentity('11348282')).toMatchObject({
      displayName: 'National Aeronautics',
      iconPath: 'profile_images/11348282/nasa_new',
      updatedAt: 3_000,
      lastSeen: 3_000,
    })
    expect(identityUpdates).toEqual([
      expect.objectContaining({
        type: 'X_IDENTITY_UPDATED',
        twitterId: '11348282',
        statusChanged: false,
      }),
    ])

    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: BACKGROUND_API_VERSION,
      account: {
        handle: 'someone',
        detectedAt: 4_000,
      },
    })
    expect(await storage.getXIdentity('999')).toBeUndefined()
    expect(await storage.getAllXIdentities()).toHaveLength(1)

    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: BACKGROUND_API_VERSION,
      account: null,
    })
    } finally {
      chromeApi.runtime.sendMessage = originalRuntimeSend
    }
    expect(
      await backend.handleRequest({
        type: 'GET_ACTIVE_X_ACCOUNT',
        version: BACKGROUND_API_VERSION,
      }),
    ).toBeUndefined()
    expect(await storage.getXIdentity('11348282')).toMatchObject({
      displayName: 'National Aeronautics',
      iconPath: 'profile_images/11348282/nasa_new',
    })
  })

  it('preserves prior active profile fields across partial reports', async () => {
    const storage = await repository('active-account-partial')
    let now = 1_000
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(generateSecretKey()),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => now,
    })

    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: BACKGROUND_API_VERSION,
      account: {
        handle: 'nasa',
        twitterId: '11348282',
        detectedAt: now,
        displayName: 'NASA',
        iconPath: 'profile_images/11348282/nasa',
      },
    })

    now = 2_000
    const partial = (await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: BACKGROUND_API_VERSION,
      account: {
        handle: 'nasa',
        twitterId: '11348282',
        detectedAt: now,
        displayName: 'NASA',
      },
    })) as {
      displayName?: string
      iconPath?: string
    }
    expect(partial).toMatchObject({
      displayName: 'NASA',
      iconPath: 'profile_images/11348282/nasa',
    })
    expect(await storage.getXIdentity('11348282')).toMatchObject({
      displayName: 'NASA',
      iconPath: 'profile_images/11348282/nasa',
    })
  })

  it('normalizes mapped p: OPEN_SIDE_PANEL subjects to user:id', async () => {
    const secretKey = generateSecretKey()
    const pubkeyHex = getPublicKey(secretKey)
    const npub = nip19.npubEncode(pubkeyHex).toLowerCase()
    const storage = await repository('normalize-p-subject')
    await storage.putXIdentity({
      twitterId: '42',
      handle: 'bob',
      xNpub: npub,
      xDate: 1,
      state: 'verified',
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
    })
    const open = vi.fn(async () => undefined)
    ;(chrome as unknown as { sidePanel: { open: typeof open } }).sidePanel.open =
      open

    const mapped = await backend.handleRequest(
      {
        type: 'OPEN_SIDE_PANEL',
        version: 1,
        subject: { type: 'p', value: pubkeyHex },
      },
      { senderTabId: 3 },
    )
    expect(mapped).toMatchObject({
      opened: true,
      subject: { type: 'i', value: 'user:id:42' },
    })
    expect(open).not.toHaveBeenCalled()

    const unmappedHex = getPublicKey(generateSecretKey())
    const unmapped = await backend.handleRequest({
      type: 'SELECT_SUBJECT',
      version: 1,
      subject: { type: 'p', value: unmappedHex },
    })
    expect(unmapped).toEqual({
      subject: { type: 'p', value: unmappedHex },
    })
  })

  it('marks outgoing trust unavailable when a user:id has no author pubkey', async () => {
    const secretKey = generateSecretKey()
    const storage = await repository('outgoing-unavailable')
    await storage.putXIdentity({
      twitterId: '7',
      handle: 'nobody',
      state: 'unverified',
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
    })
    const result = await backend.handleRequest({
      type: 'QUERY_OUTGOING_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:7' },
    })
    expect(result).toMatchObject({
      statements: [],
      truncated: false,
      unavailable: true,
    })
  })

  it('prunes ineligible empty-scope 32014 winners on graph rebuild', async () => {
    const secretKey = generateSecretKey()
    const storage = await repository('prune-rating')
    const ineligible = finalizeEvent(
      await buildKind32014Event({
        subject: { type: 'i', value: 'post:id:1' },
        score: '50',
        scopes: [],
        createdAt: 1_700_000_000,
      }),
      secretKey,
    )
    await storage.ingestEvent({ event: ineligible })
    expect(await storage.getEvent(ineligible.id)).toBeDefined()
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
    })
    await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'post:id:1' },
    })
    expect(await storage.getEvent(ineligible.id)).toBeUndefined()
  })

  it('exposes distinct connectionKeys for the same d from two authors', async () => {
    const alice = generateSecretKey()
    const bob = generateSecretKey()
    const storage = await repository('connection-keys')
    const aliceEvent = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:42' },
        value: '1',
        scopes: ['x.com'],
        createdAt: 1_700_000_000,
      }),
      alice,
    )
    const bobEvent = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:42' },
        value: '1',
        scopes: ['x.com'],
        createdAt: 1_700_000_001,
      }),
      bob,
    )
    await storage.ingestEvent({ event: aliceEvent })
    await storage.ingestEvent({ event: bobEvent })
    const aliceKey = (await storage.getEvent(aliceEvent.id))?.addressKey
    const bobKey = (await storage.getEvent(bobEvent.id))?.addressKey
    expect(aliceKey).toBeTruthy()
    expect(bobKey).toBeTruthy()
    expect(aliceKey).not.toBe(bobKey)

    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(alice),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
    })
    const aliceOutgoing = (await backend.handleRequest({
      type: 'QUERY_OUTGOING_TRUST',
      version: 1,
      subject: { type: 'p', value: getPublicKey(alice) },
    })) as { statements: { connectionKey?: string }[] }
    expect(aliceOutgoing.statements[0]?.connectionKey).toBe(aliceKey)
  })

  it('fills signed-in X chrome onto identity displays and vault pubkeys', async () => {
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)
    const now = 1_700_000_000
    const storage = await repository('operator-display-chrome')
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => now,
    })
    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: BACKGROUND_API_VERSION,
      account: {
        handle: 'me',
        twitterId: '42',
        detectedAt: now,
        displayName: 'Operator',
        iconPath: 'profile_images/42/me',
      },
    })
    await bindActiveVaultToX('42')
    await storage.putXIdentity({
      twitterId: '42',
      handle: 'me',
      state: 'unverified',
      createdAt: now,
      updatedAt: now,
      lastSeen: now,
    })

    const byTwitter = (await backend.handleRequest({
      type: 'GET_X_IDENTITY_DISPLAYS',
      version: BACKGROUND_API_VERSION,
      twitterIds: ['42'],
    })) as Record<string, { displayName?: string; iconPath?: string }>
    expect(byTwitter['42']).toMatchObject({
      twitterId: '42',
      handle: 'me',
      displayName: 'Operator',
      iconPath: 'profile_images/42/me',
    })

    const own = (await backend.handleRequest({
      type: 'GET_X_IDENTITY',
      version: BACKGROUND_API_VERSION,
      twitterId: '42',
    })) as { identity: { displayName?: string; iconPath?: string } }
    expect(own.identity).toMatchObject({
      displayName: 'Operator',
      iconPath: 'profile_images/42/me',
    })
    const stored = await storage.getXIdentity('42')
    expect(stored?.displayName).toBeUndefined()
    expect(stored?.iconPath).toBeUndefined()

    const byPubkey = (await backend.handleRequest({
      type: 'GET_X_IDENTITY_DISPLAYS_FOR_PUBKEYS',
      version: BACKGROUND_API_VERSION,
      pubkeys: [pubkey],
    })) as Record<string, { twitterId?: string; displayName?: string }>
    expect(byPubkey[pubkey.toLowerCase()]).toMatchObject({
      twitterId: '42',
      handle: 'me',
      displayName: 'Operator',
      iconPath: 'profile_images/42/me',
    })
  })

  it('syncs operator kind 0 and 10011 locally without blocking bindings reads', async () => {
    const { account } = await accounts.generateNewAccount()
    if (!account.privkey) throw new Error('expected writable account')
    await vault.create('', {
      accounts: [account],
      activeAccountId: account.id,
    })
    const secret = hexToBytes(account.privkey)
    const pubkey = account.pubkey.toLowerCase()
    const older = finalizeEvent(
      {
        kind: 0,
        created_at: 50,
        tags: [],
        content: JSON.stringify({ name: 'Old' }),
      },
      secret,
    )
    const newer = finalizeEvent(
      {
        kind: 0,
        created_at: 80,
        tags: [],
        content: JSON.stringify({ name: 'New' }),
      },
      secret,
    )
    const stranger = generateSecretKey()
    const strangerEvent = finalizeEvent(
      {
        kind: 0,
        created_at: 90,
        tags: [],
        content: JSON.stringify({ name: 'Stranger' }),
      },
      stranger,
    )
    const nip39 = finalizeEvent(
      buildKind10011Event({
        handle: 'alice',
        twitterId: '42',
        proofPostId: '99',
        createdAt: 70,
      }),
      secret,
    )
    const storage = await repository('operator-meta-sync')
    const relay = new FakeRelay()
    relay.queryResults = [older, strangerEvent, newer, nip39]
    const sent: unknown[] = []
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((message) => {
      sent.push(message)
      return Promise.resolve()
    })
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 1_700_000_000,
    })

    const before = relay.queryEventsCalls
    const rows = (await backend.handleRequest({
      type: 'GET_OPERATOR_X_BINDINGS',
      version: BACKGROUND_API_VERSION,
    })) as { completeness?: { complete?: boolean } }[]
    expect(Array.isArray(rows)).toBe(true)
    expect(relay.queryEventsCalls).toBe(before)

    await backend.requestOperatorMetadataSync([pubkey])
    expect(relay.queryEventFilters[0]).toMatchObject({
      kinds: [0, 10011],
      authors: [pubkey],
    })
    expect(
      await storage.getEventByAddressKey(eventAddress(0, pubkey, '')),
    ).toMatchObject({ id: newer.id })
    await expect(peekProfileMetadata(pubkey)).resolves.toMatchObject({
      name: 'New',
    })
    expect(
      sent.some(
        (message) =>
          message &&
          typeof message === 'object' &&
          (message as { type?: string }).type ===
            PROFILE_METADATA_UPDATED_MESSAGE &&
          (message as { pubkey?: string }).pubkey === pubkey,
      ),
    ).toBe(true)
    expect(await storage.getEvent(strangerEvent.id)).toBeUndefined()
    expect(await storage.getEvent(nip39.id)).toBeTruthy()
    await forgetProfileMetadata([pubkey])
    vi.mocked(chrome.runtime.sendMessage).mockRestore()
  })

  it('drops old-key setup stamps and completeness when the X id is rebound', async () => {
    const first = await accounts.generateNewAccount('First')
    const second = await accounts.generateNewAccount('Second')
    await vault.create('', {
      accounts: [first.account, second.account],
      activeAccountId: first.account.id,
    })
    await writeLocalAccounts({
      accounts: [
        toLocalAccountEntry(first.account),
        toLocalAccountEntry(second.account),
      ],
      activeAccountId: first.account.id,
    })
    const firstNpub = nip19.npubEncode(first.account.pubkey).toLowerCase()
    const storage = await repository('rebind-operator-completeness')
    await storage.putXIdentity({
      twitterId: '42',
      handle: 'alice',
      xNpub: firstNpub,
      xDate: 10,
      nip39Npub: firstNpub,
      nip39Date: 10,
      state: 'verified',
      proofSource: 'nip39',
      createdAt: 10,
      updatedAt: 10,
      lastSeen: 10,
    })
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 1_700_000_000,
    })
    const bind = vaultRpcHandlers.get('bindAccountToX')
    if (!bind) throw new Error('bindAccountToX missing')
    await bind({ accountId: first.account.id, twitterId: '42' })
    await upsertXNostrBinding({
      twitterId: '42',
      pubkey: first.account.pubkey,
      updatedAt: 50,
      bioUpdatedAt: 50,
      publishedBindingAt: 50,
    })
    const identityMessages: unknown[] = []
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((message) => {
      identityMessages.push(message)
      return Promise.resolve()
    })

    await bind({
      accountId: second.account.id,
      twitterId: '42',
      reassign: true,
    })

    const sync = await readXNostrBindings()
    expect(sync.byTwitterId['42']?.pubkey).toBe(
      second.account.pubkey.toLowerCase(),
    )
    expect(sync.byTwitterId['42']?.bioUpdatedAt).toBeUndefined()
    expect(sync.byTwitterId['42']?.publishedBindingAt).toBeUndefined()
    expect(sync.byTwitterId['42']?.bioMismatchNpub).toBe(firstNpub)

    const rows = (await backend.handleRequest({
      type: 'GET_OPERATOR_X_BINDINGS',
      version: BACKGROUND_API_VERSION,
    })) as {
      twitterId: string
      completeness: {
        bioOk: boolean
        bioMismatch: boolean
        nip39Ok: boolean
      }
    }[]
    expect(rows.find((row) => row.twitterId === '42')?.completeness).toMatchObject({
      bioOk: false,
      bioMismatch: true,
      nip39Ok: false,
    })
    expect(
      identityMessages.some(
        (message) =>
          message &&
          typeof message === 'object' &&
          (message as { type?: string }).type === 'X_IDENTITY_UPDATED' &&
          (message as { twitterId?: string }).twitterId === '42',
      ),
    ).toBe(true)
    vi.mocked(chrome.runtime.sendMessage).mockRestore()
  })

  it('restamps Bio and 10011 when the new bound key already matches this X id', async () => {
    const { account } = await accounts.generateNewAccount('Match')
    await vault.create('', {
      accounts: [account],
      activeAccountId: account.id,
    })
    await writeLocalAccounts({
      accounts: [toLocalAccountEntry(account)],
      activeAccountId: account.id,
    })
    const npub = nip19.npubEncode(account.pubkey).toLowerCase()
    if (!account.privkey) throw new Error('expected writable account')
    const storage = await repository('rebind-operator-restamp')
    await storage.putXIdentity({
      twitterId: '77',
      handle: 'bob',
      xNpub: npub,
      xDate: 10,
      state: 'verified',
      proofSource: 'bio',
      createdAt: 10,
      updatedAt: 10,
      lastSeen: 10,
    })
    await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 1_700_000_000,
    })
    const nip39 = finalizeEvent(
      buildKind10011Event({
        handle: 'bob',
        twitterId: '77',
        createdAt: 70,
      }),
      hexToBytes(account.privkey),
    )
    await storage.ingestEvent({ event: nip39, observedAt: 1_700_000_000 })
    const bind = vaultRpcHandlers.get('bindAccountToX')
    if (!bind) throw new Error('bindAccountToX missing')
    await bind({ accountId: account.id, twitterId: '77' })

    const sync = await readXNostrBindings()
    expect(sync.byTwitterId['77']?.bioUpdatedAt).toBeTypeOf('number')
    expect(sync.byTwitterId['77']?.publishedBindingAt).toBeTypeOf('number')
    expect(vault.getAccountById(account.id)?.bioUpdatedAt).toBeTypeOf('number')
    expect(vault.getAccountById(account.id)?.publishedBindingAt).toBeTypeOf(
      'number',
    )
  })

  it(
    'impersonates demo Elon as viewer, publishes locally, and restores on revert',
    async () => {
    const secretKey = generateSecretKey()
    const storage = await repository('viewer-overlay-elon')
    const settings = new MemorySettings({
      secretKeyHex: hex(secretKey),
      relays: ['wss://relay.example'],
    })
    const relay = new FakeRelay()
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: settings,
      relay,
      now: () => 500_000,
    })
    for (let i = 0; i < 16; i += 1) {
      await storage.putXIdentity({
        twitterId: String(100 + i),
        handle: `user${100 + i}`,
        state: 'unverified',
        createdAt: 1,
        updatedAt: 1,
        lastSeen: 1,
      })
    }
    await backend.handleRequest({
      type: 'SET_APP_MODE',
      version: 1,
      mode: 'demo',
    })
    const elonPubkey = demoActorPubkey('44196397')
    expect((await storage.getXIdentity('44196397'))?.eventNpub).toBeUndefined()
    await backend.handleRequest({
      type: 'SEED_DEMO_WOT',
      version: 1,
    })
    expect((await storage.getXIdentity('44196397'))?.eventNpub).toBeUndefined()
    const viewer = (await backend.handleRequest({
      type: 'SET_VIEWER',
      version: 1,
      twitterId: '44196397',
    })) as {
      origin: string
      twitterId?: string
      pubkey?: string
      publish: string
      readOnly: boolean
    }
    expect(viewer).toMatchObject({
      origin: 'impersonation',
      twitterId: '44196397',
      pubkey: elonPubkey,
      publish: 'local',
      readOnly: false,
    })
    const snapshot = (await backend.handleRequest({
      type: 'GET_GRAPH_SNAPSHOT',
      version: 1,
    })) as { rootPubkey: string }
    expect(snapshot.rootPubkey).toBe(elonPubkey)
    const state = (await backend.handleRequest({
      type: 'GET_STATE',
    })) as { viewer?: { origin?: string; pubkey?: string } }
    expect(state.viewer?.origin).toBe('impersonation')
    expect(state.viewer?.pubkey).toBe(elonPubkey)

    const published = (await backend.handleRequest({
      type: 'PUBLISH_TRUST_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'user:id:11348282' },
      value: '1',
    })) as { eventId: string; localOnly?: boolean }
    expect(published.localOnly).toBe(true)
    expect(relay.published).toHaveLength(0)
    const event = await storage.getEvent(published.eventId)
    expect(event?.pubkey).toBe(elonPubkey)
    expect(event?.sig).toBe('0'.repeat(128))
    expect(await storage.getDueOutbox(Date.now() + 60_000)).toHaveLength(0)

    const restarted = await AttentionXBackend.create({
      repository: storage,
      settingsStore: settings,
      relay,
      now: () => 500_000,
    })
    const restored = (await restarted.handleRequest({
      type: 'GET_VIEWER',
      version: 1,
    })) as { origin: string; pubkey?: string }
    expect(restored.origin).toBe('impersonation')
    expect(restored.pubkey).toBe(elonPubkey)

    const reverted = (await restarted.handleRequest({
      type: 'SET_VIEWER',
      version: 1,
      twitterId: null,
    })) as { origin: string; pubkey?: string }
    expect(reverted.origin).toBe('operator')
    expect(reverted.pubkey).toBe(demoOperatorPubkey())
  },
    15_000,
  )

  it('rejects live impersonation publish as read-only', async () => {
    const secretKey = generateSecretKey()
    const other = generateSecretKey()
    const otherPubkey = getPublicKey(other)
    const storage = await repository('viewer-overlay-live')
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 500_000,
    })
    await storage.putXIdentity({
      twitterId: '44196397',
      handle: 'elonmusk',
      xNpub: nip19.npubEncode(otherPubkey),
      state: 'unverified',
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })
    const viewer = (await backend.handleRequest({
      type: 'SET_VIEWER',
      version: 1,
      twitterId: '44196397',
    })) as { origin: string; readOnly: boolean; publish: string }
    expect(viewer.origin).toBe('impersonation')
    expect(viewer.readOnly).toBe(true)
    expect(viewer.publish).toBe('forbidden')
    await expect(
      backend.handleRequest({
        type: 'PUBLISH_TRUST_STATEMENT',
        version: 1,
        subject: { type: 'i', value: 'user:id:11348282' },
        value: '1',
      }),
    ).rejects.toThrow('Read-only Nostr accounts cannot publish X trust or proofs')
  })

  it('SET_VIEWER in demo uses the derived actor key without stored eventNpub', async () => {
    const secretKey = generateSecretKey()
    const storage = await repository('viewer-overlay-reseed')
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 500_000,
    })
    await backend.handleRequest({
      type: 'SET_APP_MODE',
      version: 1,
      mode: 'demo',
    })
    const viewer = (await backend.handleRequest({
      type: 'SET_VIEWER',
      version: 1,
      twitterId: '44196397',
    })) as { origin: string; pubkey?: string; publish: string }
    expect(viewer).toMatchObject({
      origin: 'impersonation',
      pubkey: demoActorPubkey('44196397'),
      publish: 'local',
    })
    expect((await storage.getXIdentity('44196397'))?.eventNpub).toBeUndefined()
  })

  it('keeps impersonated and operator-gated xPosts while overlay is active', async () => {
    const secretKey = generateSecretKey()
    const storage = await repository('viewer-overlay-prune')
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 500_000,
    })
    for (let i = 0; i < 16; i += 1) {
      await storage.putXIdentity({
        twitterId: String(100 + i),
        handle: `user${100 + i}`,
        state: 'unverified',
        createdAt: 1,
        updatedAt: 1,
        lastSeen: 1,
      })
    }
    await bindActiveVaultToX('101')
    await backend.handleRequest({
      type: 'SET_APP_MODE',
      version: 1,
      mode: 'demo',
    })
    await backend.handleRequest({
      type: 'PUBLISH_TRUST_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'post:id:556' },
      value: '1',
    })
    expect(await storage.getXPost('556')).toBeDefined()

    const extraId = '100'
    await backend.handleRequest({
      type: 'SET_VIEWER',
      version: 1,
      twitterId: extraId,
    })
    await backend.handleRequest({
      type: 'PUBLISH_TRUST_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'post:id:555' },
      value: '1',
    })
    expect(await storage.getXPost('555')).toBeDefined()
    expect(await storage.getXPost('556')).toBeDefined()
  })

  it('treats signed-in X as revert and other vault-bound X as an error', async () => {
    const secretKey = generateSecretKey()
    const storage = await repository('viewer-overlay-bound')
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 500_000,
    })
    await backend.handleRequest({
      type: 'SET_APP_MODE',
      version: 1,
      mode: 'demo',
    })
    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: 1,
      account: {
        handle: 'me',
        twitterId: '999001',
        detectedAt: 500_000,
      },
    })
    await bindActiveVaultToX('999001')
    await vault.setAccountXBinding(
      vault.getActiveAccountId()!,
      '999002',
      Date.now(),
    )

    const restored = (await backend.handleRequest({
      type: 'SET_VIEWER',
      version: 1,
      twitterId: '999001',
    })) as { origin: string }
    expect(restored.origin).toBe('operator')

    await expect(
      backend.handleRequest({
        type: 'SET_VIEWER',
        version: 1,
        twitterId: '999002',
      }),
    ).rejects.toThrow(VIEWER_BOUND_ERROR)
  })
})

describe('Demo-first onboarding gates', () => {
  it('seeds Demo and publishes locally with no vault account', async () => {
    const storage = await repository('demo-first-no-vault')
    const relay = new FakeRelay()
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 500_000,
    })

    await backend.handleRequest({
      type: 'SET_APP_MODE',
      version: 1,
      mode: 'demo',
    })
    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: 1,
      account: {
        handle: 'alice',
        twitterId: '42',
        detectedAt: 500_000,
      },
    })

    const state = (await backend.handleRequest({
      type: 'GET_STATE',
    })) as {
      hasIdentity: boolean
      npub?: string
      pubkey?: string
    }
    expect(state.hasIdentity).toBe(true)
    expect(state.npub).toBeUndefined()
    expect(state.pubkey).toBeUndefined()
    expect(state.pubkey).not.toBe(demoOperatorPubkey())

    const published = (await backend.handleRequest({
      type: 'PUBLISH_TRUST_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'user:id:44196397' },
      value: '1',
    })) as { localOnly?: boolean }
    expect(published.localOnly).toBe(true)
    expect(relay.published).toHaveLength(0)

    const sync = await chrome.storage.sync.get('myPubkey')
    expect(sync.myPubkey).toBeUndefined()
    expect(await getActivePublicKey()).toBeNull()
    expect(await getActivePublicKey()).not.toBe(demoOperatorPubkey())
  })

  it('Graph You in Demo is the signed-in X key, else the sentinel', async () => {
    const settings = new MemorySettings({
      relays: ['wss://relay.example'],
    })
    const storage = await repository('demo-first-graph')
    const relay = new FakeRelay()
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: settings,
      relay,
      now: () => 500_000,
    })

    for (let i = 0; i < 16; i += 1) {
      await storage.putXIdentity({
        twitterId: String(100 + i),
        handle: `user${100 + i}`,
        state: 'unverified',
        createdAt: 1,
        updatedAt: 1,
        lastSeen: 1,
      })
    }

    await backend.handleRequest({
      type: 'SET_APP_MODE',
      version: 1,
      mode: 'demo',
    })

    const sentinel = demoOperatorPubkey()
    const aliceId = '42'
    const bobId = '101'
    const noX = (await backend.handleRequest({
      type: 'GET_GRAPH_SNAPSHOT',
      version: 1,
    })) as { rootPubkey: string; rootIndex?: number }
    expect(noX.rootPubkey).toBe(sentinel)
    expect(noX.rootIndex).toBeTypeOf('number')
    if (typeof noX.rootIndex !== 'number') {
      throw new Error('expected Graph rootIndex')
    }
    await expectDemoChainDegrees(backend)
    await expectYouOutIncludesElon(backend, noX.rootIndex)

    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: 1,
      account: {
        handle: 'alice',
        twitterId: aliceId,
        detectedAt: 500_000,
      },
    })
    await backend.handleRequest({
      type: 'SEED_DEMO_WOT',
      version: 1,
    })
    const alicePk = demoActorPubkey(aliceId)
    const asAlice = (await backend.handleRequest({
      type: 'GET_GRAPH_SNAPSHOT',
      version: 1,
    })) as { rootPubkey: string; rootIndex?: number }
    expect(asAlice.rootPubkey).toBe(alicePk)
    expect(asAlice.rootIndex).toBeTypeOf('number')
    if (typeof asAlice.rootIndex !== 'number') {
      throw new Error('expected Graph rootIndex')
    }
    await expectDemoChainDegrees(backend)
    await expectYouOutIncludesElon(backend, asAlice.rootIndex)
    await backend.settleDemoGrowth()
    const aliceIds = (await storage.getEventsByKind(32009))
      .map((event) => event.id)
      .sort()

    await backend.handleRequest({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: 1,
      account: {
        handle: `user${bobId}`,
        twitterId: bobId,
        detectedAt: 500_001,
      },
    })
    await backend.settleDemoGrowth()
    const afterSwitch = await storage.getEventsByKind(32009)
    const afterSwitchIds = afterSwitch.map((event) => event.id).sort()
    expect(aliceIds.every((id) => afterSwitchIds.includes(id))).toBe(true)
    expect(
      afterSwitch.some(
        (event) =>
          event.pubkey === demoActorPubkey(bobId) &&
          event.subject === `user:id:${aliceId}`,
      ),
    ).toBe(true)
    expect(
      afterSwitch.some(
        (event) =>
          event.pubkey === alicePk &&
          event.subject === `user:id:${aliceId}`,
      ),
    ).toBe(false)
    const asBob = (await backend.handleRequest({
      type: 'GET_GRAPH_SNAPSHOT',
      version: 1,
    })) as { rootPubkey: string }
    expect(asBob.rootPubkey).toBe(demoActorPubkey(bobId))
    const aliceOut = (await backend.handleRequest({
      type: 'QUERY_OUTGOING_TRUST',
      version: 1,
      subject: { type: 'i', value: `user:id:${aliceId}` },
    })) as {
      statements: { subject: { type: string; value: string } }[]
    }
    expect(
      aliceOut.statements.some(
        (row) =>
          row.subject.type === 'i' &&
          row.subject.value === 'user:id:44196397',
      ),
    ).toBe(true)

    const restarted = await AttentionXBackend.create({
      repository: storage,
      settingsStore: settings,
      relay,
      now: () => 500_000,
    })
    const afterRestart = (await restarted.handleRequest({
      type: 'GET_GRAPH_SNAPSHOT',
      version: 1,
    })) as { rootPubkey: string; rootIndex?: number }
    expect(afterRestart.rootPubkey).toBe(demoActorPubkey(bobId))
    expect(afterRestart.rootIndex).toBeTypeOf('number')
    await restarted.settleDemoGrowth()
    await backend.settleDemoGrowth()
  }, 60_000)

  it(
    'grows a new X account without re-seeding and does not block Graph',
    async () => {
      const storage = await repository('demo-grow-append')
      const relay = new FakeRelay()
      const backend = await AttentionXBackend.create({
        repository: storage,
        settingsStore: new MemorySettings({ relays: ['wss://relay.example'] }),
        relay,
        now: () => 700_000,
      })
      await backend.handleRequest({ type: 'SET_APP_MODE', version: 1, mode: 'demo' })
      await backend.settleDemoGrowth()
      const seededIds = (await storage.getEventsByKind(32009)).map((event) => event.id)

      const chromeApi = (globalThis as { chrome: typeof chrome }).chrome
      const broadcasts: Array<{ type?: string }> = []
      const originalRuntimeSend = chromeApi.runtime.sendMessage
      chromeApi.runtime.sendMessage = (async (message: { type?: string }) => {
        broadcasts.push(message)
        return undefined
      }) as unknown as typeof chrome.runtime.sendMessage

      try {
        const started = Date.now()
        for (let n = 0; n < 8; n += 1) {
          await backend.handleRequest({
            type: 'INGEST_X_IDENTITIES',
            version: 1,
            observations: [{
              handle: `grown${n}`,
              twitterId: String(910_000 + n),
              observedAt: 700_000,
              sourceOperation: 'UserByScreenName',
            }],
          })
        }
        const snapshotStarted = Date.now()
        await backend.handleRequest({ type: 'GET_GRAPH_SNAPSHOT', version: 1 })
        expect(Date.now() - snapshotStarted).toBeLessThan(1_000)
        expect(Date.now() - started).toBeLessThan(8_000)
        const mid = (await storage.getEventsByKind(32009)).length
        await backend.settleDemoGrowth()
        const grown = await storage.getEventsByKind(32009)
        expect(grown.length).toBeGreaterThan(mid)
        expect(seededIds.every((id) => grown.some((event) => event.id === id))).toBe(true)
        expect(
          grown.some(
            (event) =>
              event.subject === 'user:id:910000' &&
              event.pubkey === demoOperatorPubkey(),
          ),
        ).toBe(true)
        expect(await storage.getDueOutbox(Date.now() + 60_000)).toHaveLength(0)
        const graphBroadcasts = broadcasts.filter(
          (message) => message?.type === 'TRUST_GRAPH_UPDATED',
        )
        expect(graphBroadcasts.length).toBeGreaterThan(0)
        expect(graphBroadcasts.length).toBeLessThan(8)
      } finally {
        chromeApi.runtime.sendMessage = originalRuntimeSend
      }
    },
    30_000,
  )

  it('does not grow demo trust while Live', async () => {
    const storage = await repository('demo-grow-live')
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({ relays: ['wss://relay.example'] }),
      relay: new FakeRelay(),
      now: () => 700_000,
    })
    await backend.handleRequest({
      type: 'INGEST_X_IDENTITIES',
      version: 1,
      observations: [{
        handle: 'liveuser',
        twitterId: '920001',
        observedAt: 700_000,
        sourceOperation: 'UserByScreenName',
      }],
    })
    await backend.settleDemoGrowth()
    expect(await storage.getEventsByKind(32009)).toHaveLength(0)
  })

  it('refuses Live when there is no real writable key', async () => {
    const storage = await repository('demo-first-no-live')
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 500_000,
    })
    await backend.handleRequest({
      type: 'SET_APP_MODE',
      version: 1,
      mode: 'demo',
    })
    await expect(
      backend.handleRequest({
        type: 'SET_APP_MODE',
        version: 1,
        mode: 'production',
      }),
    ).rejects.toThrow(VIEWER_NO_IDENTITY_ERROR)
  })
})
