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

export interface OutboxRepository {
  get(eventId: string): Promise<OutboxEntry | undefined>
  put(entry: OutboxEntry): Promise<void>
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
    entry.updatedAt = now
    await this.dependencies.repository.put(entry)
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
    const stored = await this.dependencies.repository.get(eventId)
    if (!stored) {
      throw new Error(`Outbox event not found: ${eventId}`)
    }

    const entry = copyEntry(stored)
    const attemptedThisRun: string[] = []
    for (const [relayUrl, state] of Object.entries(entry.relays)) {
      const now = this.clock.now()
      if (
        state.status === 'delivered' ||
        state.status === 'exhausted' ||
        state.nextAttemptAt > now
      ) {
        continue
      }

      attemptedThisRun.push(relayUrl)
      state.status = 'retrying'
      state.attempts += 1
      state.lastAttemptAt = now
      state.nextAttemptAt = now
      delete state.lastError
      entry.updatedAt = now
      await this.dependencies.repository.put(copyEntry(entry))

      try {
        await this.dependencies.client.publish(relayUrl, entry.event)
        const deliveredAt = this.clock.now()
        state.status = 'delivered'
        state.deliveredAt = deliveredAt
        state.nextAttemptAt = deliveredAt
        entry.updatedAt = deliveredAt
      } catch (error) {
        const failedAt = this.clock.now()
        state.lastError = errorMessage(error)
        if (state.attempts >= this.retryPolicy.maxAttempts) {
          state.status = 'exhausted'
          state.nextAttemptAt = failedAt
        } else {
          state.status = 'retrying'
          state.nextAttemptAt =
            failedAt +
            retryDelayMs(
              this.retryPolicy,
              state.attempts,
              this.random,
            )
        }
        entry.updatedAt = failedAt
      }

      await this.dependencies.repository.put(copyEntry(entry))
    }

    return this.aggregate(entry, attemptedThisRun)
  }

  async retryDue(limit = 100): Promise<OutboxPublishResult[]> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('Outbox retry limit must be a positive integer')
    }

    const entries = await this.dependencies.repository.listDue(
      this.clock.now(),
      limit,
    )
    const results: OutboxPublishResult[] = []
    for (const entry of entries) {
      results.push(await this.flush(entry.eventId))
    }
    return results
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
