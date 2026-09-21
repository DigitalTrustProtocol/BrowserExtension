import { fillEventRecordColumns } from '../lib/nostr/nip32009'
import {
  getEventHash,
  validateEvent,
  verifyEvent,
  type Event,
} from 'nostr-tools'
import { validateSignedKind10011Event } from '../lib/nostr/kind-10011'
import { validateKind32009Event } from '../lib/nostr/kind-32009'
import { validateKind32014Event } from '../lib/nostr/kind-32014'
import {
  isEligibleXRatingScope,
  scopesFromEventTags,
} from '../shared/x-identity'
import { isDemoWotEvent } from '../shared/demo-wot'
import { pickXVerifiedChrome } from '../shared/x-verified'
import {
  isOutboxClaimActive,
  OUTBOX_HOLD_MS,
} from '../relay/outbox-hold'
import {
  AttentionXDB,
  DEMO_EVENT_STATE,
  formatEventAddress,
  openAttentionXDatabase,
  type OpenStorageOptions,
} from './schema'
import {
  npubForIdentityRow,
  twitterIdFromWinningNpub,
} from '../shared/npub-lookup'
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
import { Collection } from 'dexie'

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
  const columns = fillEventRecordColumns(event)
  return {
    ...event,
    tags: event.tags.map((tag) => [...tag]),
    firstSeenAt,
    addressKey: options.addressKey ?? addressKeyForEvent(event, { state }),
    ...(state !== undefined ? { state } : {}),
    ...(columns ?? {}),
  }
}

/** Drop heap-only fields so Dexie never persists Graph runtime stamps. */
function persistableEventRecord(record: EventRecord): EventRecord {
  if (!('index' in record)) return record
  const { index: _index, ...rest } = record as EventRecord & { index?: number }
  return rest
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
  const columns = fillEventRecordColumns(record)
  return persistableEventRecord({
    ...record,
    tags: record.tags.map((tag) => [...tag]),
    addressKey,
    ...(state !== undefined ? { state } : {}),
    ...(columns ?? {}),
  })
}

async function isValidSupportedRawEvent(
  value: unknown,
): Promise<boolean> {
  if (!isEventRecord(value) || ![32009, 32014, 10011].includes(value.kind)) {
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
    const skipSignature =
      value.state === DEMO_EVENT_STATE || isDemoWotEvent(value)
    const validSignature =
      validateEvent(event) &&
      getEventHash(event) === event.id &&
      (skipSignature || verifyEvent(event))
    if (!validSignature) return false
    const verify = skipSignature ? false : undefined
    if (event.kind === 32009) {
      return (await validateKind32009Event(event, { verifyEvent: verify }))
        .valid
    }
    if (event.kind === 32014) {
      if (
        !(await validateKind32014Event(event, { verifyEvent: verify })).valid
      ) {
        return false
      }
      return isEligibleXRatingScope(scopesFromEventTags(event.tags))
    }
    return validateSignedKind10011Event(event).valid
  } catch {
    return false
  }
}

export class AttentionXRepository {
  private readonly db: AttentionXDB

  constructor(database: AttentionXDB) {
    this.db = database
  }

  static async open(
    options: OpenStorageOptions = {},
  ): Promise<AttentionXRepository> {
    return new AttentionXRepository(await openAttentionXDatabase(options))
  }

  close(): void {
    this.db.close()
  }

  async ingestEvent(input: EventIngestion): Promise<EventRecord> {
    const firstSeenAt = input.firstSeenAt ?? Date.now()
    const observedAt = input.observedAt ?? firstSeenAt
    const addressKey = addressKeyForEvent(input.event, { state: input.state })
    return this.db.transaction(
      'rw',
      this.db.events,
      this.db.relayObservations,
      this.db.outbox,
      async () => {
        const sameId = await this.db.events.get(input.event.id)
        const slotWinner = await this.db.events
          .where('addressKey')
          .equals(addressKey)
          .first()

        if (
          slotWinner !== undefined &&
          slotWinner.id !== input.event.id &&
          !isNewerSignedEvent(input.event, slotWinner)
        ) {
          if (input.relayUrl !== undefined) {
            const key = relayObservationKey(input.relayUrl, slotWinner.id)
            const previous = await this.db.relayObservations.get(key)
            await this.db.relayObservations.put({
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
          return slotWinner
        }

        if (slotWinner !== undefined && slotWinner.id !== input.event.id) {
          await this.db.events.delete(slotWinner.id)
          await this.db.outbox.delete(slotWinner.id)
          await this.db.relayObservations
            .where('eventId')
            .equals(slotWinner.id)
            .delete()
        }

        const record = eventRecord(
          input.event,
          sameId === undefined
            ? firstSeenAt
            : Math.min(firstSeenAt, sameId.firstSeenAt),
          { state: input.state, addressKey },
        )
        await this.db.events.put(persistableEventRecord(record))

        if (input.relayUrl !== undefined) {
          const key = relayObservationKey(input.relayUrl, input.event.id)
          const previous = await this.db.relayObservations.get(key)
          await this.db.relayObservations.put({
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

        return record
      },
    )
  }

  async getEvent(eventId: string): Promise<EventRecord | undefined> {
    return this.db.events.get(eventId)
  }

  async hasEvent(eventId: string): Promise<boolean> {
    return (await this.db.events.get(eventId)) !== undefined
  }

  async getAllEvents(): Promise<EventRecord[]> {
    return this.db.events.toArray()
  }

  async clearAllStores(): Promise<void> {
    await this.db.transaction('rw', this.db.tables, async () => {
      await Promise.all(this.db.tables.map((table) => table.clear()))
    })
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
        stores[name] = await this.db.table(name).count()
      }),
    )

    const events = await this.getAllEvents()
    const eventsByKind: Record<string, number> = {}
    for (const event of events) {
      const key = String(event.kind)
      eventsByKind[key] = (eventsByKind[key] ?? 0) + 1
    }

    const outbox = await this.db.outbox.toArray()
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
      databaseName: this.db.name,
      databaseVersion: this.db.verno,
      stores,
      eventsByKind,
      outboxByStatus,
    }
  }

  async getEventsByKind(
    kind: number,
    limit?: number,
  ): Promise<EventRecord[]> {
    const collection = this.db.events.where('kind').equals(kind)
    return limit === undefined
      ? collection.toArray()
      : collection.limit(limit).toArray()
  }

  async countEvents(): Promise<number> {
    return this.db.events.count()
  }

  async countEventsByState(state: string): Promise<number> {
    return this.db.events.where('state').equals(state).count()
  }

  async iterateEvents(
    visitor: (record: EventRecord) => void | Promise<void>,
  ): Promise<void> {
    await this.db.events.each((record) => visitor(record))
  }

  async iterateEventsByState(
    state: string,
    visitor: (record: EventRecord) => void | Promise<void>,
  ): Promise<void> {
    await this.db.events.where('state').equals(state).each((record) => visitor(record))
  }

  async iterateEventsByKinds(
    kinds: readonly number[],
    visitor: (record: EventRecord) => void | Promise<void>,
  ): Promise<void> {
    await this.db.events
      .where('kind')
      .anyOf([...kinds])
      .each((record) => visitor(record))
  }

  async getEventsByPubkey(
    pubkey: string,
    limit?: number,
  ): Promise<EventRecord[]> {
    const collection = this.db.events.where('pubkey').equals(pubkey)
    return limit === undefined
      ? collection.toArray()
      : collection.limit(limit).toArray()
  }

  async getEventsCreatedBetween(
    lower: number,
    upper: number,
    limit?: number,
  ): Promise<EventRecord[]> {
    const collection = this.db.events
      .where('created_at')
      .between(lower, upper, true, true)
    return limit === undefined
      ? collection.toArray()
      : collection.limit(limit).toArray()
  }

  async deleteEvent(eventId: string): Promise<boolean> {
    return this.db.transaction(
      'rw',
      this.db.events,
      this.db.relayObservations,
      this.db.outbox,
      async () => {
        const existed = (await this.db.events.get(eventId)) !== undefined
        if (!existed) return false
        await this.db.events.delete(eventId)
        await this.db.outbox.delete(eventId)
        await this.db.relayObservations.where('eventId').equals(eventId).delete()
        return true
      },
    )
  }

  async getEventByAddressKey(
    addressKey: string,
  ): Promise<EventRecord | undefined> {
    return this.db.events.where('addressKey').equals(addressKey).first()
  }

  async getEventIdByAddressKey(
    addressKey: string,
  ): Promise<string | undefined> {
    return (await this.getEventByAddressKey(addressKey))?.id
  }

  async getEventIdsByState(state: string): Promise<string[]> {
    const records = await this.db.events.where('state').equals(state).toArray()
    return records.map(({ id }) => id)
  }

  /**
   * Rewrite legacy demo rows so their addressKey uses the `:demo` suffix.
   * Safe to run repeatedly; does not touch production slots.
   */
  async ensureDemoAddressKeysNamespaced(): Promise<number> {
    return this.db.transaction('rw', this.db.events, async () => {
      const records = await this.db.events
        .where('state')
        .equals(DEMO_EVENT_STATE)
        .toArray()
      let fixed = 0
      for (const record of records) {
        const expected = addressKeyForEvent(record, { state: DEMO_EVENT_STATE })
        if (record.addressKey === expected) continue
        await this.db.events.put(
          persistableEventRecord({ ...record, addressKey: expected }),
        )
        fixed += 1
      }
      return fixed
    })
  }

  async getRelayObservation(
    relayUrl: string,
    eventId: string,
  ): Promise<RelayObservationRecord | undefined> {
    return this.db.relayObservations.get(relayObservationKey(relayUrl, eventId))
  }

  async getRelayObservations(
    relayUrl: string,
  ): Promise<RelayObservationRecord[]> {
    return this.db.relayObservations.where('relayUrl').equals(relayUrl).toArray()
  }

  async deleteRelayObservation(
    relayUrl: string,
    eventId: string,
  ): Promise<void> {
    await this.db.relayObservations.delete(
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
    await this.db.syncCursors.put(record)
    return record
  }

  async getSyncCursor(
    relayUrl: string,
    scopeHash: string,
  ): Promise<SyncCursorRecord | undefined> {
    return this.db.syncCursors.get(syncCursorKey(relayUrl, scopeHash))
  }

  async getSyncCursorsForRelay(
    relayUrl: string,
  ): Promise<SyncCursorRecord[]> {
    return this.db.syncCursors.where('relayUrl').equals(relayUrl).toArray()
  }

  async deleteSyncCursor(relayUrl: string, scopeHash: string): Promise<void> {
    await this.db.syncCursors.delete(syncCursorKey(relayUrl, scopeHash))
  }

  async putXIdentity(identity: XIdentityRecord): Promise<void> {
    const handle = identity.handle ? normalizeHandle(identity.handle) : ''
    const record: XIdentityRecord = {
      ...identity,
      handle,
      lastSeen: identity.lastSeen,
    }
    await this.db.transaction('rw', this.db.xIdentities, async () => {
      if (handle) {
        const owners = await this.db.xIdentities
          .where('handle')
          .equals(handle)
          .toArray()
        for (const owner of owners) {
          if (owner.twitterId === record.twitterId) continue
          await this.db.xIdentities.put({
            ...owner,
            handle: '',
            updatedAt: Math.max(owner.updatedAt, record.updatedAt),
          })
        }
      }
      await this.db.xIdentities.put(record)
    })
  }

  async getXIdentity(
    twitterId: string,
  ): Promise<XIdentityRecord | undefined> {
    return this.db.xIdentities.get(twitterId)
  }

  /** Keyed gets in one transaction. Does not scan the full store. */
  async getXIdentities(
    twitterIds: readonly string[],
  ): Promise<Map<string, XIdentityRecord>> {
    const unique = [...new Set(twitterIds.filter((id) => id.length > 0))]
    const result = new Map<string, XIdentityRecord>()
    if (unique.length === 0) return result
    await this.db.transaction('r', this.db.xIdentities, async () => {
      const rows = await Promise.all(
        unique.map((id) => this.db.xIdentities.get(id)),
      )
      for (const row of rows) {
        if (row) result.set(row.twitterId, row)
      }
    })
    return result
  }

  async getAllXIdentities(): Promise<XIdentityRecord[]> {
    return this.db.xIdentities.toArray()
  }

  async getVerifiedXIdentitiesCollection(): Promise<Collection<XIdentityRecord>> {
    return this.db.xIdentities.where('state').equals('verified')
  }

  async npubForTwitterId(twitterId: string): Promise<string | undefined> {
    const row = await this.getXIdentity(twitterId)
    return row ? npubForIdentityRow(row) : undefined
  }

  /** Winning binding only (bio/post/nip39/32009). Miss → undefined. */
  async twitterIdForNpub(npubOrHex: string): Promise<string | undefined> {
    return twitterIdFromWinningNpub(await this.getAllXIdentities(), npubOrHex)
  }

  /** Rows bound to this Nostr npub on the nip39 side (indexed). */
  async getXIdentitiesByNip39Npub(npub: string): Promise<XIdentityRecord[]> {
    const normalized = npub.trim().toLowerCase()
    return this.db.xIdentities.where('nip39Npub').equals(normalized).toArray()
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
    return this.db.transaction('rw', this.db.xIdentities, async () => {
      let cleared = 0
      const matching = await this.db.xIdentities
        .where('nip39Npub')
        .equals(normalized)
        .toArray()
      for (const identity of matching) {
        cleared += 1
        const next: XIdentityRecord = {
          twitterId: identity.twitterId,
          handle: identity.handle,
          ...(identity.displayName ? { displayName: identity.displayName } : {}),
          ...(identity.iconPath ? { iconPath: identity.iconPath } : {}),
          ...(identity.bannerPath ? { bannerPath: identity.bannerPath } : {}),
          ...pickXVerifiedChrome(identity),
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
        await this.db.xIdentities.put(next)
      }
      return cleared
    })
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
    if (
      !identity.xNpub &&
      identity.xDate === undefined &&
      identity.xObservedAt === undefined
    ) {
      return false
    }
    const next: XIdentityRecord = {
      ...identity,
      updatedAt: Math.max(identity.updatedAt, updatedAt),
    }
    delete next.xNpub
    delete next.xDate
    delete next.xObservedAt
    await this.db.xIdentities.put(next)
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
    await this.db.xIdentities.put(next)
    return true
  }

  /** Mark rows whose nip39 npub matches as revoked (keeps columns for audit). */
  async revokeXIdentityByNip39Npub(
    npub: string,
    updatedAt = Date.now(),
  ): Promise<number> {
    const normalized = npub.trim().toLowerCase()
    return this.db.transaction('rw', this.db.xIdentities, async () => {
      let revoked = 0
      const matching = await this.db.xIdentities
        .where('nip39Npub')
        .equals(normalized)
        .toArray()
      for (const identity of matching) {
        if (identity.state === 'revoked') continue
        revoked += 1
        await this.db.xIdentities.put({
          ...identity,
          state: 'revoked',
          updatedAt: Math.max(identity.updatedAt, updatedAt),
        })
      }
      return revoked
    })
  }

  async deleteXIdentity(twitterId: string): Promise<void> {
    await this.db.xIdentities.delete(twitterId)
  }

  async putXPost(post: XPostRecord): Promise<void> {
    const authorHandle = post.authorHandle
      ? normalizeHandle(post.authorHandle)
      : undefined
    const record: XPostRecord = {
      ...post,
      ...(authorHandle ? { authorHandle } : {}),
    }
    await this.db.xPosts.put(record)
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
    const existing = await this.db.xPosts.get(input.postId)
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
    await this.db.xPosts.put(record)
    return record
  }

  async getXPost(postId: string): Promise<XPostRecord | undefined> {
    return this.db.xPosts.get(postId)
  }

  async getAllXPosts(): Promise<XPostRecord[]> {
    return this.db.xPosts.toArray()
  }

  async getXPostsByAuthor(twitterId: string): Promise<XPostRecord[]> {
    return this.db.xPosts.where('authorTwitterId').equals(twitterId).toArray()
  }

  async deleteXPost(postId: string): Promise<void> {
    await this.db.xPosts.delete(postId)
  }

  /** Delete posts whose ids are not in `keepPostIds`. */
  async deleteXPostsNotIn(keepPostIds: ReadonlySet<string>): Promise<number> {
    const all = await this.getAllXPosts()
    const toDelete = all.filter((post) => !keepPostIds.has(post.postId))
    if (toDelete.length === 0) return 0
    await this.db.transaction('rw', this.db.xPosts, async () => {
      await Promise.all(
        toDelete.map((post) => this.db.xPosts.delete(post.postId)),
      )
    })
    return toDelete.length
  }

  async enqueueOutbox(
    eventId: string,
    relayUrls: readonly string[],
    now = Date.now(),
  ): Promise<OutboxRecord> {
    return this.db.transaction('rw', this.db.outbox, async () => {
      const existing = await this.db.outbox.get(eventId)
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
      await this.db.outbox.put(record)
      return record
    })
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
    await this.db.transaction('rw', this.db.events, this.db.outbox, async () => {
      const slotWinner = await this.db.events
        .where('addressKey')
        .equals(addressKey)
        .first()
      if (slotWinner !== undefined && slotWinner.id !== event.id) {
        if (!isNewerSignedEvent(event, slotWinner)) {
          throw new Error(
            'Cannot enqueue an event that loses its addressable slot',
          )
        }
        await this.db.events.delete(slotWinner.id)
        await this.db.outbox.delete(slotWinner.id)
      }

      const existingEvent = await this.db.events.get(event.id)
      await this.db.events.put(
        persistableEventRecord(
          eventRecord(event, existingEvent?.firstSeenAt ?? now, {
            state: normalizedOptions.state,
            addressKey,
          }),
        ),
      )

      const existingOutbox = await this.db.outbox.get(event.id)
      const relays = { ...existingOutbox?.relays }
      for (const relayUrl of relayUrls) {
        relays[relayUrl] ??= pendingRelayState(now)
      }
      await this.db.outbox.put({
        eventId: event.id,
        relays,
        createdAt: existingOutbox?.createdAt ?? now,
        updatedAt: now,
      })
    })
  }

  async getOutbox(eventId: string): Promise<OutboxRecord | undefined> {
    return this.db.outbox.get(eventId)
  }

  async listOutbox(): Promise<OutboxRecord[]> {
    return this.db.outbox.toArray()
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
    await this.db.outbox.put(updated)
    return updated
  }

  async getDueOutbox(now = Date.now()): Promise<OutboxRecord[]> {
    const records = await this.db.outbox.toArray()
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
    return this.db.transaction('rw', this.db.outbox, async () => {
      const record = await this.db.outbox.get(eventId)
      if (record === undefined) return undefined
      const previous = record.relays[relayUrl]
      if (
        previous === undefined ||
        previous.status === 'published' ||
        previous.status === 'exhausted'
      ) {
        return undefined
      }
      if (isOutboxClaimActive(previous.claimedAt, now)) return undefined
      const dueAt = previous.nextAttemptAt ?? record.createdAt
      const reclaimingStaleClaim =
        previous.claimedAt !== undefined &&
        !isOutboxClaimActive(previous.claimedAt, now)
      if (!reclaimingStaleClaim && dueAt > now) return undefined

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
      await this.db.outbox.put(updated)
      return next
    })
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
    return this.db.transaction('rw', this.db.outbox, async () => {
      const record = await this.db.outbox.get(eventId)
      if (record === undefined) return 'missing'
      const previous = record.relays[relayUrl]
      if (previous === undefined || previous.attempts !== expectedAttempts) {
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
      await this.db.outbox.put(updated)
      return 'applied'
    })
  }

  async recordOutboxAttempt(
    eventId: string,
    relayUrl: string,
    result: OutboxAttemptResult,
    attemptedAt = Date.now(),
  ): Promise<OutboxRecord> {
    return this.db.transaction('rw', this.db.outbox, async () => {
      const record = await this.db.outbox.get(eventId)
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
      await this.db.outbox.put(updated)
      return updated
    })
  }

  async deleteOutbox(eventId: string): Promise<void> {
    await this.db.outbox.delete(eventId)
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
    return this.db.transaction('rw', this.db.outbox, async () => {
      let pruned = 0
      const records = await this.db.outbox.toArray()
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
          await this.db.outbox.put({
            ...record,
            relays,
            updatedAt: now,
          })
        }
      }
      return pruned
    })
  }

  async exportRawEvents(exportedAt = Date.now()): Promise<RawEventExport> {
    return {
      format: 'attentionx-raw-events',
      version: RAW_EXPORT_VERSION,
      exportedAt,
      events: await this.db.events.toArray(),
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

    let imported = 0
    let duplicates = 0
    await this.db.transaction('rw', this.db.events, this.db.outbox, async () => {
      for (const importedRecord of accepted) {
        const normalized = normalizeImportedEventRecord(importedRecord)
        const existing = await this.db.events.get(normalized.id)
        if (existing !== undefined) {
          duplicates += 1
          if (normalized.firstSeenAt < existing.firstSeenAt) {
            await this.db.events.put(
              persistableEventRecord({
                ...existing,
                firstSeenAt: normalized.firstSeenAt,
              }),
            )
          }
          continue
        }

        const slotWinner = await this.db.events
          .where('addressKey')
          .equals(normalized.addressKey)
          .first()
        if (slotWinner !== undefined && slotWinner.id !== normalized.id) {
          if (!isNewerSignedEvent(normalized, slotWinner)) {
            rejected += 1
            continue
          }
          await this.db.events.delete(slotWinner.id)
          await this.db.outbox.delete(slotWinner.id)
        }

        await this.db.events.put(persistableEventRecord(normalized))
        imported += 1
      }
    })
    return { imported, duplicates, rejected }
  }

  async getRelayHealth(
    relayUrl: string,
  ): Promise<RelayHealthRecord | undefined> {
    return this.db.relayHealth.get(relayUrl)
  }

  async listRelayHealth(): Promise<RelayHealthRecord[]> {
    return this.db.relayHealth.toArray()
  }

  async listRelayErrorLog(limit = 100): Promise<RelayErrorLogRecord[]> {
    return this.db.relayErrorLog
      .orderBy('at')
      .reverse()
      .limit(Math.max(1, limit))
      .toArray()
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
    await this.db.relayHealth.put(record)
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
    const existing = await this.db.relayHealth.get(input.relayUrl)
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

    await this.db.transaction(
      'rw',
      this.db.relayHealth,
      this.db.relayErrorLog,
      async () => {
        await this.db.relayHealth.put(health)
        await this.db.relayErrorLog.put(log)
        const count = await this.db.relayErrorLog.count()
        if (count > MAX_RELAY_ERROR_LOG) {
          const overflow = count - MAX_RELAY_ERROR_LOG
          const oldest = await this.db.relayErrorLog
            .orderBy('at')
            .limit(overflow)
            .toArray()
          await this.db.relayErrorLog.bulkDelete(oldest.map((row) => row.id))
        }
      },
    )
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
    const existing = await this.db.relayHealth.get(input.relayUrl)
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
    await this.db.relayHealth.put(record)
    return record
  }
}
