import {
  deleteDB,
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
} from 'idb'
import type {
  AddressRecord,
  EventRecord,
  HandleAliasRecord,
  IdentityObservationRecord,
  IdentityResolutionCacheRecord,
  OutboxRecord,
  RelayErrorLogRecord,
  RelayHealthRecord,
  RelayObservationRecord,
  SyncCursorRecord,
  TagIndexRecord,
  XIdentityRecord,
} from './types'

export const ATTENTIONX_DB_NAME = 'attentionx'
export const ATTENTIONX_DB_VERSION = 5

export interface AttentionXSchema extends DBSchema {
  events: {
    key: string
    value: EventRecord
    indexes: {
      kind: number
      pubkey: string
      created_at: number
    }
  }
  addresses: {
    key: string
    value: AddressRecord
    indexes: {
      eventId: string
    }
  }
  tagIndex: {
    key: [number, string, string, string]
    value: TagIndexRecord
    indexes: {
      byTag: [number, string, string]
      eventId: string
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
    }
  }
  handleAliases: {
    key: string
    value: HandleAliasRecord
    indexes: {
      twitterId: string
      expiresAt: number
    }
  }
  identityObservations: {
    key: [string, number, string, number, string]
    value: IdentityObservationRecord
    indexes: {
      byHandleObservedAt: [string, number]
      twitterId: string
      receivedAt: number
    }
  }
  identityResolutionCache: {
    key: string
    value: IdentityResolutionCacheRecord
    indexes: {
      expiresAt: number
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

type StoreName =
  | 'events'
  | 'addresses'
  | 'tagIndex'
  | 'relayObservations'
  | 'syncCursors'
  | 'xIdentities'
  | 'handleAliases'
  | 'identityObservations'
  | 'identityResolutionCache'
  | 'outbox'
  | 'relayHealth'
  | 'relayErrorLog'

type UpgradeTransaction = IDBPTransaction<
  AttentionXSchema,
  StoreName[],
  'versionchange'
>

function createV1Stores(
  database: IDBPDatabase<AttentionXSchema>,
  transaction: UpgradeTransaction,
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

  const addresses = database.objectStoreNames.contains('addresses')
    ? transaction.objectStore('addresses')
    : database.createObjectStore('addresses', { keyPath: 'address' })
  if (!addresses.indexNames.contains('eventId')) {
    addresses.createIndex('eventId', 'eventId')
  }

  const tagIndex = database.objectStoreNames.contains('tagIndex')
    ? transaction.objectStore('tagIndex')
    : database.createObjectStore('tagIndex', { keyPath: 'key' })
  if (!tagIndex.indexNames.contains('byTag')) {
    tagIndex.createIndex('byTag', ['kind', 'tagName', 'tagValue'])
  }
  if (!tagIndex.indexNames.contains('eventId')) {
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
  database: IDBPDatabase<AttentionXSchema>,
  transaction: UpgradeTransaction,
): void {
  // Re-running the previous migration is intentional. Upgrade transactions are
  // atomic, and the contains checks make a retry safe after an aborted open.
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
  database: IDBPDatabase<AttentionXSchema>,
  transaction: UpgradeTransaction,
): Promise<void> {
  const existingEvents = await transaction.objectStore('events').getAll()

  // V2 used a colon-concatenated primary key, which could alias distinct tags.
  // Recreate this derived store and rebuild it with an unambiguous compound key.
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
  database: IDBPDatabase<AttentionXSchema>,
  transaction: UpgradeTransaction,
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
  database: IDBPDatabase<AttentionXSchema>,
  _transaction: UpgradeTransaction,
): void {
  if (database.objectStoreNames.contains('xIdentities')) {
    database.deleteObjectStore('xIdentities')
  }
  const identities = database.createObjectStore('xIdentities', {
    keyPath: 'twitterId',
  })
  identities.createIndex('nip39Npub', 'nip39Npub')
}

export function openAttentionXDatabase(
  options: OpenStorageOptions = {},
): Promise<IDBPDatabase<AttentionXSchema>> {
  return openDB<AttentionXSchema>(
    options.name ?? ATTENTIONX_DB_NAME,
    ATTENTIONX_DB_VERSION,
    {
      async upgrade(database, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          createV1Stores(database, transaction)
        }
        if (oldVersion < 2) {
          createV2Stores(database, transaction)
        }
        if (oldVersion < 3) {
          await createV3Stores(database, transaction)
        }
        if (oldVersion < 4) {
          createV4Stores(database, transaction)
        }
        if (oldVersion < 5) {
          createV5Stores(database, transaction)
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
