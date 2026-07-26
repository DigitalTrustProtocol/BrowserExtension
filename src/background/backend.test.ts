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
import { afterEach, describe, expect, it } from 'vitest'
import type {
  RelayQueryRequest,
} from '../relay'
import {
  AttentionXRepository,
  deleteAttentionXDatabase,
} from '../storage'
import { buildKind10011Event } from '../shared/kind-10011'
import { buildKind32009Event } from '../shared/kind-32009'
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
        subject: { type: 'i', value: 'ext:twitter_post:123' },
        value: '1',
        context: 'news:accuracy',
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
      subject: { type: 'i', value: 'ext:twitter_post:123' },
      value: '1',
      context: 'news:accuracy',
    })
    const event = (await storage.getEventsByKind(32009))[0]!

    expect(published).toMatchObject({
      eventId: event.id,
      deliveredTo: 1,
      attemptedRelays: 1,
    })
    expect(event.tags).toContainEqual(['i', 'ext:twitter_post:123'])
    expect(event.tags).toContainEqual(['c', 'news:accuracy'])
    expect(await storage.getEventsByKind(1985)).toEqual([])
    expect(relay.published).toHaveLength(1)

    const query = await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'ext:twitter_post:123' },
      context: 'news:accuracy',
    })
    expect(query).toMatchObject({
      resolution: 'trusted',
      direct: { author: getPublicKey(secretKey), value: 1 },
    })

    await expect(
      backend.handleRequest({
        type: 'PUBLISH_TRUST_STATEMENT',
        version: 1,
        subject: { type: 'i', value: 'ext:twitter_id:nasa' },
        value: '1',
        context: 'identity',
      }),
    ).rejects.toThrow('decimal digits')

    await backend.handleRequest({
      type: 'CANCEL_TRUST_STATEMENT',
      version: 1,
      subject: { type: 'i', value: 'ext:twitter_post:123' },
    })
    const cancelled = await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'ext:twitter_post:123' },
    })
    expect(cancelled).toMatchObject({
      context: 'news:accuracy',
      resolution: 'none',
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
    expect(await storage.getHandleAlias('nasa')).toMatchObject({
      twitterId: '11348282',
      source: 'page-response',
      observedAt: 300_000,
    })
    expect(await storage.getIdentityObservations('nasa')).toEqual([
      expect.objectContaining({ observedAt: 300_000, receivedAt: 300_000 }),
    ])

    const resolution = await backend.handleRequest({
      type: 'RESOLVE_X_IDENTITY',
      version: 1,
      handle: 'nasa',
    })
    expect(resolution).toMatchObject({
      state: 'resolved',
      twitterId: '11348282',
      provenance: 'observation',
    })

    const result = await backend.handleRequest({
      type: 'PUBLISH_X_IDENTITY',
      version: 1,
      handle: 'nasa',
      twitterId: '11348282',
      proofTweetId: '456',
    })
    expect(result).toMatchObject({ deliveredTo: 1 })
    expect(await storage.getEventsByKind(10011)).toHaveLength(1)
    expect(await storage.getXIdentity('11348282')).toMatchObject({
      state: 'verified',
      xProofPostId: '456',
      nip39PostId: '456',
    })
  })

  it('rejects stale cross-relay claims after rename and unlink replacements', async () => {
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)
    const npub = nip19.npubEncode(pubkey)
    const old = finalizeEvent(
      buildKind10011Event({
        handle: 'nasa',
        twitterId: '11348282',
        proofPostId: '456',
        createdAt: 1,
      }),
      secretKey,
    )
    const renamed = finalizeEvent(
      buildKind10011Event({
        handle: 'nasa_updates',
        twitterId: '11348282',
        proofPostId: '789',
        createdAt: 2,
        existingEvent: old,
      }),
      secretKey,
    )
    const unlinked = finalizeEvent(
      {
        kind: 10011,
        created_at: 3,
        content: '',
        tags: [['i', 'github:nasa', 'proof']],
      },
      secretKey,
    )
    let now = 1_000
    let profileAvailable = true
    const relay = new FakeRelay()
    const storage = await repository('nip39-replacements')
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({ relays: ['wss://relay.example'] }),
      relay,
      now: () => now,
      queryProofPost: async (postId) => ({
        status: 'found',
        post: {
          postId,
          authorHandle: postId === '456' ? 'nasa' : 'nasa_updates',
          text: `Linking my account to Nostr: ${npub}`,
        },
      }),
      fetch: async () =>
        profileAvailable
          ? new Response(
              '<script type="application/ld+json">{"mainEntity":{"identifier":"11348282"}}</script>',
              { status: 200, headers: { 'content-type': 'text/html' } },
            )
          : new Response('', { status: 404 }),
    })

    expect(await backend.handleRequest({
      type: 'VERIFY_X_PROOF',
      version: 1,
      event: old,
    })).toMatchObject({ state: 'verified' })
    expect(await storage.getXIdentity('11348282')).toMatchObject({
      state: 'verified',
      nip39Npub: expect.any(String),
    })

    profileAvailable = false
    now = 7 * 60 * 60 * 1_000
    relay.queryEventBatches = [[old], [renamed]]
    const oldResolution = await backend.handleRequest({
      type: 'RESOLVE_X_IDENTITY',
      version: 1,
      handle: 'nasa',
    })
    expect(oldResolution).not.toMatchObject({
      state: 'resolved',
      twitterId: '11348282',
    })
    // Renamed event still claims this X id; nip39 side is kept (pending /
    // unverified) even when profile resolution is unavailable.
    const afterRenameIngest = await storage.getXIdentity('11348282')
    expect(afterRenameIngest?.nip39Npub).toEqual(expect.any(String))
    expect(afterRenameIngest?.state).not.toBe('verified')

    profileAvailable = true
    expect(await backend.handleRequest({
      type: 'VERIFY_X_PROOF',
      version: 1,
      event: renamed,
    })).toMatchObject({ state: 'verified' })
    expect(await storage.getXIdentity('11348282')).toMatchObject({
      state: 'verified',
      nip39Npub: expect.any(String),
    })

    profileAvailable = false
    now += 7 * 60 * 60 * 1_000
    relay.queryEventBatches = [[renamed], [unlinked]]
    const renamedResolution = await backend.handleRequest({
      type: 'RESOLVE_X_IDENTITY',
      version: 1,
      handle: 'nasa_updates',
    })
    expect(renamedResolution).not.toMatchObject({
      state: 'resolved',
      twitterId: '11348282',
    })
    // Unlinked winner no longer claims twitter_id — nip39 columns cleared.
    expect((await storage.getXIdentity('11348282'))?.nip39Npub).toBeUndefined()
    expect(await storage.getAddressWinner(`10011:${pubkey}:`)).toBe(unlinked.id)
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
    await storage.setAddressWinner(`10011:${pubkey}:`, loser.id, 1)
    const npub = nip19.npubEncode(pubkey).toLowerCase()
    await storage.putXIdentity({
      twitterId: loserIdentity,
      handles: ['stale'],
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
    })

    await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({ relays: ['wss://relay.example'] }),
      relay: new FakeRelay(),
      now: () => 100_000,
    })

    expect(await storage.getAddressWinner(`10011:${pubkey}:`)).toBe(winner.id)
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
      expect.objectContaining({
        kinds: [32009],
        authors: [getPublicKey(secretKey)],
      }),
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
    expect(published).toMatchObject({ deliveredTo: 1 })
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
      expect(await storage.getEventsByKind(10011)).toHaveLength(0)
    } finally {
      chromeApi.tabs.query = originalQuery
      chromeApi.tabs.sendMessage = originalSend
    }
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
      expect(published).toMatchObject({ deliveredTo: 1 })
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
        subject: { type: 'i', value: `ext:twitter_id:${twitterId}` },
        value: '1',
        context: 'identity',
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
        subject: { type: 'i', value: `ext:twitter_id:${twitterId}` },
        value: '1',
        context: 'identity',
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
        subject: { type: 'i', value: 'ext:twitter_post:123' },
        value: '1',
        context: 'news:accuracy',
        hintHandle: 'nasa',
      })
      expect(searchCalls).toBe(0)
    } finally {
      chromeApi.tabs.query = originalQuery
      chromeApi.tabs.sendMessage = originalSend
    }
  })
})
