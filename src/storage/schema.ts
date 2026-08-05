import {
  deleteDB,
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
} from 'idb'
import type {
  EventRecord,
  OutboxRecord,
  RelayErrorLogRecord,
  RelayHealthRecord,
  RelayObservationRecord,
  SyncCursorRecord,
  XIdentityRecord,
  XPostRecord,
} from './types'

export const ATTENTIONX_DB_NAME = 'attentionx'
export const ATTENTIONX_DB_VERSION = 8

export const DEMO_EVENT_STATE = 'demo' as const

export interface AttentionXSchema extends DBSchema {
  events: {
    key: string
    value: EventRecord
    indexes: {
      kind: number
      pubkey: string
      created_at: number
      addressKey: string
      state: string
    }
  }
  relayObservations: {
    key: string
    value: RelayObservationRecord
    indexes: {
      relayUrl: string
      eventId: string
    }
  }
  syncCursors: {
    key: string
    value: SyncCursorRecord
    indexes: {
      relayUrl: string
      nextRetryAt: number
    }
  }
  xIdentities: {
    key: string
    value: XIdentityRecord
    indexes: {
      nip39Npub: string
      handle: string
      lastSeen: number
    }
  }
  xPosts: {
    key: string
    value: XPostRecord
    indexes: {
      authorTwitterId: string
      lastSeen: number
    }
  }
  outbox: {
    key: string
    value: OutboxRecord
    indexes: {
      updatedAt: number
    }
  }
  relayHealth: {
    key: string
    value: RelayHealthRecord
    indexes: {
      status: string
      updatedAt: number
    }
  }
  relayErrorLog: {
    key: string
    value: RelayErrorLogRecord
    indexes: {
      at: number
      relayUrl: string
    }
  }
}

export interface OpenStorageOptions {
  name?: string
  blocked?: (currentVersion: number, blockedVersion: number | null) => void
}

/** Loose upgrade tx — intermediate versions still create/drop legacy stores. */
type LegacyUpgradeTransaction = IDBPTransaction<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  string[],
  'versionchange'
>

export function formatEventAddress(
  kind: number,
  pubkey: string,
  dTag: string,
): string {
  return `${kind}:${pubkey}:${dTag}`
}

function dTagFromEvent(event: {
  tags: ReadonlyArray<readonly string[]>
}): string {
  const dTags = event.tags.filter((tag) => tag[0] === 'd')
  return dTags.length === 1 && typeof dTags[0]?.[1] === 'string'
    ? dTags[0][1]
    : ''
}

function isDemoTaggedEvent(event: {
  tags: ReadonlyArray<readonly string[]>
}): boolean {
  return event.tags.some(
    (tag) => tag[0] === 'test' && tag[1] === 'attentionx-demo',
  )
}

function isNewerEvent(
  candidate: { created_at: number; id: string },
  current: { created_at: number; id: string },
): boolean {
  return (
    candidate.created_at > current.created_at ||
    (candidate.created_at === current.created_at &&
      candidate.id < current.id)
  )
}

function createV1Stores(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  database: IDBPDatabase<any>,
  transaction: LegacyUpgradeTransaction,
): void {
  const events = database.objectStoreNames.contains('events')
    ? transaction.objectStore('events')
    : database.createObjectStore('events', { keyPath: 'id' })
  if (!events.indexNames.contains('kind')) {
    events.createIndex('kind', 'kind')
  }
  if (!events.indexNames.contains('pubkey')) {
    events.createIndex('pubkey', 'pubkey')
  }
  if (!events.indexNames.contains('created_at')) {
    events.createIndex('created_at', 'created_at')
  }

  // Legacy stores removed in v6; still created for stepwise upgrades.
  if (!database.objectStoreNames.contains('addresses')) {
    const addresses = database.createObjectStore('addresses', {
      keyPath: 'address',
    })
    addresses.createIndex('eventId', 'eventId')
  }
  if (!database.objectStoreNames.contains('tagIndex')) {
    const tagIndex = database.createObjectStore('tagIndex', { keyPath: 'key' })
    tagIndex.createIndex('byTag', ['kind', 'tagName', 'tagValue'])
    tagIndex.createIndex('eventId', 'eventId')
  }

  const outbox = database.objectStoreNames.contains('outbox')
    ? transaction.objectStore('outbox')
    : database.createObjectStore('outbox', { keyPath: 'eventId' })
  if (!outbox.indexNames.contains('updatedAt')) {
    outbox.createIndex('updatedAt', 'updatedAt')
  }
}

function createV2Stores(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  database: IDBPDatabase<any>,
  transaction: LegacyUpgradeTransaction,
): void {
  createV1Stores(database, transaction)

  const observations = database.objectStoreNames.contains('relayObservations')
    ? transaction.objectStore('relayObservations')
    : database.createObjectStore('relayObservations', { keyPath: 'key' })
  if (!observations.indexNames.contains('relayUrl')) {
    observations.createIndex('relayUrl', 'relayUrl')
  }
  if (!observations.indexNames.contains('eventId')) {
    observations.createIndex('eventId', 'eventId')
  }

  const cursors = database.objectStoreNames.contains('syncCursors')
    ? transaction.objectStore('syncCursors')
    : database.createObjectStore('syncCursors', { keyPath: 'key' })
  if (!cursors.indexNames.contains('relayUrl')) {
    cursors.createIndex('relayUrl', 'relayUrl')
  }
  if (!cursors.indexNames.contains('nextRetryAt')) {
    cursors.createIndex('nextRetryAt', 'retry.nextRetryAt')
  }

  if (!database.objectStoreNames.contains('xIdentities')) {
    database.createObjectStore('xIdentities', { keyPath: 'twitterId' })
  }

  const aliases = database.objectStoreNames.contains('handleAliases')
    ? transaction.objectStore('handleAliases')
    : database.createObjectStore('handleAliases', { keyPath: 'handle' })
  if (!aliases.indexNames.contains('twitterId')) {
    aliases.createIndex('twitterId', 'twitterId')
  }
  if (!aliases.indexNames.contains('expiresAt')) {
    aliases.createIndex('expiresAt', 'expiresAt')
  }
}

async function createV3Stores(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  database: IDBPDatabase<any>,
  transaction: LegacyUpgradeTransaction,
): Promise<void> {
  const existingEvents = await transaction.objectStore('events').getAll()

  if (database.objectStoreNames.contains('tagIndex')) {
    database.deleteObjectStore('tagIndex')
  }
  const tagIndex = database.createObjectStore('tagIndex', { keyPath: 'key' })
  tagIndex.createIndex('byTag', ['kind', 'tagName', 'tagValue'])
  tagIndex.createIndex('eventId', 'eventId')
  for (const event of existingEvents) {
    const uniqueTags = new Set<string>()
    for (const tag of event.tags) {
      const [tagName, tagValue] = tag
      if (tagName === undefined || tagValue === undefined) {
        continue
      }
      const uniqueKey = JSON.stringify([tagName, tagValue])
      if (uniqueTags.has(uniqueKey)) {
        continue
      }
      uniqueTags.add(uniqueKey)
      await tagIndex.put({
        key: [event.kind, tagName, tagValue, event.id],
        eventId: event.id,
        kind: event.kind,
        tagName,
        tagValue,
      })
    }
  }

  const identityObservations = database.objectStoreNames.contains(
    'identityObservations',
  )
    ? transaction.objectStore('identityObservations')
    : database.createObjectStore('identityObservations', { keyPath: 'key' })
  if (!identityObservations.indexNames.contains('byHandleObservedAt')) {
    identityObservations.createIndex('byHandleObservedAt', [
      'handle',
      'observedAt',
    ])
  }
  if (!identityObservations.indexNames.contains('twitterId')) {
    identityObservations.createIndex('twitterId', 'twitterId')
  }
  if (!identityObservations.indexNames.contains('receivedAt')) {
    identityObservations.createIndex('receivedAt', 'receivedAt')
  }

  const resolutionCache = database.objectStoreNames.contains(
    'identityResolutionCache',
  )
    ? transaction.objectStore('identityResolutionCache')
    : database.createObjectStore('identityResolutionCache', {
        keyPath: 'handle',
      })
  if (!resolutionCache.indexNames.contains('expiresAt')) {
    resolutionCache.createIndex('expiresAt', 'expiresAt')
  }
}

function createV4Stores(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  database: IDBPDatabase<any>,
  transaction: LegacyUpgradeTransaction,
): void {
  const health = database.objectStoreNames.contains('relayHealth')
    ? transaction.objectStore('relayHealth')
    : database.createObjectStore('relayHealth', { keyPath: 'relayUrl' })
  if (!health.indexNames.contains('status')) {
    health.createIndex('status', 'status')
  }
  if (!health.indexNames.contains('updatedAt')) {
    health.createIndex('updatedAt', 'updatedAt')
  }

  const errorLog = database.objectStoreNames.contains('relayErrorLog')
    ? transaction.objectStore('relayErrorLog')
    : database.createObjectStore('relayErrorLog', { keyPath: 'id' })
  if (!errorLog.indexNames.contains('at')) {
    errorLog.createIndex('at', 'at')
  }
  if (!errorLog.indexNames.contains('relayUrl')) {
    errorLog.createIndex('relayUrl', 'relayUrl')
  }
}

/**
 * Flatten xIdentities from claims[] to a one-row-per-X-user verification table.
 * Pre-production: drop and recreate rather than migrate old claim shapes.
 */
function createV5Stores(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  database: IDBPDatabase<any>,
  _transaction: LegacyUpgradeTransaction,
): void {
  if (database.objectStoreNames.contains('xIdentities')) {
    database.deleteObjectStore('xIdentities')
  }
  const identities = database.createObjectStore('xIdentities', {
    keyPath: 'twitterId',
  })
  identities.createIndex('nip39Npub', 'nip39Npub')
}

/**
 * Collapse addresses + tagIndex into events.addressKey / events.state.
 * Keep one winner per addressKey; drop superseded events and their outbox rows.
 */
async function createV6Stores(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  database: IDBPDatabase<any>,
  transaction: LegacyUpgradeTransaction,
): Promise<void> {
  const eventsStore = transaction.objectStore('events')
  const existingEvents: Array<
    SignedLike & { firstSeenAt?: number; addressKey?: string; state?: string }
  > = await eventsStore.getAll()

  const winners = new Map<string, (typeof existingEvents)[number]>()
  const losers: string[] = []

  for (const event of existingEvents) {
    const addressKey =
      event.addressKey ??
      formatEventAddress(event.kind, event.pubkey, dTagFromEvent(event))
    const state =
      event.state ??
      (isDemoTaggedEvent(event) ? DEMO_EVENT_STATE : undefined)
    const enriched = {
      ...event,
      addressKey,
      ...(state !== undefined ? { state } : {}),
    }
    const current = winners.get(addressKey)
    if (!current || isNewerEvent(enriched, current)) {
      if (current) losers.push(current.id)
      winners.set(addressKey, enriched)
    } else {
      losers.push(enriched.id)
    }
  }

  const outbox = database.objectStoreNames.contains('outbox')
    ? transaction.objectStore('outbox')
    : undefined

  for (const id of losers) {
    await eventsStore.delete(id)
    if (outbox) await outbox.delete(id)
  }

  for (const event of winners.values()) {
    const { addressKey, state, firstSeenAt, ...signed } = event
    await eventsStore.put({
      ...signed,
      tags: event.tags.map((tag) => [...tag]),
      firstSeenAt: firstSeenAt ?? 0,
      addressKey: addressKey!,
      ...(state !== undefined ? { state } : {}),
    } satisfies EventRecord)
  }

  if (!eventsStore.indexNames.contains('addressKey')) {
    eventsStore.createIndex('addressKey', 'addressKey', { unique: true })
  }
  if (!eventsStore.indexNames.contains('state')) {
    eventsStore.createIndex('state', 'state')
  }

  if (database.objectStoreNames.contains('addresses')) {
    database.deleteObjectStore('addresses')
  }
  if (database.objectStoreNames.contains('tagIndex')) {
    database.deleteObjectStore('tagIndex')
  }
}

/**
 * twitterId-only identity model: singular handle + lastSeen; drop handle-keyed
 * alias / observation / resolution-cache stores.
 */
async function createV7Stores(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  database: IDBPDatabase<any>,
  transaction: LegacyUpgradeTransaction,
): Promise<void> {
  for (const name of [
    'handleAliases',
    'identityObservations',
    'identityResolutionCache',
  ] as const) {
    if (database.objectStoreNames.contains(name)) {
      database.deleteObjectStore(name)
    }
  }

  if (!database.objectStoreNames.contains('xIdentities')) {
    const identities = database.createObjectStore('xIdentities', {
      keyPath: 'twitterId',
    })
    identities.createIndex('nip39Npub', 'nip39Npub')
    identities.createIndex('handle', 'handle')
    identities.createIndex('lastSeen', 'lastSeen')
    return
  }

  const store = transaction.objectStore('xIdentities')
  const existing: Array<Record<string, unknown>> = await store.getAll()
  for (const row of existing) {
    const handles = Array.isArray(row.handles)
      ? row.handles.filter((value): value is string => typeof value === 'string')
      : []
    const handleFromArray =
      handles.length > 0
        ? String(handles[handles.length - 1])
            .trim()
            .replace(/^@/, '')
            .toLowerCase()
        : ''
    const handle =
      typeof row.handle === 'string' && row.handle.trim().length > 0
        ? row.handle.trim().replace(/^@/, '').toLowerCase()
        : handleFromArray
    const updatedAt =
      typeof row.updatedAt === 'number' && Number.isSafeInteger(row.updatedAt)
        ? row.updatedAt
        : Date.now()
    const lastSeen =
      typeof row.lastSeen === 'number' && Number.isSafeInteger(row.lastSeen)
        ? row.lastSeen
        : updatedAt
    const next = { ...row, handle, lastSeen, updatedAt }
    delete (next as { handles?: unknown }).handles
    await store.put(next)
  }

  if (!store.indexNames.contains('handle')) {
    store.createIndex('handle', 'handle')
  }
  if (!store.indexNames.contains('lastSeen')) {
    store.createIndex('lastSeen', 'lastSeen')
  }
  if (!store.indexNames.contains('nip39Npub')) {
    store.createIndex('nip39Npub', 'nip39Npub')
  }
}

/** Trust-gated X post display chrome (timeline-seen subjects only). */
function createV8Stores(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  database: IDBPDatabase<any>,
  _transaction: LegacyUpgradeTransaction,
): void {
  if (database.objectStoreNames.contains('xPosts')) return
  const posts = database.createObjectStore('xPosts', { keyPath: 'postId' })
  posts.createIndex('authorTwitterId', 'authorTwitterId')
  posts.createIndex('lastSeen', 'lastSeen')
}

interface SignedLike {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

export function openAttentionXDatabase(
  options: OpenStorageOptions = {},
): Promise<IDBPDatabase<AttentionXSchema>> {
  return openDB<AttentionXSchema>(
    options.name ?? ATTENTIONX_DB_NAME,
    ATTENTIONX_DB_VERSION,
    {
      async upgrade(database, oldVersion, _newVersion, transaction) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = database as IDBPDatabase<any>
        const legacyTx = transaction as unknown as LegacyUpgradeTransaction
        if (oldVersion < 1) {
          createV1Stores(db, legacyTx)
        }
        if (oldVersion < 2) {
          createV2Stores(db, legacyTx)
        }
        if (oldVersion < 3) {
          await createV3Stores(db, legacyTx)
        }
        if (oldVersion < 4) {
          createV4Stores(db, legacyTx)
        }
        if (oldVersion < 5) {
          createV5Stores(db, legacyTx)
        }
        if (oldVersion < 6) {
          await createV6Stores(db, legacyTx)
        }
        if (oldVersion < 7) {
          await createV7Stores(db, legacyTx)
        }
        if (oldVersion < 8) {
          createV8Stores(db, legacyTx)
        }
      },
      blocked: options.blocked,
      blocking(_currentVersion, _blockedVersion, event) {
        const database = event.target
        if (database instanceof IDBDatabase) {
          database.close()
        }
      },
    },
  )
}

export function deleteAttentionXDatabase(
  name = ATTENTIONX_DB_NAME,
): Promise<void> {
  return deleteDB(name)
}
