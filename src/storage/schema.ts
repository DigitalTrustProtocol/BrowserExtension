import Dexie, { type Table } from 'dexie'
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
export const ATTENTIONX_DB_VERSION = 1
export { DEMO_EVENT_STATE } from './demo-event-state'

/** Dexie `version(1)` maps to native IndexedDB version 10. */
const NATIVE_IDB_VERSION = ATTENTIONX_DB_VERSION * 10

export interface OpenStorageOptions {
  name?: string
  blocked?: (currentVersion: number, blockedVersion: number | null) => void
}

export function formatEventAddress(
  kind: number,
  pubkey: string,
  dTag: string,
): string {
  return `${kind}:${pubkey}:${dTag}`
}

export class AttentionXDB extends Dexie {
  events!: Table<EventRecord, string>
  relayObservations!: Table<RelayObservationRecord, string>
  syncCursors!: Table<SyncCursorRecord, string>
  xIdentities!: Table<XIdentityRecord, string>
  xPosts!: Table<XPostRecord, string>
  outbox!: Table<OutboxRecord, string>
  relayHealth!: Table<RelayHealthRecord, string>
  relayErrorLog!: Table<RelayErrorLogRecord, string>

  constructor(name = ATTENTIONX_DB_NAME) {
    super(name)
    this.version(ATTENTIONX_DB_VERSION).stores({
      events: 'id, kind, pubkey, created_at, &addressKey, state',
      relayObservations: 'key, relayUrl, eventId',
      syncCursors: 'key, relayUrl, retry.nextRetryAt',
      xIdentities: 'twitterId, nip39Npub, handle, lastSeen',
      xPosts: 'postId, authorTwitterId, lastSeen',
      outbox: 'eventId, updatedAt',
      relayHealth: 'relayUrl, status, updatedAt',
      relayErrorLog: 'id, at, relayUrl',
    })
  }
}

async function peekNativeVersion(name: string): Promise<number | undefined> {
  if (!(await Dexie.exists(name))) return undefined
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onsuccess = () => {
      const version = request.result.version
      request.result.close()
      resolve(version)
    }
    request.onerror = () => {
      reject(request.error ?? new Error(`Failed to open ${name}`))
    }
  })
}

async function deleteIncompatibleDatabase(name: string): Promise<void> {
  const version = await peekNativeVersion(name)
  if (version !== undefined && version !== NATIVE_IDB_VERSION) {
    await Dexie.delete(name)
  }
}

export async function openAttentionXDatabase(
  options: OpenStorageOptions = {},
): Promise<AttentionXDB> {
  const name = options.name ?? ATTENTIONX_DB_NAME
  await deleteIncompatibleDatabase(name)
  const db = new AttentionXDB(name)
  if (options.blocked) {
    db.on('blocked', () => {
      options.blocked?.(ATTENTIONX_DB_VERSION, null)
    })
  }
  try {
    await db.open()
    return db
  } catch {
    db.close()
    await Dexie.delete(name)
    const fresh = new AttentionXDB(name)
    await fresh.open()
    return fresh
  }
}

export function deleteAttentionXDatabase(
  name = ATTENTIONX_DB_NAME,
): Promise<void> {
  return Dexie.delete(name)
}
