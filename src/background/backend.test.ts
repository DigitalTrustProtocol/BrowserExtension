import 'fake-indexeddb/auto'
import './test-chrome-mock'
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
} from '../storage'
import { buildKind10011Event } from '../shared/kind-10011'
import { buildKind32009Event } from '../shared/kind-32009'
import { BACKGROUND_API_VERSION } from '../shared/contracts'
import { buildAuthorTrustSyncFilter, buildXAccountTrustDiscoveryFilter } from '../relay/filters'
import {
  AttentionXBackend,
  type BackgroundRelayTransport,
  type BackgroundSettingsStore,
  type StoredBackgroundSettings,
} from './backend'

let sequence = 0
const repositories: AttentionXRepository[] = []
const databaseNames: string[] = []

function hex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
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

class FakeRelay implements BackgroundRelayTransport {
  readonly published: Event[] = []
  readonly filters: RelayQueryRequest['filter'][] = []
  queryResults: Event[] = []
  queryEventBatches: Event[][] = []
  queryEventsCalls = 0
  hangUntilAbort = false

  async query(request: RelayQueryRequest): Promise<void> {
    this.filters.push(structuredClone(request.filter))
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
    if (this.hangUntilAbort) {
      return new Promise<Event[]>((_, reject) => {
        if (signal?.aborted) {
          reject(new Error('aborted'))
          return
        }
        signal?.addEventListener(
          'abort',
          () => reject(new Error('aborted')),
          { once: true },
        )
      })
    }
    const events = this.queryEventBatches.shift() ?? this.queryResults
    return events.map((event) => structuredClone(event))
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
    const legacy = finalizeEvent(
      { kind: 1985, created_at: 99, content: '', tags: [] },
      secretKey,
    )
    const settings = new MemorySettings({
      secretKeyHex: hex(secretKey),
      relays: ['wss://relay.example'],
      cachedEvents: [legacy, trust, identity, { ...trust, sig: '0'.repeat(128) }],
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
    expect(await storage.getEventsByKind(1985)).toEqual([])
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
      direct: { author: getPublicKey(secretKey), value: 1 },
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
    const cancelled = await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'post:id:123' },
    })
    expect(cancelled).toMatchObject({
      context: '',
      resolution: 'none',
    })
  })

  it('defaults X user trust to global context but keeps an explicit context', async () => {
    const secretKey = generateSecretKey()
    const storage = await repository('trust-x-context')
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

    await backend.handleRequest({
      type: 'PUBLISH_TRUST_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'user:id:424242' },
      value: '1',
    })
    const globalEvent = (await storage.getEventsByKind(32009))[0]!
    expect(globalEvent.tags.some((tag) => tag[0] === 'c')).toBe(false)

    await backend.handleRequest({
      type: 'PUBLISH_TRUST_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'user:id:424243' },
      value: '1',
      context: 'identity',
    })
    const contextualEvent = (await storage.getEventsByKind(32009)).find((event) =>
      event.tags.some(
        (tag) => tag[0] === 'i' && tag[1] === 'user:id:424243',
      ),
    )!
    expect(contextualEvent.tags).toContainEqual(['c', 'identity'])

    const globalQuery = await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:424242' },
    })
    expect(globalQuery).toMatchObject({
      context: '',
      resolution: 'trusted',
    })

    const contextualQuery = await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:424243' },
      context: 'identity',
    })
    expect(contextualQuery).toMatchObject({
      context: 'identity',
      resolution: 'trusted',
    })
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

    // Found proof must exist before publish can become verified.
    await storage.putXIdentity({
      twitterId: '11348282',
      handle: 'nasa',
      xProofNpub: npub.toLowerCase(),
      xProofPostId: '456',
      xProofHandle: 'nasa',
      xProofObservedAt: 300_000,
      state: 'unverified',
      blockedBy: 'missing-nip39',
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
      xProofPostId: '456',
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
      nip39EventId: loser.id,
      nip39ObservedAt: 1,
      state: 'verified',
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
    ).rejects.toThrow('Unknown AttentionX background request type')
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

    // Relay 10011 alone cannot invent xProof — discover the proof first.
    await storage.putXIdentity({
      twitterId: '11348282',
      handle: 'nasa',
      xProofNpub: npub.toLowerCase(),
      xProofPostId: proofPostId,
      xProofHandle: 'nasa',
      xProofObservedAt: 1,
      state: 'unverified',
      blockedBy: 'missing-nip39',
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
      source: 'relay',
    })
    expect(await storage.getXIdentity('11348282')).toMatchObject({
      state: 'verified',
    })
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
        status: 'needs_publish',
        proofPostId,
        source: 'page-scan',
      })
      expect(searchCalls).toBe(1)

      expect(await storage.getEventsByKind(10011)).toHaveLength(0)
      expect(await storage.getXIdentity('22551796')).toMatchObject({
        state: 'unverified',
        blockedBy: 'missing-nip39',
        xProofPostId: proofPostId,
      })

      // xIdentity binding exists — GraphQL must not run again.
      const again = await backend.handleRequest({
        type: 'CHECK_X_PROOF',
        version: 1,
        handle: 'keutmann',
        twitterId: '22551796',
        queryRelays: false,
        scanPage: true,
      })
      expect(again).toMatchObject({
        status: 'needs_publish',
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
        status: 'needs_publish',
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
        queryProofPost: async () => ({ status: 'unavailable' }),
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
        status: 'needs_publish',
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
        status: 'needs_publish',
        handle: 'otheruser',
        twitterId: '99900111',
        proofPostId: otherPostId,
        npub: otherNpub.toLowerCase(),
        source: 'explicit-search',
      })
      expect(searchCalls).toBe(3)
      expect(await storage.getXIdentity('99900111')).toMatchObject({
        xProofPostId: otherPostId,
        xProofNpub: otherNpub.toLowerCase(),
      })
    } finally {
      chromeApi.tabs.query = originalQuery
      chromeApi.tabs.sendMessage = originalSend
    }
  })

  it('never invents xProof fields from kind 10011 alone', async () => {
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
      blockedBy: 'missing-x-proof',
    })
    expect(row?.xProofPostId).toBeUndefined()
    expect(row?.state).not.toBe('verified')

    // CHECK without scan must not invent xProof from nip39.
    const check = await backend.handleRequest({
      type: 'CHECK_X_PROOF',
      version: 1,
      handle: 'keutmann',
      twitterId: '22551796',
      queryRelays: false,
      scanPage: false,
    })
    expect(check).toMatchObject({ status: 'not_found' })
    expect((await storage.getXIdentity('22551796'))?.xProofPostId).toBeUndefined()
  })

  it('stages a page-found proof locally and publishes only after confirm', async () => {
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

      const staged = await backend.handleRequest({
        type: 'CHECK_X_PROOF',
        version: 1,
        handle: 'nasa',
        twitterId: '11348282',
        queryRelays: true,
        scanPage: true,
      })
      expect(staged).toMatchObject({
        status: 'needs_publish',
        proofPostId,
        source: 'page-scan',
      })
      expect(relay.published).toHaveLength(0)
      expect(await storage.getEventsByKind(10011)).toHaveLength(0)
      expect(await storage.getXIdentity('11348282')).toMatchObject({
        state: 'unverified',
        blockedBy: 'missing-nip39',
        xProofPostId: proofPostId,
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
        state: 'unverified',
        blockedBy: 'missing-nip39',
        xProofPostId: proofPostId,
        xProofNpub: expect.any(String),
      })
      expect(await storage.getEventsByKind(32009)).toHaveLength(1)

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
      xProofNpub: npub.toLowerCase(),
      xProofPostId: proofPostId,
      xProofHandle: 'nasa',
      xProofObservedAt: 1,
      state: 'unverified',
      blockedBy: 'missing-nip39',
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
        ['i', 'twitter:nasa', proofPostId],
        ['i', `twitter_id:11348282`, proofPostId],
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
        ['i', 'twitter:nasa', proofPostId],
        ['i', `twitter_id:11348282`, proofPostId],
      ]),
    )
    expect(stored.content).toBe('keep me')
    expect(await storage.getXIdentity('11348282')).toMatchObject({
      state: 'verified',
      nip39EventId: stored.id,
      nip39XId: '11348282',
      xProofPostId: proofPostId,
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
      xProofNpub: npub.toLowerCase(),
      xProofPostId: proofPostId,
      xProofHandle: 'nasa',
      xProofObservedAt: 1,
      state: 'unverified',
      blockedBy: 'missing-nip39',
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

  it('SYNC_X_IDENTITY_STATUS promotes from xIdentities columns only', async () => {
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

    // No kind 10011 event in the store — status must use row columns only.
    await storage.putXIdentity({
      twitterId,
      handle: 'keutmann',
      xProofNpub: npub,
      xProofPostId: proofPostId,
      xProofHandle: 'keutmann',
      xProofObservedAt: 1,
      nip39Npub: npub,
      nip39XId: twitterId,
      nip39Handle: 'keutmann',
      nip39PostId: proofPostId,
      nip39EventId: 'deadbeef',
      nip39ObservedAt: 2,
      state: 'unverified',
      blockedBy: 'mismatch',
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
      blockedBy?: string
    }

    expect(result).toMatchObject({
      state: 'verified',
      changed: true,
    })
    expect(result.blockedBy).toBeUndefined()
    expect(await storage.getXIdentity(twitterId)).toMatchObject({
      state: 'verified',
      xProofPostId: proofPostId,
      nip39PostId: proofPostId,
    })
    expect(await storage.getEventsByKind(10011)).toHaveLength(0)
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

    for (const twitterId of ['111', '222', '333', '444', '555']) {
      await storage.putXIdentity({
        twitterId,
        handle: `user${twitterId}`,
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

    expect(seeded.maxDepth).toBe(3)
    expect(seeded.fakeAuthors).toBe(12)
    expect(seeded.identitySubjects).toBe(5)
    expect(seeded.postSubjects).toBeGreaterThanOrEqual(500)
    expect(seeded.eventCount).toBeGreaterThan(500)
    expect(relay.published).toHaveLength(0)
    expect(await storage.getDueOutbox(Date.now() + 60_000)).toHaveLength(0)

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
    expect(postEvents.length).toBeGreaterThanOrEqual(500)
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
          !hasContext &&
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
        return /^post:id:\d+$/.test(i ?? '') && k === 'post:id'
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
        return s === 'x.com' && /^[0-9a-f]{64}$/.test(d ?? '')
      }),
    ).toBe(true)

    expect(
      events.every((event) =>
        event.tags.some((tag) => tag[0] === 's' && tag[1] === 'x.com'),
      ),
    ).toBe(true)

    const queried = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:222' },
      bounds: { maxDepth: 5 },
    })) as { resolution: string; statements: unknown[] }

    expect(queried.resolution).not.toBe('none')
    expect(queried.statements.length).toBeGreaterThan(0)

    const cleared = (await backend.handleRequest({
      type: 'CLEAR_DEMO_WOT',
      version: 1,
    })) as { deleted: number; eventCount: number }

    expect(cleared.deleted).toBe(seeded.eventCount)
    expect(cleared.eventCount).toBe(0)
    expect(await storage.getEventsByKind(32009)).toHaveLength(0)
    expect(relay.published).toHaveLength(0)
  },
    30_000,
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

  it('production graph loads only operator and verified-author trusts; demo loads only demo', async () => {
    const operatorKey = generateSecretKey()
    const operatorPubkey = getPublicKey(operatorKey)
    const strangerKey = generateSecretKey()
    const verifiedKey = generateSecretKey()
    const verifiedPubkey = getPublicKey(verifiedKey)
    const verifiedNpub = nip19.npubEncode(verifiedPubkey)
    const storage = await repository('graph-author-scope')
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(operatorKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
      now: () => 450_000,
    })

    await storage.putXIdentity({
      twitterId: '9001',
      handle: 'verifiedUser',
      xProofNpub: verifiedNpub.toLowerCase(),
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

    const operatorHit = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:100' },
      rootPubkey: operatorPubkey,
    })) as { resolution: string }
    expect(operatorHit.resolution).toBe('trusted')

    const strangerMiss = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:200' },
      rootPubkey: getPublicKey(strangerKey),
    })) as { resolution: string }
    expect(strangerMiss.resolution).toBe('none')

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
  })

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
})
