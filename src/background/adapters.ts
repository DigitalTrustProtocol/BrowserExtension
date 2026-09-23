import { SimplePool, type Event, type Filter } from 'nostr-tools'
import {
  type OutboxEntry,
  type OutboxRepository,
  type RelayDeliveryState,
  type RelayEventRepository,
  type RelayPublishClient,
  type RelayQueryClient,
  type RelaySubscribeClient,
  type RelaySubscribeRequest,
  type RelaySubscription,
  type SyncCursor,
  type SyncCursorRepository,
} from '../relay'
import {
  AttentionXRepository,
  eventAddress,
  type EventRecord,
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
} from '../lib/nostr/kind-32009'
import {
  isNewerKind32014Replacement,
  parseKind32014Event,
  validateKind32014Event,
} from '../lib/nostr/kind-32014'
import {
  isEligibleXRatingScope,
  scopesFromEventTags,
} from '../shared/x-identity'

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
  implements
    RelayQueryClient,
    RelayPublishClient,
    RelayEventQuery,
    RelaySubscribeClient
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

  subscribe(request: RelaySubscribeRequest): RelaySubscription {
    let closed = false
    const subscription = this.#pool.subscribe(
      [request.relayUrl],
      request.filter,
      {
        abort: request.signal,
        onevent: (event) => {
          if (closed) return
          void request.onEvent(event)
        },
        oneose: () => {
          if (closed) return
          request.onEose?.()
        },
        onclose: (reasons) => {
          if (closed) return
          request.onClose?.(reasons.map((value) => value.reason).join('; '))
        },
      },
    )
    const close = (reason?: string) => {
      if (closed) return
      closed = true
      void subscription.close(reason ?? 'attentionx live subscribe closed')
    }
    request.signal?.addEventListener(
      'abort',
      () => close('attentionx subscribe aborted'),
      { once: true },
    )
    return { close }
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
  readonly #onStored?: (record: EventRecord) => void
  readonly #isPrunedSubject?: (subject: string) => boolean

  constructor(
    repository: AttentionXRepository,
    options?: {
      onStored?: (record: EventRecord) => void
      /**
       * True for subjects whose events were pruned for storage (skeleton
       * `xPosts` rows). Their events are dropped until the post is seen again,
       * so the daily full refresh does not refill what was pruned.
       */
      isPrunedSubject?: (subject: string) => boolean
    },
  ) {
    this.#repository = repository
    this.#onStored = options?.onStored
    this.#isPrunedSubject = options?.isPrunedSubject
  }

  #dropsPrunedSubject(subject: { type: string; value: string }): boolean {
    return subject.type === 'i' && this.#isPrunedSubject?.(subject.value) === true
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
          retry: cursor.retry,
        }
      : undefined
  }

  async setCursor(cursor: SyncCursor): Promise<void> {
    await this.#repository.putSyncCursor({
      relayUrl: cursor.relayUrl,
      scopeHash: cursor.scope,
      lastSeenCreatedAt: cursor.lastSeenCreatedAt,
      lastEoseAt: cursor.lastEoseAt,
      retry: cursor.retry ?? { attempts: 0 },
      updatedAt: cursor.lastEoseAt || Date.now(),
    })
  }

  async ingestEvent(event: Event): Promise<'stored' | 'duplicate' | 'rejected'> {
    if (event.kind === 32014) {
      const validation = await validateKind32014Event(event)
      if (!validation.valid) return 'rejected'
      if (!isEligibleXRatingScope(scopesFromEventTags(event.tags))) {
        return 'rejected'
      }
      if (this.#dropsPrunedSubject(validation.statement.subject)) {
        return 'duplicate'
      }
      if (await this.#repository.hasEvent(event.id)) return 'duplicate'

      const addressKey = eventAddress(
        event.kind,
        event.pubkey,
        validation.statement.d,
      )
      const current = await this.#repository.getEventByAddressKey(addressKey)
      if (current) {
        try {
          const replaces = isNewerKind32014Replacement(
            validation.statement,
            await parseKind32014Event(current),
          )
          if (!replaces) return 'duplicate'
        } catch {
          // Corrupt current winner — allow replacement.
        }
      }

      const stored = await this.#repository.ingestEvent({ event })
      this.#onStored?.(stored)
      return 'stored'
    }

    const validation = await validateKind32009Event(event)
    if (!validation.valid) return 'rejected'
    if (this.#dropsPrunedSubject(validation.statement.subject)) {
      return 'duplicate'
    }
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

    const stored = await this.#repository.ingestEvent({ event })
    this.#onStored?.(stored)
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

  async enqueue(entry: OutboxEntry): Promise<void> {
    await this.#repository.enqueueOutbox(
      entry.eventId,
      Object.keys(entry.relays),
      entry.updatedAt,
    )
  }

  async claim(
    eventId: string,
    relayUrl: string,
    now: number,
  ): Promise<RelayDeliveryState | undefined> {
    const claimed = await this.#repository.claimOutboxRelay(
      eventId,
      relayUrl,
      now,
    )
    return claimed ? deliveryState(claimed) : undefined
  }

  async complete(
    eventId: string,
    relayUrl: string,
    expectedAttempts: number,
    state: RelayDeliveryState,
  ): Promise<'applied' | 'missing' | 'stale'> {
    switch (state.status) {
      case 'delivered':
        return this.#repository.completeOutboxRelay(
          eventId,
          relayUrl,
          expectedAttempts,
          { ok: true, publishedAt: state.deliveredAt },
          state.lastAttemptAt,
        )
      case 'exhausted':
      case 'retrying':
        return this.#repository.completeOutboxRelay(
          eventId,
          relayUrl,
          expectedAttempts,
          {
            ok: false,
            exhausted: state.status === 'exhausted',
            error: state.lastError,
            nextAttemptAt: state.nextAttemptAt,
          },
          state.lastAttemptAt,
        )
      case 'pending':
        return 'stale'
      default: {
        const _exhaustive: never = state.status
        return _exhaustive
      }
    }
  }

  async listDue(now: number, limit: number): Promise<readonly OutboxEntry[]> {
    const due = (await this.#repository.getDueOutbox(now)).slice(0, limit)
    const entries = await Promise.all(due.map(({ eventId }) => this.get(eventId)))
    return entries.filter((entry): entry is OutboxEntry => Boolean(entry))
  }
}
