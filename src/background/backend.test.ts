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
} from '../storage'
import { buildKind10011Event } from '../shared/kind-10011'
import { buildKind32009Event } from '../shared/kind-32009'
import { buildKind32014Event } from '../shared/kind-32014'
import { BACKGROUND_API_VERSION } from '../shared/contracts'
import { DEMO_WOT_CHAIN } from '../shared/demo-wot'
import { GRAPH_VIEW_MESSAGE } from '../shared/graph-deeplink'
import { OPEN_NOTES_ON_LAUNCH_KEY } from '../shared/selected-subject'
import { MAINTENANCE_ALARM } from '../shared/wot-sync-interval'
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
      syncIntervalMinutes: 15,
      wotAutoLower: true,
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
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(rootKey),
        relays: ['wss://relay.example'],
      }),
      relay: new FakeRelay(),
    })
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
    expect(open).toHaveBeenCalledWith({ tabId: 7 })

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
    const backend = await AttentionXBackend.create({
      repository: storage,
      settingsStore: new MemorySettings({
        secretKeyHex: hex(secretKey),
        relays: ['wss://relay.example'],
      }),
      relay,
      now: () => 200_000,
    })

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
      message: { type?: string },
    ) => {
      if (message?.type === 'READ_ACTIVE_X_BIO') {
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
    } finally {
      chromeApi.tabs.query = originalQuery
      chromeApi.tabs.sendMessage = originalSend
    }
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
    expect(seeded.fakeAuthors).toBe(20)
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
    expect(kind0).toHaveLength(seeded.fakeAuthors)
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
    ).toBe(seeded.fakeAuthors)
    expect(new Set(kind0Meta.map((row) => row.picture)).size).toBe(
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
      subject: { type: 'i', value: 'user:id:100' },
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
    })) as { resolution: string; degree: number }
    const tesla = (await backend.handleRequest({
      type: 'QUERY_TRUST',
      version: 1,
      subject: { type: 'i', value: 'user:id:13298072' },
      bounds: { maxDepth: 5 },
    })) as { resolution: string; degree: number }
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
    expect(spacex).toMatchObject({ resolution: 'mixed', degree: 2 })
    expect(tesla).toMatchObject({ resolution: 'mixed', degree: 3 })
    expect(nasa).toMatchObject({ resolution: 'mixed', degree: 4 })

    const elonIdentity = await storage.getXIdentity('44196397')
    expect(elonIdentity?.eventNpub).toMatch(/^npub1/)
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

    const cleared = (await backend.handleRequest({
      type: 'CLEAR_DEMO_WOT',
      version: 1,
    })) as { deleted: number; eventCount: number }

    expect(cleared.deleted).toBe(seeded.eventCount)
    expect(cleared.eventCount).toBe(0)
    expect(await storage.getEventsByKind(32009)).toHaveLength(0)
    expect(await storage.getEventsByKind(0)).toHaveLength(0)
    expect(relay.published).toHaveLength(0)
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
    expect(open).toHaveBeenCalledWith({ tabId: 3 })

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
})
