import type { IDBPDatabase } from 'idb'
import {
  getEventHash,
  validateEvent,
  verifyEvent,
  type Event,
} from 'nostr-tools'
import { validateSignedKind10011Event } from '../shared/kind-10011'
import { validateKind32009Event } from '../shared/kind-32009'
import {
  openAttentionXDatabase,
  type AttentionXSchema,
  type OpenStorageOptions,
} from './schema'
import type {
  AddressRecord,
  EventIngestion,
  EventRecord,
  HandleAliasRecord,
  HandleAliasSource,
  IdentityObservationInput,
  IdentityObservationRecord,
  IdentityResolutionCacheRecord,
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
  TagIndexRecord,
  XIdentityRecord,
} from './types'

const RAW_EXPORT_VERSION = 1
const MAX_RELAY_ERROR_LOG = 200

export function eventAddress(
  kind: number,
  pubkey: string,
  dTag: string,
): string {
  return `${kind}:${pubkey}:${dTag}`
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

function tagKey(
  kind: number,
  tagName: string,
  tagValue: string,
  eventId: string,
): [number, string, string, string] {
  return [kind, tagName, tagValue, eventId]
}

function eventRecord(event: SignedNostrEvent, firstSeenAt: number): EventRecord {
  return {
    ...event,
    tags: event.tags.map((tag) => [...tag]),
    firstSeenAt,
  }
}

function indexedTags(event: SignedNostrEvent): TagIndexRecord[] {
  const records = new Map<string, TagIndexRecord>()
  for (const tag of event.tags) {
    const [tagName, tagValue] = tag
    if (tagName === undefined || tagValue === undefined) {
      continue
    }
    const key = tagKey(event.kind, tagName, tagValue, event.id)
    records.set(JSON.stringify(key), {
      key,
      eventId: event.id,
      kind: event.kind,
      tagName,
      tagValue,
    })
  }
  return [...records.values()]
}

function pendingRelayState(): OutboxRelayState {
  return { status: 'pending', attempts: 0 }
}

const ALIAS_SOURCE_PRECEDENCE: Readonly<Record<HandleAliasSource, number>> = {
  dom: 0,
  'page-response': 0,
  import: 1,
  'profile-jsonld': 1,
  nip39: 2,
}

function identityObservationKey(
  observation: Omit<IdentityObservationRecord, 'key'>,
): IdentityObservationRecord['key'] {
  return [
    observation.handle,
    observation.observedAt,
    observation.twitterId,
    observation.receivedAt,
    observation.sourceOperation,
  ]
}

function cloneResolutionCacheRecord(
  record: IdentityResolutionCacheRecord,
): IdentityResolutionCacheRecord {
  if (record.state === 'resolved') {
    return {
      ...record,
      nostrPubkeys: record.nostrPubkeys
        ? [...new Set(record.nostrPubkeys)]
        : undefined,
    }
  }
  if (record.state === 'pending') {
    return { ...record, reasons: [...record.reasons] }
  }
  if (record.state === 'conflict') {
    return {
      ...record,
      candidates: record.candidates.map((candidate) => ({ ...candidate })),
    }
  }
  return { ...record }
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

function proofStateForClaims(
  claims: XIdentityRecord['claims'],
): XIdentityRecord['proofState'] {
  const precedence: XIdentityRecord['proofState'][] = [
    'verified',
    'pending',
    'unverified',
    'expired',
    'revoked',
  ]
  return (
    precedence.find((state) => claims.some((claim) => claim.state === state)) ??
    'unverified'
  )
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
    const stores = [
      'events',
      'tagIndex',
      'relayObservations',
      'addresses',
    ] as const
    const transaction = this.database.transaction(stores, 'readwrite')
    const events = transaction.objectStore('events')
    const existing = await events.get(input.event.id)
    const record = eventRecord(
      input.event,
      existing === undefined
        ? firstSeenAt
        : Math.min(firstSeenAt, existing.firstSeenAt),
    )
    await events.put(record)

    if (input.indexTags !== false) {
      const tags = transaction.objectStore('tagIndex')
      for (const tag of indexedTags(input.event)) {
        await tags.put(tag)
      }
    }

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

    if (input.address !== undefined) {
      await transaction.objectStore('addresses').put({
        address: input.address,
        eventId: input.event.id,
        updatedAt: observedAt,
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

  async getStorageStats(): Promise<{
    databaseName: string
    databaseVersion: number
    stores: Record<string, number>
    eventsByKind: Record<string, number>
    outboxByStatus: Record<string, number>
  }> {
    const storeNames = [
      'events',
      'addresses',
      'tagIndex',
      'relayObservations',
      'syncCursors',
      'xIdentities',
      'handleAliases',
      'identityObservations',
      'identityResolutionCache',
      'outbox',
      'relayHealth',
      'relayErrorLog',
    ] as const

    const stores: Record<string, number> = {}
    await Promise.all(
      storeNames.map(async (name) => {
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
    const stores = [
      'events',
      'tagIndex',
      'relayObservations',
      'addresses',
    ] as const
    const transaction = this.database.transaction(stores, 'readwrite')
    const events = transaction.objectStore('events')
    const existed = (await events.getKey(eventId)) !== undefined
    if (!existed) {
      await transaction.done
      return false
    }

    await events.delete(eventId)
    const tags = transaction.objectStore('tagIndex')
    for (const key of await tags.index('eventId').getAllKeys(eventId)) {
      await tags.delete(key)
    }
    const observations = transaction.objectStore('relayObservations')
    for (const key of await observations
      .index('eventId')
      .getAllKeys(eventId)) {
      await observations.delete(key)
    }
    const addresses = transaction.objectStore('addresses')
    for (const key of await addresses.index('eventId').getAllKeys(eventId)) {
      await addresses.delete(key)
    }
    await transaction.done
    return true
  }

  async setAddressWinner(
    address: string,
    eventId: string,
    updatedAt = Date.now(),
  ): Promise<AddressRecord | undefined> {
    const transaction = this.database.transaction('addresses', 'readwrite')
    const previous = await transaction.store.get(address)
    await transaction.store.put({ address, eventId, updatedAt })
    await transaction.done
    return previous
  }

  async getAddressWinner(address: string): Promise<string | undefined> {
    return (await this.database.get('addresses', address))?.eventId
  }

  async deleteAddress(address: string): Promise<void> {
    await this.database.delete('addresses', address)
  }

  async getEventIdsByTag(
    kind: number,
    tagName: string,
    tagValue: string,
  ): Promise<string[]> {
    const records = await this.database
      .transaction('tagIndex')
      .store.index('byTag')
      .getAll([kind, tagName, tagValue])
    return records.map(({ eventId }) => eventId)
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
    await this.database.put('xIdentities', {
      ...identity,
      handles: identity.handles.map(normalizeHandle),
      claims: identity.claims.map((claim) => ({ ...claim })),
    })
  }

  async getXIdentity(
    twitterId: string,
  ): Promise<XIdentityRecord | undefined> {
    return this.database.get('xIdentities', twitterId)
  }

  async getAllXIdentities(): Promise<XIdentityRecord[]> {
    return this.database.getAll('xIdentities')
  }

  async getXIdentitiesByClaimPubkey(
    pubkey: string,
  ): Promise<XIdentityRecord[]> {
    return (await this.getAllXIdentities()).filter((identity) =>
      identity.claims.some((claim) => claim.pubkey === pubkey),
    )
  }

  async removeXIdentityClaimsByPubkey(
    pubkey: string,
    updatedAt = Date.now(),
  ): Promise<number> {
    const transaction = this.database.transaction('xIdentities', 'readwrite')
    let removed = 0
    for (const identity of await transaction.store.getAll()) {
      const claims = identity.claims.filter((claim) => claim.pubkey !== pubkey)
      const removedFromIdentity = identity.claims.length - claims.length
      if (removedFromIdentity === 0) {
        continue
      }
      removed += removedFromIdentity
      await transaction.store.put({
        ...identity,
        claims,
        proofState: proofStateForClaims(claims),
        updatedAt: Math.max(identity.updatedAt, updatedAt),
      })
    }
    await transaction.done
    return removed
  }

  async revokeXIdentityClaimsByPubkey(
    pubkey: string,
    updatedAt = Date.now(),
  ): Promise<number> {
    const transaction = this.database.transaction('xIdentities', 'readwrite')
    let revoked = 0
    for (const identity of await transaction.store.getAll()) {
      const claims = identity.claims.map((claim) => {
        if (claim.pubkey !== pubkey || claim.state === 'revoked') {
          return claim
        }
        revoked += 1
        return { ...claim, state: 'revoked' as const }
      })
      if (claims.every((claim, index) => claim === identity.claims[index])) {
        continue
      }
      await transaction.store.put({
        ...identity,
        claims,
        proofState: proofStateForClaims(claims),
        updatedAt: Math.max(identity.updatedAt, updatedAt),
      })
    }
    await transaction.done
    return revoked
  }

  async deleteXIdentity(twitterId: string): Promise<void> {
    await this.database.delete('xIdentities', twitterId)
  }

  async putHandleAlias(
    alias: HandleAliasRecord,
  ): Promise<HandleAliasRecord> {
    const record = { ...alias, handle: normalizeHandle(alias.handle) }
    const transaction = this.database.transaction('handleAliases', 'readwrite')
    const existing = await transaction.store.get(record.handle)
    const incomingPrecedence = ALIAS_SOURCE_PRECEDENCE[record.source]
    const existingPrecedence =
      existing === undefined
        ? Number.NEGATIVE_INFINITY
        : ALIAS_SOURCE_PRECEDENCE[existing.source]
    const shouldReplace =
      existing === undefined ||
      (record.observedAt >= existing.observedAt &&
        (incomingPrecedence > existingPrecedence ||
          (incomingPrecedence === existingPrecedence &&
            record.observedAt > existing.observedAt)))
    if (shouldReplace) {
      await transaction.store.put(record)
    }
    await transaction.done
    return shouldReplace ? record : existing
  }

  async getHandleAlias(
    handle: string,
    activeAt?: number,
  ): Promise<HandleAliasRecord | undefined> {
    const alias = await this.database.get(
      'handleAliases',
      normalizeHandle(handle),
    )
    if (
      alias !== undefined &&
      activeAt !== undefined &&
      alias.expiresAt !== undefined &&
      alias.expiresAt <= activeAt
    ) {
      return undefined
    }
    return alias
  }

  async getHandleAliasesForTwitterId(
    twitterId: string,
  ): Promise<HandleAliasRecord[]> {
    return this.database.getAllFromIndex(
      'handleAliases',
      'twitterId',
      twitterId,
    )
  }

  async deleteHandleAlias(handle: string): Promise<void> {
    await this.database.delete('handleAliases', normalizeHandle(handle))
  }

  async deleteExpiredHandleAliases(expiredAt = Date.now()): Promise<number> {
    const transaction = this.database.transaction(
      'handleAliases',
      'readwrite',
    )
    const keys = await transaction.store
      .index('expiresAt')
      .getAllKeys(IDBKeyRange.upperBound(expiredAt))
    for (const key of keys) {
      await transaction.store.delete(key)
    }
    await transaction.done
    return keys.length
  }

  async putIdentityObservation(
    input: IdentityObservationInput,
    receivedAt = Date.now(),
  ): Promise<IdentityObservationRecord> {
    const [record] = await this.putIdentityObservations([input], receivedAt)
    if (record === undefined) {
      throw new Error('Identity observation was not stored')
    }
    return record
  }

  async putIdentityObservations(
    inputs: readonly IdentityObservationInput[],
    receivedAt = Date.now(),
  ): Promise<IdentityObservationRecord[]> {
    const transaction = this.database.transaction(
      'identityObservations',
      'readwrite',
    )
    const records: IdentityObservationRecord[] = []
    for (const input of inputs) {
      const recordWithoutKey: Omit<IdentityObservationRecord, 'key'> = {
        handle: normalizeHandle(input.handle),
        twitterId: input.twitterId,
        observedAt: input.observedAt,
        receivedAt: input.receivedAt ?? receivedAt,
        sourceOperation: input.sourceOperation,
        ...(input.postIds === undefined
          ? {}
          : { postIds: [...new Set(input.postIds)] }),
      }
      const record: IdentityObservationRecord = {
        ...recordWithoutKey,
        key: identityObservationKey(recordWithoutKey),
      }
      await transaction.store.put(record)
      records.push(record)
    }
    await transaction.done
    return records
  }

  async getIdentityObservations(
    handle: string,
    since = 0,
  ): Promise<IdentityObservationRecord[]> {
    const normalized = normalizeHandle(handle)
    return this.database.getAllFromIndex(
      'identityObservations',
      'byHandleObservedAt',
      IDBKeyRange.bound(
        [normalized, since],
        [normalized, Number.MAX_SAFE_INTEGER],
      ),
    )
  }

  async getIdentityObservationsForTwitterId(
    twitterId: string,
  ): Promise<IdentityObservationRecord[]> {
    return this.database.getAllFromIndex(
      'identityObservations',
      'twitterId',
      twitterId,
    )
  }

  async deleteIdentityObservationsReceivedBefore(
    cutoff: number,
  ): Promise<number> {
    const transaction = this.database.transaction(
      'identityObservations',
      'readwrite',
    )
    const keys = await transaction.store
      .index('receivedAt')
      .getAllKeys(IDBKeyRange.upperBound(cutoff, true))
    for (const key of keys) {
      await transaction.store.delete(key)
    }
    await transaction.done
    return keys.length
  }

  async putIdentityResolutionCache(
    resolution: IdentityResolutionCacheRecord,
  ): Promise<IdentityResolutionCacheRecord> {
    const record = cloneResolutionCacheRecord({
      ...resolution,
      handle: normalizeHandle(resolution.handle),
    } as IdentityResolutionCacheRecord)
    await this.database.put('identityResolutionCache', record)
    return record
  }

  async getIdentityResolutionCache(
    handle: string,
    activeAt?: number,
  ): Promise<IdentityResolutionCacheRecord | undefined> {
    const record = await this.database.get(
      'identityResolutionCache',
      normalizeHandle(handle),
    )
    if (
      record !== undefined &&
      activeAt !== undefined &&
      record.expiresAt <= activeAt
    ) {
      return undefined
    }
    return record
  }

  async deleteIdentityResolutionCache(handle: string): Promise<void> {
    await this.database.delete(
      'identityResolutionCache',
      normalizeHandle(handle),
    )
  }

  async deleteExpiredIdentityResolutionCache(
    expiredAt = Date.now(),
  ): Promise<number> {
    const transaction = this.database.transaction(
      'identityResolutionCache',
      'readwrite',
    )
    const keys = await transaction.store
      .index('expiresAt')
      .getAllKeys(IDBKeyRange.upperBound(expiredAt))
    for (const key of keys) {
      await transaction.store.delete(key)
    }
    await transaction.done
    return keys.length
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
      relays[relayUrl] ??= pendingRelayState()
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
    const normalizedOptions =
      typeof options === 'number' ? { now: options } : options
    const now = normalizedOptions.now ?? Date.now()
    const address = normalizedOptions.addressWinner?.address ??
      normalizedOptions.address
    const addressUpdatedAt =
      normalizedOptions.addressWinner?.updatedAt ??
      normalizedOptions.addressUpdatedAt ??
      now
    const transaction = this.database.transaction(
      ['events', 'tagIndex', 'outbox', 'addresses'],
      'readwrite',
    )
    const events = transaction.objectStore('events')
    const existingEvent = await events.get(event.id)
    await events.put(
      eventRecord(event, existingEvent?.firstSeenAt ?? now),
    )
    const tags = transaction.objectStore('tagIndex')
    for (const tag of indexedTags(event)) {
      await tags.put(tag)
    }

    const outbox = transaction.objectStore('outbox')
    const existingOutbox = await outbox.get(event.id)
    const relays = { ...existingOutbox?.relays }
    for (const relayUrl of relayUrls) {
      relays[relayUrl] ??= pendingRelayState()
    }
    await outbox.put({
      eventId: event.id,
      relays,
      createdAt: existingOutbox?.createdAt ?? now,
      updatedAt: now,
    })
    if (address !== undefined) {
      await transaction.objectStore('addresses').put({
        address,
        eventId: event.id,
        updatedAt: addressUpdatedAt,
      })
    }
    await transaction.done
  }

  async getOutbox(eventId: string): Promise<OutboxRecord | undefined> {
    return this.database.get('outbox', eventId)
  }

  async getDueOutbox(now = Date.now()): Promise<OutboxRecord[]> {
    const records = await this.database.getAll('outbox')
    const dueAt = (record: OutboxRecord): number => {
      const dueTimes = Object.values(record.relays)
        .filter(
          (relay) =>
            relay.status === 'pending' || relay.status === 'failed',
        )
        .map((relay) => relay.nextAttemptAt ?? record.createdAt)
        .filter((candidate) => candidate <= now)
      return dueTimes.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...dueTimes)
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
    const previous = record.relays[relayUrl] ?? pendingRelayState()
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

    const transaction = this.database.transaction(
      ['events', 'tagIndex'],
      'readwrite',
    )
    let imported = 0
    let duplicates = 0
    let rejected = 0
    for (const importedRecord of rawExport.events) {
      if (!(await isValidSupportedRawEvent(importedRecord))) {
        rejected += 1
        continue
      }
      const existing = await transaction.objectStore('events').get(
        importedRecord.id,
      )
      if (existing !== undefined) {
        duplicates += 1
        if (importedRecord.firstSeenAt < existing.firstSeenAt) {
          await transaction.objectStore('events').put({
            ...existing,
            firstSeenAt: importedRecord.firstSeenAt,
          })
        }
        continue
      }

      const record = eventRecord(importedRecord, importedRecord.firstSeenAt)
      await transaction.objectStore('events').put(record)
      for (const tag of indexedTags(record)) {
        await transaction.objectStore('tagIndex').put(tag)
      }
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
