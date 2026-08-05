import type { Event } from 'nostr-tools'
import {
  assertRetryPolicy,
  DEFAULT_RETRY_POLICY,
  retryDelayMs,
} from './retry'
import {
  systemClock,
  type Clock,
  type RetryPolicy,
} from './types'

export type RelayPublishStatus =
  | 'pending'
  | 'retrying'
  | 'delivered'
  | 'exhausted'

export interface RelayDeliveryState {
  status: RelayPublishStatus
  attempts: number
  nextAttemptAt: number
  lastAttemptAt?: number
  deliveredAt?: number
  lastError?: string
}

export interface OutboxEntry {
  eventId: string
  event: Event
  createdAt: number
  updatedAt: number
  relays: Record<string, RelayDeliveryState>
}

export type OutboxCompleteResult = 'applied' | 'missing' | 'stale'

export interface OutboxRepository {
  get(eventId: string): Promise<OutboxEntry | undefined>
  /**
   * Ensure pending relays exist for an event. Must not overwrite delivery
   * progress or recreate a row solely from a flush result.
   */
  enqueue(entry: OutboxEntry): Promise<void>
  /**
   * Atomically claim a due relay. Returns undefined when missing / not
   * claimable. `attempts` on the returned state is the claim generation.
   */
  claim(
    eventId: string,
    relayUrl: string,
    now: number,
  ): Promise<RelayDeliveryState | undefined>
  /**
   * Persist a claim outcome. Must no-op (not recreate) when the outbox row
   * was deleted or the attempt generation no longer matches.
   */
  complete(
    eventId: string,
    relayUrl: string,
    expectedAttempts: number,
    state: RelayDeliveryState,
  ): Promise<OutboxCompleteResult>
  listDue(now: number, limit: number): Promise<readonly OutboxEntry[]>
}

export interface RelayPublishClient {
  publish(relayUrl: string, event: Event): Promise<void>
}

export type OutboxAggregateStatus =
  | 'complete'
  | 'partial'
  | 'pending'
  | 'failed'

export interface OutboxPublishResult {
  eventId: string
  status: OutboxAggregateStatus
  attemptedRelays: number
  deliveredRelays: number
  pendingRelays: number
  failedRelays: number
  attemptedThisRun: string[]
  relays: Record<string, RelayDeliveryState>
}

export interface OutboxPublisherDependencies {
  repository: OutboxRepository
  client: RelayPublishClient
  retryPolicy?: RetryPolicy
  clock?: Clock
  random?: () => number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function copyRelayState(
  state: RelayDeliveryState,
): RelayDeliveryState {
  return { ...state }
}

function copyEntry(entry: OutboxEntry): OutboxEntry {
  return {
    ...entry,
    relays: Object.fromEntries(
      Object.entries(entry.relays).map(([relayUrl, state]) => [
        relayUrl,
        copyRelayState(state),
      ]),
    ),
  }
}

export class DurableOutboxPublisher {
  private readonly dependencies: OutboxPublisherDependencies
  private readonly retryPolicy: RetryPolicy
  private readonly clock: Clock
  private readonly random: () => number
  /** Serialize flush / retryDue so concurrent callers cannot interleave. */
  #flushTail: Promise<void> = Promise.resolve()

  constructor(dependencies: OutboxPublisherDependencies) {
    this.dependencies = dependencies
    this.retryPolicy =
      dependencies.retryPolicy ?? DEFAULT_RETRY_POLICY
    this.clock = dependencies.clock ?? systemClock
    this.random = dependencies.random ?? Math.random
    assertRetryPolicy(this.retryPolicy)
  }

  async enqueue(
    event: Event,
    relayUrls: readonly string[],
  ): Promise<OutboxEntry> {
    const now = this.clock.now()
    const existing = await this.dependencies.repository.get(event.id)
    const entry: OutboxEntry =
      existing === undefined
        ? {
            eventId: event.id,
            event,
            createdAt: now,
            updatedAt: now,
            relays: {},
          }
        : copyEntry(existing)

    for (const relayUrl of new Set(relayUrls.filter(Boolean))) {
      entry.relays[relayUrl] ??= {
        status: 'pending',
        attempts: 0,
        nextAttemptAt: now,
      }
    }
    entry.event = event
    entry.updatedAt = now
    await this.dependencies.repository.enqueue(entry)
    return copyEntry(entry)
  }

  async publish(
    event: Event,
    relayUrls: readonly string[],
  ): Promise<OutboxPublishResult> {
    await this.enqueue(event, relayUrls)
    return this.flush(event.id)
  }

  async flush(eventId: string): Promise<OutboxPublishResult> {
    return this.#runExclusive(() => this.#flushUnlocked(eventId))
  }

  async retryDue(limit = 100): Promise<OutboxPublishResult[]> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('Outbox retry limit must be a positive integer')
    }

    return this.#runExclusive(async () => {
      const entries = await this.dependencies.repository.listDue(
        this.clock.now(),
        limit,
      )
      const results: OutboxPublishResult[] = []
      for (const entry of entries) {
        results.push(await this.#flushUnlocked(entry.eventId))
      }
      return results
    })
  }

  async #runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#flushTail.then(operation, operation)
    this.#flushTail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async #flushUnlocked(eventId: string): Promise<OutboxPublishResult> {
    const stored = await this.dependencies.repository.get(eventId)
    if (!stored) {
      throw new Error(`Outbox event not found: ${eventId}`)
    }

    const attemptedThisRun: string[] = []
    for (const [relayUrl, state] of Object.entries(stored.relays)) {
      const now = this.clock.now()
      if (
        state.status === 'delivered' ||
        state.status === 'exhausted' ||
        state.nextAttemptAt > now
      ) {
        continue
      }

      const claimed = await this.dependencies.repository.claim(
        eventId,
        relayUrl,
        now,
      )
      if (!claimed) continue

      attemptedThisRun.push(relayUrl)
      try {
        await this.dependencies.client.publish(relayUrl, stored.event)
        const deliveredAt = this.clock.now()
        await this.dependencies.repository.complete(
          eventId,
          relayUrl,
          claimed.attempts,
          {
            status: 'delivered',
            attempts: claimed.attempts,
            nextAttemptAt: deliveredAt,
            lastAttemptAt: claimed.lastAttemptAt ?? now,
            deliveredAt,
          },
        )
      } catch (error) {
        const failedAt = this.clock.now()
        const exhausted =
          claimed.attempts >= this.retryPolicy.maxAttempts
        await this.dependencies.repository.complete(
          eventId,
          relayUrl,
          claimed.attempts,
          {
            status: exhausted ? 'exhausted' : 'retrying',
            attempts: claimed.attempts,
            lastAttemptAt: claimed.lastAttemptAt ?? now,
            lastError: errorMessage(error),
            nextAttemptAt: exhausted
              ? failedAt
              : failedAt +
                retryDelayMs(
                  this.retryPolicy,
                  claimed.attempts,
                  this.random,
                ),
          },
        )
      }
    }

    const latest = await this.dependencies.repository.get(eventId)
    if (!latest) {
      return {
        eventId,
        status: 'pending',
        attemptedRelays: 0,
        deliveredRelays: 0,
        pendingRelays: 0,
        failedRelays: 0,
        attemptedThisRun,
        relays: {},
      }
    }
    return this.aggregate(latest, attemptedThisRun)
  }

  private aggregate(
    entry: OutboxEntry,
    attemptedThisRun: string[],
  ): OutboxPublishResult {
    const relays = Object.fromEntries(
      Object.entries(entry.relays).map(([relayUrl, state]) => [
        relayUrl,
        copyRelayState(state),
      ]),
    )
    const states = Object.values(relays)
    const deliveredRelays = states.filter(
      ({ status }) => status === 'delivered',
    ).length
    const failedRelays = states.filter(
      ({ status }) => status === 'exhausted',
    ).length
    const pendingRelays =
      states.length - deliveredRelays - failedRelays

    let status: OutboxAggregateStatus
    if (states.length > 0 && deliveredRelays === states.length) {
      status = 'complete'
    } else if (deliveredRelays > 0) {
      status = 'partial'
    } else if (pendingRelays > 0 || states.length === 0) {
      status = 'pending'
    } else {
      status = 'failed'
    }

    return {
      eventId: entry.eventId,
      status,
      attemptedRelays: states.length,
      deliveredRelays,
      pendingRelays,
      failedRelays,
      attemptedThisRun,
      relays,
    }
  }
}
