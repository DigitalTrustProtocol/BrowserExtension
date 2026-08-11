import type { IDBPDatabase } from 'idb'
import {
  getEventHash,
  validateEvent,
  verifyEvent,
  type Event,
} from 'nostr-tools'
import { validateSignedKind10011Event } from '../shared/kind-10011'
import { validateKind32009Event } from '../shared/kind-32009'
import { isDemoWotEvent } from '../shared/demo-wot'
import {
  isOutboxClaimActive,
  OUTBOX_HOLD_MS,
} from '../relay/outbox-hold'
import {
  DEMO_EVENT_STATE,
  formatEventAddress,
  openAttentionXDatabase,
  type AttentionXSchema,
  type OpenStorageOptions,
} from './schema'
import type {
  EventIngestion,
  EventRecord,
  OutboxAttemptResult,
  OutboxRecord,
  OutboxRelayState,
  RawEventExport,
  RawEventImportResult,
  RelayErrorLogRecord,
  RelayFailureKind,
  RelayHealthRecord,
  RelayHealthStatus,
  RelayObservationRecord,
  SignedNostrEvent,
  StoreEventAndEnqueueOptions,
  SyncCursorRecord,
  XIdentityRecord,
  XPostRecord,
} from './types'

const RAW_EXPORT_VERSION = 1
const MAX_RELAY_ERROR_LOG = 200

const ATTENTIONX_STORE_NAMES = [
  'events',
  'relayObservations',
  'syncCursors',
  'xIdentities',
  'xPosts',
  'outbox',
  'relayHealth',
  'relayErrorLog',
] as const

export function eventAddress(
  kind: number,
  pubkey: string,
  dTag: string,
): string {
  return formatEventAddress(kind, pubkey, dTag)
}

export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, '').toLowerCase()
}

function relayObservationKey(relayUrl: string, eventId: string): string {
  return `${relayUrl}:${eventId}`
}

function syncCursorKey(relayUrl: string, scopeHash: string): string {
  return `${relayUrl}:${scopeHash}`
}

function dTagFromEvent(event: SignedNostrEvent): string {
  const dTags = event.tags.filter((tag) => tag[0] === 'd')
  return dTags.length === 1 && typeof dTags[0]?.[1] === 'string'
    ? dTags[0][1]
    : ''
}

/** Local-only suffix so demo slots never collide with production addressKeys. */
export const DEMO_ADDRESS_KEY_SUFFIX = ':demo' as const

function resolveEventState(
  event: SignedNostrEvent,
  explicit?: string,
): string | undefined {
  if (explicit !== undefined && explicit !== '') return explicit
  if (isDemoWotEvent(event)) return DEMO_EVENT_STATE
  return undefined
}

export function addressKeyForEvent(
  event: SignedNostrEvent,
  options: { state?: string } = {},
): string {
  const base = eventAddress(event.kind, event.pubkey, dTagFromEvent(event))
  const state = resolveEventState(event, options.state)
  if (state === DEMO_EVENT_STATE) {
    return `${base}${DEMO_ADDRESS_KEY_SUFFIX}`
  }
  return base
}

function isNewerSignedEvent(
  candidate: SignedNostrEvent,
  current: SignedNostrEvent,
): boolean {
  return (
    candidate.created_at > current.created_at ||
    (candidate.created_at === current.created_at &&
      candidate.id < current.id)
  )
}

function eventRecord(
  event: SignedNostrEvent,
  firstSeenAt: number,
  options: { state?: string; addressKey?: string } = {},
): EventRecord {
  const state = resolveEventState(event, options.state)
  return {
    ...event,
    tags: event.tags.map((tag) => [...tag]),
    firstSeenAt,
    addressKey: options.addressKey ?? addressKeyForEvent(event, { state }),
    ...(state !== undefined ? { state } : {}),
  }
}

function pendingRelayState(now = Date.now()): OutboxRelayState {
  return {
    status: 'pending',
    attempts: 0,
    nextAttemptAt: now + OUTBOX_HOLD_MS,
  }
}

function isEventRecord(value: unknown): value is EventRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<EventRecord>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.pubkey === 'string' &&
    Number.isSafeInteger(candidate.created_at) &&
    Number.isSafeInteger(candidate.kind) &&
    Array.isArray(candidate.tags) &&
    candidate.tags.every(
      (tag) =>
        Array.isArray(tag) && tag.every((part) => typeof part === 'string'),
    ) &&
    typeof candidate.content === 'string' &&
    typeof candidate.sig === 'string' &&
    Number.isSafeInteger(candidate.firstSeenAt) &&
    (candidate.firstSeenAt ?? -1) >= 0
  )
}

function normalizeImportedEventRecord(record: EventRecord): EventRecord {
  const state = resolveEventState(record, record.state)
  const addressKey =
    typeof record.addressKey === 'string' &&
    record.addressKey.length > 0 &&
    (state !== DEMO_EVENT_STATE ||
      record.addressKey.endsWith(DEMO_ADDRESS_KEY_SUFFIX))
      ? record.addressKey
      : addressKeyForEvent(record, { state })
  return {
    ...record,
    tags: record.tags.map((tag) => [...tag]),
    addressKey,
    ...(state !== undefined ? { state } : {}),
  }
}

async function isValidSupportedRawEvent(
  value: unknown,
): Promise<boolean> {
  if (!isEventRecord(value) || ![32009, 10011].includes(value.kind)) {
    return false
  }
  const event: Event = {
    id: value.id,
    pubkey: value.pubkey,
    created_at: value.created_at,
    kind: value.kind,
    tags: value.tags.map((tag) => [...tag]),
    content: value.content,
    sig: value.sig,
  }
  try {
    const validSignature =
      validateEvent(event) &&
      getEventHash(event) === event.id &&
      verifyEvent(event)
    if (!validSignature) return false
    if (event.kind === 32009) {
      return (await validateKind32009Event(event)).valid
    }
    return validateSignedKind10011Event(event).valid
  } catch {
    return false
  }
}

export class AttentionXRepository {
  private readonly database: IDBPDatabase<AttentionXSchema>

  constructor(database: IDBPDatabase<AttentionXSchema>) {
    this.database = database
  }

  static async open(
    options: OpenStorageOptions = {},
  ): Promise<AttentionXRepository> {
    return new AttentionXRepository(await openAttentionXDatabase(options))
  }

  close(): void {
    this.database.close()
  }

  async ingestEvent(input: EventIngestion): Promise<EventRecord> {
    const firstSeenAt = input.firstSeenAt ?? Date.now()
    const observedAt = input.observedAt ?? firstSeenAt
    const addressKey = addressKeyForEvent(input.event, { state: input.state })
    const stores = ['events', 'relayObservations', 'outbox'] as const
    const transaction = this.database.transaction(stores, 'readwrite')
    const events = transaction.objectStore('events')
    const outbox = transaction.objectStore('outbox')

    const sameId = await events.get(input.event.id)
    const slotWinner = await events.index('addressKey').get(addressKey)

    if (
      slotWinner !== undefined &&
      slotWinner.id !== input.event.id &&
      !isNewerSignedEvent(input.event, slotWinner)
    ) {
      // Older-than-winner: keep existing slot, do not store the loser.
      if (input.relayUrl !== undefined) {
        const observations = transaction.objectStore('relayObservations')
        const key = relayObservationKey(input.relayUrl, slotWinner.id)
        const previous = await observations.get(key)
        await observations.put({
          key,
          relayUrl: input.relayUrl,
          eventId: slotWinner.id,
          firstSeenAt:
            previous === undefined
              ? observedAt
              : Math.min(previous.firstSeenAt, observedAt),
          lastSeenAt:
            previous === undefined
              ? observedAt
              : Math.max(previous.lastSeenAt, observedAt),
        })
      }
      await transaction.done
      return slotWinner
    }

    if (
      slotWinner !== undefined &&
      slotWinner.id !== input.event.id
    ) {
      await events.delete(slotWinner.id)
      await outbox.delete(slotWinner.id)
      const observations = transaction.objectStore('relayObservations')
      for (const key of await observations
        .index('eventId')
        .getAllKeys(slotWinner.id)) {
        await observations.delete(key)
      }
    }

    const record = eventRecord(
      input.event,
      sameId === undefined
        ? firstSeenAt
        : Math.min(firstSeenAt, sameId.firstSeenAt),
      { state: input.state, addressKey },
    )
    await events.put(record)

    if (input.relayUrl !== undefined) {
      const observations = transaction.objectStore('relayObservations')
      const key = relayObservationKey(input.relayUrl, input.event.id)
      const previous = await observations.get(key)
      await observations.put({
        key,
        relayUrl: input.relayUrl,
        eventId: input.event.id,
        firstSeenAt:
          previous === undefined
            ? observedAt
            : Math.min(previous.firstSeenAt, observedAt),
        lastSeenAt:
          previous === undefined
            ? observedAt
            : Math.max(previous.lastSeenAt, observedAt),
      })
    }

    await transaction.done
    return record
  }

  async getEvent(eventId: string): Promise<EventRecord | undefined> {
    return this.database.get('events', eventId)
  }

  async hasEvent(eventId: string): Promise<boolean> {
    return (await this.database.getKey('events', eventId)) !== undefined
  }

  async getAllEvents(): Promise<EventRecord[]> {
    return this.database.getAll('events')
  }

  async clearAllStores(): Promise<void> {
    const tx = this.database.transaction([...ATTENTIONX_STORE_NAMES], 'readwrite')
    await Promise.all(
      ATTENTIONX_STORE_NAMES.map((name) => tx.objectStore(name).clear()),
    )
    await tx.done
  }

  async getStorageStats(): Promise<{
    databaseName: string
    databaseVersion: number
    stores: Record<string, number>
    eventsByKind: Record<string, number>
    outboxByStatus: Record<string, number>
  }> {
    const stores: Record<string, number> = {}
    await Promise.all(
      ATTENTIONX_STORE_NAMES.map(async (name) => {
        stores[name] = await this.database.count(name)
      }),
    )

    const events = await this.getAllEvents()
    const eventsByKind: Record<string, number> = {}
    for (const event of events) {
      const key = String(event.kind)
      eventsByKind[key] = (eventsByKind[key] ?? 0) + 1
    }

    const outbox = await this.database.getAll('outbox')
    const outboxByStatus: Record<string, number> = {
      pending: 0,
      published: 0,
      failed: 0,
      exhausted: 0,
    }
    for (const record of outbox) {
      for (const state of Object.values(record.relays)) {
        outboxByStatus[state.status] =
          (outboxByStatus[state.status] ?? 0) + 1
      }
    }

    return {
      databaseName: this.database.name,
      databaseVersion: this.database.version,
      stores,
      eventsByKind,
      outboxByStatus,
    }
  }

  async getEventsByKind(
    kind: number,
    limit?: number,
  ): Promise<EventRecord[]> {
    const index = this.database.transaction('events').store.index('kind')
    return limit === undefined ? index.getAll(kind) : index.getAll(kind, limit)
  }

  async getEventsByPubkey(
    pubkey: string,
    limit?: number,
  ): Promise<EventRecord[]> {
    const index = this.database.transaction('events').store.index('pubkey')
    return limit === undefined
      ? index.getAll(pubkey)
      : index.getAll(pubkey, limit)
  }

  async getEventsCreatedBetween(
    lower: number,
    upper: number,
    limit?: number,
  ): Promise<EventRecord[]> {
    const range = IDBKeyRange.bound(lower, upper)
    const index = this.database
      .transaction('events')
      .store.index('created_at')
    return limit === undefined
      ? index.getAll(range)
      : index.getAll(range, limit)
  }

  async deleteEvent(eventId: string): Promise<boolean> {
    const stores = ['events', 'relayObservations', 'outbox'] as const
    const transaction = this.database.transaction(stores, 'readwrite')
    const events = transaction.objectStore('events')
    const existed = (await events.getKey(eventId)) !== undefined
    if (!existed) {
      await transaction.done
      return false
    }

    await events.delete(eventId)
    await transaction.objectStore('outbox').delete(eventId)
    const observations = transaction.objectStore('relayObservations')
    for (const key of await observations
      .index('eventId')
      .getAllKeys(eventId)) {
      await observations.delete(key)
    }
    await transaction.done
    return true
  }

  async getEventByAddressKey(
    addressKey: string,
  ): Promise<EventRecord | undefined> {
    return this.database.getFromIndex('events', 'addressKey', addressKey)
  }

  async getEventIdByAddressKey(
    addressKey: string,
  ): Promise<string | undefined> {
    return (await this.getEventByAddressKey(addressKey))?.id
  }

  async getEventIdsByState(state: string): Promise<string[]> {
    const records = await this.database.getAllFromIndex(
      'events',
      'state',
      state,
    )
    return records.map(({ id }) => id)
  }

  /**
   * Rewrite legacy demo rows so their addressKey uses the `:demo` suffix.
   * Safe to run repeatedly; does not touch production slots.
   */
  async ensureDemoAddressKeysNamespaced(): Promise<number> {
    const records = await this.database.getAllFromIndex(
      'events',
      'state',
      DEMO_EVENT_STATE,
    )
    let fixed = 0
    const transaction = this.database.transaction('events', 'readwrite')
    for (const record of records) {
      const expected = addressKeyForEvent(record, { state: DEMO_EVENT_STATE })
      if (record.addressKey === expected) continue
      await transaction.store.put({ ...record, addressKey: expected })
      fixed += 1
    }
    await transaction.done
    return fixed
  }

  async getRelayObservation(
    relayUrl: string,
    eventId: string,
  ): Promise<RelayObservationRecord | undefined> {
    return this.database.get(
      'relayObservations',
      relayObservationKey(relayUrl, eventId),
    )
  }

  async getRelayObservations(
    relayUrl: string,
  ): Promise<RelayObservationRecord[]> {
    return this.database.getAllFromIndex(
      'relayObservations',
      'relayUrl',
      relayUrl,
    )
  }

  async deleteRelayObservation(
    relayUrl: string,
    eventId: string,
  ): Promise<void> {
    await this.database.delete(
      'relayObservations',
      relayObservationKey(relayUrl, eventId),
    )
  }

  async putSyncCursor(
    cursor: Omit<SyncCursorRecord, 'key'>,
  ): Promise<SyncCursorRecord> {
    const record = {
      ...cursor,
      retry: { ...cursor.retry },
      key: syncCursorKey(cursor.relayUrl, cursor.scopeHash),
    }
    await this.database.put('syncCursors', record)
    return record
  }

  async getSyncCursor(
    relayUrl: string,
    scopeHash: string,
  ): Promise<SyncCursorRecord | undefined> {
    return this.database.get(
      'syncCursors',
      syncCursorKey(relayUrl, scopeHash),
    )
  }

  async getSyncCursorsForRelay(
    relayUrl: string,
  ): Promise<SyncCursorRecord[]> {
    return this.database.getAllFromIndex('syncCursors', 'relayUrl', relayUrl)
  }

  async deleteSyncCursor(relayUrl: string, scopeHash: string): Promise<void> {
    await this.database.delete(
      'syncCursors',
      syncCursorKey(relayUrl, scopeHash),
    )
  }

  async putXIdentity(identity: XIdentityRecord): Promise<void> {
    const handle = identity.handle ? normalizeHandle(identity.handle) : ''
    const record: XIdentityRecord = {
      ...identity,
      handle,
      lastSeen: identity.lastSeen,
    }
    const transaction = this.database.transaction('xIdentities', 'readwrite')
    if (handle) {
      const owners = await transaction.store.index('handle').getAll(handle)
      for (const owner of owners) {
        if (owner.twitterId === record.twitterId) continue
        await transaction.store.put({
          ...owner,
          handle: '',
          updatedAt: Math.max(owner.updatedAt, record.updatedAt),
        })
      }
    }
    await transaction.store.put(record)
    await transaction.done
  }

  async getXIdentity(
    twitterId: string,
  ): Promise<XIdentityRecord | undefined> {
    return this.database.get('xIdentities', twitterId)
  }

  async getAllXIdentities(): Promise<XIdentityRecord[]> {
    return this.database.getAll('xIdentities')
  }

  /** Rows bound to this Nostr npub on the nip39 side (indexed). */
  async getXIdentitiesByNip39Npub(npub: string): Promise<XIdentityRecord[]> {
    const normalized = npub.trim().toLowerCase()
    return this.database.getAllFromIndex('xIdentities', 'nip39Npub', normalized)
  }

  /**
   * Clear nip39 columns from every row bound to this npub.
   * Does not derive `state` / `proofSource` — callers must run status sync
   * afterward so status is recomputed from the remaining columns.
   */
  async clearNip39BindingByNpub(
    npub: string,
    updatedAt = Date.now(),
  ): Promise<number> {
    const normalized = npub.trim().toLowerCase()
    const transaction = this.database.transaction('xIdentities', 'readwrite')
    let cleared = 0
    const matching = await transaction.store.index('nip39Npub').getAll(normalized)
    for (const identity of matching) {
      cleared += 1
      const next: XIdentityRecord = {
        twitterId: identity.twitterId,
        handle: identity.handle,
        ...(identity.displayName ? { displayName: identity.displayName } : {}),
        ...(identity.iconPath ? { iconPath: identity.iconPath } : {}),
        ...(identity.xNpub ? { xNpub: identity.xNpub } : {}),
        ...(identity.xDate !== undefined ? { xDate: identity.xDate } : {}),
        ...(identity.xObservedAt !== undefined
          ? { xObservedAt: identity.xObservedAt }
          : {}),
        ...(identity.postNpub ? { postNpub: identity.postNpub } : {}),
        ...(identity.postId ? { postId: identity.postId } : {}),
        ...(identity.postHandle ? { postHandle: identity.postHandle } : {}),
        ...(identity.postDate !== undefined
          ? { postDate: identity.postDate }
          : {}),
        ...(identity.postObservedAt !== undefined
          ? { postObservedAt: identity.postObservedAt }
          : {}),
        ...(identity.eventNpub ? { eventNpub: identity.eventNpub } : {}),
        ...(identity.eventDate !== undefined
          ? { eventDate: identity.eventDate }
          : {}),
        ...(identity.eventId ? { eventId: identity.eventId } : {}),
        ...(identity.eventIssuer ? { eventIssuer: identity.eventIssuer } : {}),
        // Preserve prior status until the caller re-runs status sync.
        state: identity.state,
        ...(identity.proofSource ? { proofSource: identity.proofSource } : {}),
        ...(identity.verifiedAt !== undefined
          ? { verifiedAt: identity.verifiedAt }
          : {}),
        createdAt: identity.createdAt,
        updatedAt: Math.max(identity.updatedAt, updatedAt),
        lastSeen: identity.lastSeen,
      }
      await transaction.store.put(next)
    }
    await transaction.done
    return cleared
  }

  /**
   * Clear Bio-side columns for one twitterId. Caller must run status sync.
   */
  async clearBioSide(
    twitterId: string,
    updatedAt = Date.now(),
  ): Promise<boolean> {
    const identity = await this.getXIdentity(twitterId)
    if (!identity) return false
    if (!identity.xNpub && identity.xDate === undefined && identity.xObservedAt === undefined) {
      return false
    }
    const next: XIdentityRecord = {
      ...identity,
      updatedAt: Math.max(identity.updatedAt, updatedAt),
    }
    delete next.xNpub
    delete next.xDate
    delete next.xObservedAt
    await this.database.put('xIdentities', next)
    return true
  }

  /**
   * Clear Post-proof columns for one twitterId. Caller must run status sync.
   */
  async clearPostSide(
    twitterId: string,
    updatedAt = Date.now(),
  ): Promise<boolean> {
    const identity = await this.getXIdentity(twitterId)
    if (!identity) return false
    if (
      !identity.postNpub &&
      !identity.postId &&
      !identity.postHandle &&
      identity.postDate === undefined &&
      identity.postObservedAt === undefined
    ) {
      return false
    }
    const next: XIdentityRecord = {
      ...identity,
      updatedAt: Math.max(identity.updatedAt, updatedAt),
    }
    delete next.postNpub
    delete next.postId
    delete next.postHandle
    delete next.postDate
    delete next.postObservedAt
    await this.database.put('xIdentities', next)
    return true
  }

  /** Mark rows whose nip39 npub matches as revoked (keeps columns for audit). */
  async revokeXIdentityByNip39Npub(
    npub: string,
    updatedAt = Date.now(),
  ): Promise<number> {
    const normalized = npub.trim().toLowerCase()
    const transaction = this.database.transaction('xIdentities', 'readwrite')
    let revoked = 0
    const matching = await transaction.store.index('nip39Npub').getAll(normalized)
    for (const identity of matching) {
      if (identity.state === 'revoked') continue
      revoked += 1
      await transaction.store.put({
        ...identity,
        state: 'revoked',
        updatedAt: Math.max(identity.updatedAt, updatedAt),
      })
    }
    await transaction.done
    return revoked
  }

  async deleteXIdentity(twitterId: string): Promise<void> {
    await this.database.delete('xIdentities', twitterId)
  }

  async putXPost(post: XPostRecord): Promise<void> {
    const authorHandle = post.authorHandle
      ? normalizeHandle(post.authorHandle)
      : undefined
    const record: XPostRecord = {
      ...post,
      ...(authorHandle ? { authorHandle } : {}),
    }
    await this.database.put('xPosts', record)
  }

  /**
   * Merge chrome into an existing row (or create). Touches `lastSeen`.
   * Does not apply the trust gate — callers must check evidence first.
   */
  async upsertXPostChrome(
    input: {
      postId: string
      authorTwitterId?: string
      authorHandle?: string
      headline?: string
      role?: XPostRecord['role']
      parentPostId?: string
    },
    observedAt = Date.now(),
  ): Promise<XPostRecord> {
    const existing = await this.database.get('xPosts', input.postId)
    const authorHandle = input.authorHandle
      ? normalizeHandle(input.authorHandle)
      : undefined
    const createdAt = existing?.createdAt ?? observedAt
    const dataChanged =
      (input.authorTwitterId !== undefined &&
        input.authorTwitterId !== existing?.authorTwitterId) ||
      (authorHandle !== undefined && authorHandle !== existing?.authorHandle) ||
      (input.headline !== undefined && input.headline !== existing?.headline) ||
      (input.role !== undefined && input.role !== existing?.role) ||
      (input.parentPostId !== undefined &&
        input.parentPostId !== existing?.parentPostId)
    const record: XPostRecord = {
      postId: input.postId,
      ...(input.authorTwitterId || existing?.authorTwitterId
        ? {
            authorTwitterId:
              input.authorTwitterId ?? existing?.authorTwitterId,
          }
        : {}),
      ...(authorHandle || existing?.authorHandle
        ? { authorHandle: authorHandle ?? existing?.authorHandle }
        : {}),
      ...(input.headline || existing?.headline
        ? { headline: input.headline ?? existing?.headline }
        : {}),
      ...(input.role || existing?.role
        ? { role: input.role ?? existing?.role }
        : {}),
      ...(input.parentPostId || existing?.parentPostId
        ? { parentPostId: input.parentPostId ?? existing?.parentPostId }
        : {}),
      createdAt,
      updatedAt: dataChanged
        ? Math.max(existing?.updatedAt ?? 0, observedAt)
        : (existing?.updatedAt ?? observedAt),
      lastSeen: Math.max(existing?.lastSeen ?? 0, observedAt),
    }
    await this.database.put('xPosts', record)
    return record
  }

  async getXPost(postId: string): Promise<XPostRecord | undefined> {
    return this.database.get('xPosts', postId)
  }

  async getAllXPosts(): Promise<XPostRecord[]> {
    return this.database.getAll('xPosts')
  }

  async getXPostsByAuthor(twitterId: string): Promise<XPostRecord[]> {
    return this.database.getAllFromIndex('xPosts', 'authorTwitterId', twitterId)
  }

  async deleteXPost(postId: string): Promise<void> {
    await this.database.delete('xPosts', postId)
  }

  /** Delete posts whose ids are not in `keepPostIds`. */
  async deleteXPostsNotIn(keepPostIds: ReadonlySet<string>): Promise<number> {
    const all = await this.getAllXPosts()
    const toDelete = all.filter((post) => !keepPostIds.has(post.postId))
    if (toDelete.length === 0) return 0
    const tx = this.database.transaction('xPosts', 'readwrite')
    await Promise.all(toDelete.map((post) => tx.store.delete(post.postId)))
    await tx.done
    return toDelete.length
  }

  async enqueueOutbox(
    eventId: string,
    relayUrls: readonly string[],
    now = Date.now(),
  ): Promise<OutboxRecord> {
    const transaction = this.database.transaction('outbox', 'readwrite')
    const existing = await transaction.store.get(eventId)
    const relays = { ...existing?.relays }
    for (const relayUrl of relayUrls) {
      relays[relayUrl] ??= pendingRelayState(now)
    }
    const record: OutboxRecord = {
      eventId,
      relays,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await transaction.store.put(record)
    await transaction.done
    return record
  }

  async storeEventAndEnqueue(
    event: SignedNostrEvent,
    relayUrls: readonly string[],
    options: number | StoreEventAndEnqueueOptions = Date.now(),
  ): Promise<void> {
    // Demo WoT events are local-only fixtures with ephemeral keys — never outbox.
    if (isDemoWotEvent(event)) {
      throw new Error('Demo WoT events must not be published to relays')
    }
    const normalizedOptions =
      typeof options === 'number' ? { now: options } : options
    const now = normalizedOptions.now ?? Date.now()
    const addressKey = addressKeyForEvent(event, {
      state: normalizedOptions.state,
    })
    const transaction = this.database.transaction(
      ['events', 'outbox'],
      'readwrite',
    )
    const events = transaction.objectStore('events')
    const outbox = transaction.objectStore('outbox')

    const slotWinner = await events.index('addressKey').get(addressKey)
    if (
      slotWinner !== undefined &&
      slotWinner.id !== event.id
    ) {
      if (!isNewerSignedEvent(event, slotWinner)) {
        await transaction.done
        throw new Error(
          'Cannot enqueue an event that loses its addressable slot',
        )
      }
      await events.delete(slotWinner.id)
      await outbox.delete(slotWinner.id)
    }

    const existingEvent = await events.get(event.id)
    await events.put(
      eventRecord(event, existingEvent?.firstSeenAt ?? now, {
        state: normalizedOptions.state,
        addressKey,
      }),
    )

    const existingOutbox = await outbox.get(event.id)
    const relays = { ...existingOutbox?.relays }
    for (const relayUrl of relayUrls) {
      relays[relayUrl] ??= pendingRelayState(now)
    }
    await outbox.put({
      eventId: event.id,
      relays,
      createdAt: existingOutbox?.createdAt ?? now,
      updatedAt: now,
    })
    await transaction.done
  }

  async getOutbox(eventId: string): Promise<OutboxRecord | undefined> {
    return this.database.get('outbox', eventId)
  }

  async listOutbox(): Promise<OutboxRecord[]> {
    return this.database.getAll('outbox')
  }

  /**
   * Clear the regret hold so pending/failed relays are due immediately.
   * Returns undefined when the outbox row is missing.
   */
  async clearOutboxHold(
    eventId: string,
    now = Date.now(),
  ): Promise<OutboxRecord | undefined> {
    const existing = await this.getOutbox(eventId)
    if (!existing) return undefined
    const relays: Record<string, OutboxRelayState> = {}
    for (const [relayUrl, state] of Object.entries(existing.relays)) {
      if (state.status === 'pending' || state.status === 'failed') {
        const cleared: OutboxRelayState = { ...state, nextAttemptAt: now }
        delete cleared.claimedAt
        relays[relayUrl] = cleared
      } else {
        relays[relayUrl] = { ...state }
      }
    }
    const updated: OutboxRecord = {
      ...existing,
      relays,
      updatedAt: now,
    }
    await this.database.put('outbox', updated)
    return updated
  }

  async getDueOutbox(now = Date.now()): Promise<OutboxRecord[]> {
    const records = await this.database.getAll('outbox')
    const isDueRelay = (
      relay: OutboxRelayState,
      createdAt: number,
    ): boolean => {
      if (relay.status !== 'pending' && relay.status !== 'failed') {
        return false
      }
      if (isOutboxClaimActive(relay.claimedAt, now)) return false
      return (relay.nextAttemptAt ?? createdAt) <= now
    }
    const dueAt = (record: OutboxRecord): number => {
      const dueTimes = Object.values(record.relays)
        .filter((relay) => isDueRelay(relay, record.createdAt))
        .map((relay) => relay.nextAttemptAt ?? record.createdAt)
      return dueTimes.length === 0
        ? Number.POSITIVE_INFINITY
        : Math.min(...dueTimes)
    }
    return records
      .map((record) => ({ record, dueAt: dueAt(record) }))
      .filter(({ dueAt: candidate }) => Number.isFinite(candidate))
      .sort(
        (left, right) =>
          left.dueAt - right.dueAt ||
          left.record.createdAt - right.record.createdAt ||
          left.record.eventId.localeCompare(right.record.eventId),
      )
      .map(({ record }) => record)
  }

  /**
   * Atomically claim a due relay for publishing. Increments attempts and sets
   * `claimedAt`. Returns undefined when the row is missing, not due, terminal,
   * or already claimed by another flush.
   */
  async claimOutboxRelay(
    eventId: string,
    relayUrl: string,
    now = Date.now(),
  ): Promise<OutboxRelayState | undefined> {
    const transaction = this.database.transaction('outbox', 'readwrite')
    const record = await transaction.store.get(eventId)
    if (record === undefined) {
      await transaction.done
      return undefined
    }
    const previous = record.relays[relayUrl]
    if (
      previous === undefined ||
      previous.status === 'published' ||
      previous.status === 'exhausted'
    ) {
      await transaction.done
      return undefined
    }
    if (isOutboxClaimActive(previous.claimedAt, now)) {
      await transaction.done
      return undefined
    }
    const dueAt = previous.nextAttemptAt ?? record.createdAt
    const reclaimingStaleClaim =
      previous.claimedAt !== undefined &&
      !isOutboxClaimActive(previous.claimedAt, now)
    if (!reclaimingStaleClaim && dueAt > now) {
      await transaction.done
      return undefined
    }

    const next: OutboxRelayState = reclaimingStaleClaim
      ? {
          ...previous,
          claimedAt: now,
          lastAttemptAt: now,
        }
      : {
          status: previous.status === 'pending' ? 'pending' : 'failed',
          attempts: previous.attempts + 1,
          lastAttemptAt: now,
          claimedAt: now,
          ...(previous.nextAttemptAt === undefined
            ? {}
            : { nextAttemptAt: previous.nextAttemptAt }),
          ...(previous.lastError === undefined
            ? {}
            : { lastError: previous.lastError }),
        }
    const updated: OutboxRecord = {
      ...record,
      relays: { ...record.relays, [relayUrl]: next },
      updatedAt: now,
    }
    await transaction.store.put(updated)
    await transaction.done
    return next
  }

  /**
   * Persist the outcome of a claim. Never recreates a deleted outbox row.
   * Rejects stale completes when `expectedAttempts` no longer matches.
   */
  async completeOutboxRelay(
    eventId: string,
    relayUrl: string,
    expectedAttempts: number,
    result: OutboxAttemptResult,
    completedAt = Date.now(),
  ): Promise<'applied' | 'missing' | 'stale'> {
    const transaction = this.database.transaction('outbox', 'readwrite')
    const record = await transaction.store.get(eventId)
    if (record === undefined) {
      await transaction.done
      return 'missing'
    }
    const previous = record.relays[relayUrl]
    if (previous === undefined || previous.attempts !== expectedAttempts) {
      await transaction.done
      return 'stale'
    }
    const next: OutboxRelayState = result.ok
      ? {
          status: 'published',
          attempts: expectedAttempts,
          lastAttemptAt: previous.lastAttemptAt ?? completedAt,
          publishedAt: result.publishedAt ?? completedAt,
        }
      : {
          status: result.exhausted ? 'exhausted' : 'failed',
          attempts: expectedAttempts,
          lastAttemptAt: previous.lastAttemptAt ?? completedAt,
          ...(result.exhausted
            ? {}
            : { nextAttemptAt: result.nextAttemptAt }),
          lastError: result.error ?? 'Relay publish failed',
        }
    const updated: OutboxRecord = {
      ...record,
      relays: { ...record.relays, [relayUrl]: next },
      updatedAt: completedAt,
    }
    await transaction.store.put(updated)
    await transaction.done
    return 'applied'
  }

  async recordOutboxAttempt(
    eventId: string,
    relayUrl: string,
    result: OutboxAttemptResult,
    attemptedAt = Date.now(),
  ): Promise<OutboxRecord> {
    const transaction = this.database.transaction('outbox', 'readwrite')
    const record = await transaction.store.get(eventId)
    if (record === undefined) {
      throw new Error(`Outbox event not found: ${eventId}`)
    }
    const previous = record.relays[relayUrl] ?? pendingRelayState(attemptedAt)
    const next: OutboxRelayState = result.ok
      ? {
          status: 'published',
          attempts: previous.attempts + 1,
          lastAttemptAt: attemptedAt,
          publishedAt: result.publishedAt ?? attemptedAt,
        }
      : {
          status: result.exhausted ? 'exhausted' : 'failed',
          attempts: previous.attempts + 1,
          lastAttemptAt: attemptedAt,
          ...(result.exhausted
            ? {}
            : { nextAttemptAt: result.nextAttemptAt }),
          lastError: result.error ?? 'Relay publish failed',
        }
    const updated: OutboxRecord = {
      ...record,
      relays: { ...record.relays, [relayUrl]: next },
      updatedAt: attemptedAt,
    }
    await transaction.store.put(updated)
    await transaction.done
    return updated
  }

  async deleteOutbox(eventId: string): Promise<void> {
    await this.database.delete('outbox', eventId)
  }

  /**
   * Stop retrying relays that are no longer in the user's configured list.
   * Leaves already-published deliveries intact.
   */
  async pruneOutboxRelays(
    allowedRelayUrls: readonly string[],
    now = Date.now(),
  ): Promise<number> {
    const allowed = new Set(
      allowedRelayUrls.map((url) => url.replace(/\/$/, '')),
    )
    const records = await this.database.getAll('outbox')
    let pruned = 0
    const transaction = this.database.transaction('outbox', 'readwrite')
    for (const record of records) {
      let changed = false
      const relays = { ...record.relays }
      for (const [relayUrl, state] of Object.entries(relays)) {
        const normalized = relayUrl.replace(/\/$/, '')
        if (allowed.has(normalized) || allowed.has(relayUrl)) continue
        if (state.status === 'published' || state.status === 'exhausted') {
          continue
        }
        relays[relayUrl] = {
          status: 'exhausted',
          attempts: state.attempts,
          ...(state.lastAttemptAt !== undefined
            ? { lastAttemptAt: state.lastAttemptAt }
            : { lastAttemptAt: now }),
          lastError: 'Relay removed from network settings',
        }
        changed = true
        pruned += 1
      }
      if (changed) {
        await transaction.store.put({
          ...record,
          relays,
          updatedAt: now,
        })
      }
    }
    await transaction.done
    return pruned
  }

  async exportRawEvents(exportedAt = Date.now()): Promise<RawEventExport> {
    return {
      format: 'attentionx-raw-events',
      version: RAW_EXPORT_VERSION,
      exportedAt,
      events: await this.database.getAll('events'),
    }
  }

  async importRawEvents(
    rawExport: RawEventExport,
  ): Promise<RawEventImportResult> {
    if (
      rawExport.format !== 'attentionx-raw-events' ||
      rawExport.version !== RAW_EXPORT_VERSION ||
      !Array.isArray(rawExport.events)
    ) {
      throw new Error('Unsupported or invalid AttentionX raw event export')
    }

    const accepted: EventRecord[] = []
    let rejected = 0
    for (const importedRecord of rawExport.events) {
      if (!(await isValidSupportedRawEvent(importedRecord))) {
        rejected += 1
        continue
      }
      accepted.push(importedRecord)
    }

    const transaction = this.database.transaction(['events', 'outbox'], 'readwrite')
    let imported = 0
    let duplicates = 0
    for (const importedRecord of accepted) {
      const normalized = normalizeImportedEventRecord(importedRecord)
      const existing = await transaction.objectStore('events').get(
        normalized.id,
      )
      if (existing !== undefined) {
        duplicates += 1
        if (normalized.firstSeenAt < existing.firstSeenAt) {
          await transaction.objectStore('events').put({
            ...existing,
            firstSeenAt: normalized.firstSeenAt,
          })
        }
        continue
      }

      const slotWinner = await transaction
        .objectStore('events')
        .index('addressKey')
        .get(normalized.addressKey)
      if (slotWinner !== undefined && slotWinner.id !== normalized.id) {
        if (!isNewerSignedEvent(normalized, slotWinner)) {
          rejected += 1
          continue
        }
        await transaction.objectStore('events').delete(slotWinner.id)
        await transaction.objectStore('outbox').delete(slotWinner.id)
      }

      await transaction.objectStore('events').put(normalized)
      imported += 1
    }
    await transaction.done
    return { imported, duplicates, rejected }
  }

  async getRelayHealth(
    relayUrl: string,
  ): Promise<RelayHealthRecord | undefined> {
    return this.database.get('relayHealth', relayUrl)
  }

  async listRelayHealth(): Promise<RelayHealthRecord[]> {
    return this.database.getAll('relayHealth')
  }

  async listRelayErrorLog(limit = 100): Promise<RelayErrorLogRecord[]> {
    const index = this.database
      .transaction('relayErrorLog')
      .store.index('at')
    const all = await index.getAll()
    return all.reverse().slice(0, Math.max(1, limit))
  }

  async recordRelaySuccess(
    relayUrl: string,
    now = Date.now(),
  ): Promise<RelayHealthRecord> {
    const record: RelayHealthRecord = {
      relayUrl,
      status: 'up',
      lastCheckedAt: now,
      lastSuccessAt: now,
      consecutiveFailures: 0,
      updatedAt: now,
    }
    await this.database.put('relayHealth', record)
    return record
  }

  async recordRelayFailure(input: {
    relayUrl: string
    kind: RelayFailureKind
    message: string
    now?: number
  }): Promise<RelayHealthRecord> {
    const now = input.now ?? Date.now()
    const message = input.message.trim().slice(0, 500) || 'Relay failure'
    const existing = await this.database.get('relayHealth', input.relayUrl)
    const health: RelayHealthRecord = {
      relayUrl: input.relayUrl,
      status: 'down',
      lastError: message,
      lastCheckedAt: now,
      consecutiveFailures: (existing?.consecutiveFailures ?? 0) + 1,
      updatedAt: now,
      ...(existing?.lastSuccessAt
        ? { lastSuccessAt: existing.lastSuccessAt }
        : {}),
    }
    const logId = `${now}:${Math.random().toString(36).slice(2, 10)}`
    const log: RelayErrorLogRecord = {
      id: logId,
      relayUrl: input.relayUrl,
      at: now,
      kind: input.kind,
      message,
    }

    const tx = this.database.transaction(
      ['relayHealth', 'relayErrorLog'],
      'readwrite',
    )
    await tx.objectStore('relayHealth').put(health)
    await tx.objectStore('relayErrorLog').put(log)
    const allLogs = await tx.objectStore('relayErrorLog').index('at').getAll()
    if (allLogs.length > MAX_RELAY_ERROR_LOG) {
      const overflow = allLogs.length - MAX_RELAY_ERROR_LOG
      for (let i = 0; i < overflow; i += 1) {
        const old = allLogs[i]
        if (old) await tx.objectStore('relayErrorLog').delete(old.id)
      }
    }
    await tx.done
    return health
  }

  async setRelayHealthStatus(input: {
    relayUrl: string
    status: RelayHealthStatus
    error?: string
    now?: number
  }): Promise<RelayHealthRecord> {
    if (input.status === 'up') {
      return this.recordRelaySuccess(input.relayUrl, input.now)
    }
    if (input.status === 'down') {
      return this.recordRelayFailure({
        relayUrl: input.relayUrl,
        kind: 'health',
        message: input.error ?? 'Relay unreachable',
        now: input.now,
      })
    }
    const now = input.now ?? Date.now()
    const existing = await this.database.get('relayHealth', input.relayUrl)
    const record: RelayHealthRecord = {
      relayUrl: input.relayUrl,
      status: 'unknown',
      lastCheckedAt: now,
      consecutiveFailures: existing?.consecutiveFailures ?? 0,
      updatedAt: now,
      ...(existing?.lastError ? { lastError: existing.lastError } : {}),
      ...(existing?.lastSuccessAt
        ? { lastSuccessAt: existing.lastSuccessAt }
        : {}),
    }
    await this.database.put('relayHealth', record)
    return record
  }
}
