import { SimplePool, type Event, type Filter } from 'nostr-tools'
import type {
  IdentityRepository,
  XIdentityResolution,
} from '../identity'
import { preserveXIdentityProofFields, mergeXIdentityProfileFromObservation } from '../identity/x-identity-row'
import {
  type OutboxEntry,
  type OutboxRepository,
  type RelayDeliveryState,
  type RelayEventRepository,
  type RelayPublishClient,
  type RelayQueryClient,
  type SyncCursor,
  type SyncCursorRepository,
} from '../relay'
import {
  AttentionXRepository,
  eventAddress,
  type HandleAliasSource,
  type IdentityResolutionCacheRecord,
  type OutboxRelayState,
} from '../storage'
import {
  isSocketLikeError,
  logRelayFailure,
  logRelaySuccess,
  relayUrlsFromError,
} from '../storage/relay-health-log'
import {
  isNewerKind32009Replacement,
  parseKind32009Event,
  validateKind32009Event,
} from '../shared/kind-32009'
import {
  sanitizeObservedXIdentity,
  type ObservedXIdentity,
} from '../shared/observed-x-identity'

const QUERY_TIMEOUT_MS = 5_000
const LIBRARY_EOSE_TIMEOUT_MS = QUERY_TIMEOUT_MS + 1_000
const DEFAULT_QUERY_EVENT_LIMIT = 1_000
const NORMAL_EOSE_REASON = 'attentionx received eose'
const TIMEOUT_REASON = 'attentionx query timeout'
const OVERFLOW_REASON = 'attentionx query overflow'

export interface RelayEventQuery {
  queryEvents(
    relayUrls: readonly string[],
    filter: Filter,
    signal?: AbortSignal,
  ): Promise<Event[]>
}

export class SimplePoolAdapter
  implements RelayQueryClient, RelayPublishClient, RelayEventQuery
{
  readonly #pool: SimplePool

  constructor(pool = new SimplePool({ enableReconnect: false })) {
    this.#pool = pool
  }

  async query(request: Parameters<RelayQueryClient['query']>[0]): Promise<void> {
    const events = await this.queryEvents(
      [request.relayUrl],
      request.filter,
      request.signal,
    )
    for (const event of events) {
      if (request.signal?.aborted) throw abortError()
      await request.onEvent(event)
    }
  }

  async queryEvents(
    relayUrls: readonly string[],
    filter: Filter,
    signal?: AbortSignal,
  ): Promise<Event[]> {
    if (signal?.aborted) throw abortError()
    const eventLimit =
      Number.isSafeInteger(filter.limit) && (filter.limit ?? 0) > 0
        ? filter.limit!
        : DEFAULT_QUERY_EVENT_LIMIT
    const boundedFilter = { ...filter, limit: eventLimit }

    try {
      const events = await new Promise<Event[]>((resolve, reject) => {
        const collected: Event[] = []
        let settled = false
        let subscription: ReturnType<SimplePool['subscribe']> | undefined
        const timer = setTimeout(() => {
          finish(() => reject(new Error('Relay query timed out before EOSE')))
          void subscription?.close(TIMEOUT_REASON)
        }, QUERY_TIMEOUT_MS)
        const finish = (callback: () => void) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          callback()
        }
        const onAbort = () => {
          finish(() => reject(abortError()))
          void subscription?.close('attentionx query aborted')
        }
        signal?.addEventListener('abort', onAbort, { once: true })

        subscription = this.#pool.subscribe([...relayUrls], boundedFilter, {
          maxWait: LIBRARY_EOSE_TIMEOUT_MS,
          abort: signal,
          onevent: (event) => {
            if (settled) return
            if (collected.length >= eventLimit) {
              finish(() =>
                reject(new Error(`Relay query exceeded limit ${eventLimit}`)),
              )
              void subscription?.close(OVERFLOW_REASON)
              return
            }
            collected.push(event)
          },
          oneose: () => {
            finish(() => resolve(collected))
            void subscription?.close(NORMAL_EOSE_REASON)
          },
          onclose: (reasons) => {
            finish(() => {
              const reason = reasons.map((value) => value.reason).join('; ')
              reject(new Error(`Relay query closed before EOSE: ${reason}`))
            })
          },
        })
      })
      for (const url of relayUrls) {
        void logRelaySuccess(url)
      }
      return events
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        const message =
          error instanceof Error ? error.message : 'Relay query failed'
        for (const url of relayUrlsFromError(error, relayUrls)) {
          void logRelayFailure({
            relayUrl: url,
            kind: isSocketLikeError(error) ? 'websocket' : 'query',
            message,
          })
        }
      }
      throw error
    }
  }

  async publish(relayUrl: string, event: Event): Promise<void> {
    try {
      const [result] = this.#pool.publish([relayUrl], event, {
        maxWait: 3_500,
      })
      await result
      void logRelaySuccess(relayUrl)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Relay publish failed'
      void logRelayFailure({
        relayUrl,
        kind: isSocketLikeError(error) ? 'websocket' : 'publish',
        message,
      })
      throw error
    }
  }
}

function abortError(): DOMException {
  return new DOMException('Operation aborted', 'AbortError')
}

export class RepositorySyncAdapter
  implements SyncCursorRepository, RelayEventRepository
{
  readonly #repository: AttentionXRepository

  constructor(repository: AttentionXRepository) {
    this.#repository = repository
  }

  async getCursor(
    relayUrl: string,
    scope: string,
  ): Promise<SyncCursor | undefined> {
    const cursor = await this.#repository.getSyncCursor(relayUrl, scope)
    return cursor
      ? {
          relayUrl,
          scope,
          lastSeenCreatedAt: cursor.lastSeenCreatedAt,
          lastEoseAt: cursor.lastEoseAt ?? 0,
        }
      : undefined
  }

  async setCursor(cursor: SyncCursor): Promise<void> {
    await this.#repository.putSyncCursor({
      relayUrl: cursor.relayUrl,
      scopeHash: cursor.scope,
      lastSeenCreatedAt: cursor.lastSeenCreatedAt,
      lastEoseAt: cursor.lastEoseAt,
      retry: { attempts: 0 },
      updatedAt: cursor.lastEoseAt,
    })
  }

  async ingestEvent(event: Event): Promise<'stored' | 'duplicate' | 'rejected'> {
    const validation = await validateKind32009Event(event)
    if (!validation.valid) return 'rejected'
    if (await this.#repository.hasEvent(event.id)) return 'duplicate'

    const addressKey = eventAddress(
      event.kind,
      event.pubkey,
      validation.statement.d,
    )
    const current = await this.#repository.getEventByAddressKey(addressKey)
    if (current) {
      try {
        const replaces = isNewerKind32009Replacement(
          validation.statement,
          await parseKind32009Event(current),
        )
        if (!replaces) {
          // Older-than-winner: repository would discard; treat as duplicate for sync stats.
          return 'duplicate'
        }
      } catch {
        // Corrupt current winner — allow replacement.
      }
    }

    await this.#repository.ingestEvent({ event })
    return 'stored'
  }

  async listEventsByAuthor(
    author: string,
    kind: number,
  ): Promise<readonly Event[]> {
    return (await this.#repository.getEventsByPubkey(author)).filter(
      (event) => event.kind === kind,
    )
  }
}

function deliveryState(state: OutboxRelayState): RelayDeliveryState {
  if (state.status === 'published') {
    return {
      status: 'delivered',
      attempts: state.attempts,
      nextAttemptAt: state.publishedAt ?? state.lastAttemptAt ?? 0,
      lastAttemptAt: state.lastAttemptAt,
      deliveredAt: state.publishedAt,
    }
  }
  return {
    status:
      state.status === 'pending'
        ? 'pending'
        : state.status === 'exhausted'
          ? 'exhausted'
          : 'retrying',
    attempts: state.attempts,
    nextAttemptAt: state.nextAttemptAt ?? 0,
    lastAttemptAt: state.lastAttemptAt,
    lastError: state.lastError,
  }
}

export class RepositoryOutboxAdapter implements OutboxRepository {
  readonly #repository: AttentionXRepository

  constructor(repository: AttentionXRepository) {
    this.#repository = repository
  }

  async get(eventId: string): Promise<OutboxEntry | undefined> {
    const [record, event] = await Promise.all([
      this.#repository.getOutbox(eventId),
      this.#repository.getEvent(eventId),
    ])
    if (!record || !event) return undefined
    return {
      eventId,
      event,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      relays: Object.fromEntries(
        Object.entries(record.relays).map(([relayUrl, state]) => [
          relayUrl,
          deliveryState(state),
        ]),
      ),
    }
  }

  async put(entry: OutboxEntry): Promise<void> {
    const current = await this.#repository.enqueueOutbox(
      entry.eventId,
      Object.keys(entry.relays),
      entry.updatedAt,
    )

    for (const [relayUrl, state] of Object.entries(entry.relays)) {
      const stored = current.relays[relayUrl]
      if (!stored || state.attempts <= stored.attempts) continue

      if (state.status === 'delivered') {
        await this.#repository.recordOutboxAttempt(
          entry.eventId,
          relayUrl,
          { ok: true, publishedAt: state.deliveredAt },
          state.lastAttemptAt,
        )
      } else if (state.lastError) {
        await this.#repository.recordOutboxAttempt(
          entry.eventId,
          relayUrl,
          {
            ok: false,
            exhausted: state.status === 'exhausted',
            error: state.lastError,
            nextAttemptAt: state.nextAttemptAt,
          },
          state.lastAttemptAt,
        )
      }
    }
  }

  async listDue(now: number, limit: number): Promise<readonly OutboxEntry[]> {
    const due = (await this.#repository.getDueOutbox(now)).slice(0, limit)
    const entries = await Promise.all(due.map(({ eventId }) => this.get(eventId)))
    return entries.filter((entry): entry is OutboxEntry => Boolean(entry))
  }
}

function aliasSource(resolution: XIdentityResolution): HandleAliasSource {
  if (resolution.state !== 'resolved') return 'import'
  if (resolution.provenance === 'verified-nip39') return 'nip39'
  if (resolution.provenance === 'observation') return 'page-response'
  return 'profile-jsonld'
}

function resolutionProvenance(
  source: HandleAliasSource,
): Extract<XIdentityResolution, { state: 'resolved' }>['provenance'] {
  if (source === 'nip39') return 'verified-nip39'
  if (source === 'dom' || source === 'page-response') return 'observation'
  return 'profile-jsonld'
}

function fromResolutionCache(
  record: IdentityResolutionCacheRecord,
): XIdentityResolution {
  if (record.state === 'resolved') {
    return {
      state: 'resolved',
      handle: record.handle,
      twitterId: record.twitterId,
      provenance: resolutionProvenance(record.source),
      resolvedAt: record.resolvedAt,
      expiresAt: record.expiresAt,
      ...(record.nostrPubkeys
        ? { nostrPubkeys: [...record.nostrPubkeys] }
        : {}),
    }
  }
  if (record.state === 'pending') {
    return { ...record, reasons: [...record.reasons] }
  }
  if (record.state === 'conflict') {
    return {
      ...record,
      candidates: record.candidates.map((candidate) => ({
        twitterId: candidate.twitterId,
        provenance: resolutionProvenance(candidate.source),
        observedAt: candidate.observedAt,
        ...(candidate.nostrPubkey
          ? { nostrPubkey: candidate.nostrPubkey }
          : {}),
      })),
    }
  }
  return { ...record }
}

function toResolutionCache(
  resolution: XIdentityResolution,
): IdentityResolutionCacheRecord {
  if (resolution.state === 'resolved') {
    return {
      state: 'resolved',
      handle: resolution.handle,
      twitterId: resolution.twitterId,
      source: aliasSource(resolution),
      resolvedAt: resolution.resolvedAt,
      expiresAt: resolution.expiresAt,
      ...(resolution.nostrPubkeys
        ? { nostrPubkeys: [...resolution.nostrPubkeys] }
        : {}),
    }
  }
  if (resolution.state === 'conflict') {
    return {
      state: 'conflict',
      handle: resolution.handle,
      resolvedAt: resolution.resolvedAt,
      expiresAt: resolution.expiresAt,
      candidates: resolution.candidates.map((candidate) => ({
        twitterId: candidate.twitterId,
        source:
          candidate.provenance === 'verified-nip39'
            ? 'nip39'
            : candidate.provenance === 'observation'
              ? 'page-response'
              : 'profile-jsonld',
        observedAt: candidate.observedAt,
        ...(candidate.nostrPubkey
          ? { nostrPubkey: candidate.nostrPubkey }
          : {}),
      })),
    }
  }
  return {
    ...resolution,
    ...(resolution.state === 'pending'
      ? { reasons: [...resolution.reasons] }
      : {}),
  }
}

export class DurableIdentityRepository implements IdentityRepository {
  readonly #repository: AttentionXRepository

  constructor(repository: AttentionXRepository) {
    this.#repository = repository
  }

  async getResolution(
    handle: string,
  ): Promise<XIdentityResolution | undefined> {
    const cached = await this.#repository.getIdentityResolutionCache(handle)
    return cached ? fromResolutionCache(cached) : undefined
  }

  async saveResolution(resolution: XIdentityResolution): Promise<void> {
    await this.#repository.putIdentityResolutionCache(
      toResolutionCache(resolution),
    )
    if (resolution.state !== 'resolved') return

    const existing = await this.#repository.getXIdentity(resolution.twitterId)
    const handles = [
      ...new Set([...(existing?.handles ?? []), resolution.handle]),
    ]
    await this.#repository.putXIdentity({
      twitterId: resolution.twitterId,
      handles,
      ...preserveXIdentityProofFields(existing),
      createdAt: existing?.createdAt ?? resolution.resolvedAt,
      updatedAt: resolution.resolvedAt,
    })
    await this.#repository.putHandleAlias({
      handle: resolution.handle,
      twitterId: resolution.twitterId,
      source: aliasSource(resolution),
      observedAt: resolution.resolvedAt,
      expiresAt: resolution.expiresAt,
    })
  }

  async getObservations(
    handle: string,
    since: number,
  ): Promise<ObservedXIdentity[]> {
    return (await this.#repository.getIdentityObservations(handle, since)).map(
      (observation) => ({
        handle: observation.handle,
        twitterId: observation.twitterId,
        observedAt: observation.observedAt,
        sourceOperation: observation.sourceOperation,
        ...(observation.postIds
          ? { postIds: [...observation.postIds] }
          : {}),
      }),
    )
  }

  async saveObservations(
    observations: readonly ObservedXIdentity[],
  ): Promise<void> {
    const sanitized = observations
      .map(sanitizeObservedXIdentity)
      .filter((value): value is ObservedXIdentity => Boolean(value))
    await this.#repository.putIdentityObservations(
      sanitized.map((observation) => ({
        ...observation,
        receivedAt: observation.observedAt,
      })),
    )
    for (const observation of sanitized) {
      const existing = await this.#repository.getXIdentity(observation.twitterId)
      const { profileChanged, ...profileFields } =
        mergeXIdentityProfileFromObservation(existing, observation)
      const observedAt = Math.max(
        existing?.updatedAt ?? 0,
        observation.observedAt,
      )
      await this.#repository.putXIdentity({
        twitterId: observation.twitterId,
        handles: [
          ...new Set([...(existing?.handles ?? []), observation.handle]),
        ],
        ...preserveXIdentityProofFields(existing),
        ...profileFields,
        createdAt: existing?.createdAt ?? observation.observedAt,
        updatedAt: profileChanged
          ? observedAt
          : Math.max(existing?.updatedAt ?? 0, observation.observedAt),
      })
      await this.#repository.putHandleAlias({
        handle: observation.handle,
        twitterId: observation.twitterId,
        source: 'page-response',
        observedAt: observation.observedAt,
        expiresAt: observation.observedAt + 24 * 60 * 60 * 1_000,
      })
    }
  }
}
