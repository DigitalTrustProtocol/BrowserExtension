import type { Event } from 'nostr-tools'
import { describe, expect, it, vi } from 'vitest'
import {
  DurableOutboxPublisher,
  type OutboxCompleteResult,
  type OutboxEntry,
  type OutboxRepository,
  type RelayDeliveryState,
} from './outbox'
import { OUTBOX_CLAIM_TTL_MS } from './outbox-hold'
import type { Clock } from './types'

function signedEvent(): Event {
  return {
    id: '1'.repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: 100,
    kind: 32009,
    tags: [
      ['d', 'statement'],
      ['p', 'b'.repeat(64)],
      ['v', '1'],
    ],
    content: '',
    sig: '2'.repeat(128),
  }
}

function clone(entry: OutboxEntry): OutboxEntry {
  return {
    ...entry,
    event: { ...entry.event, tags: entry.event.tags.map((tag) => [...tag]) },
    relays: Object.fromEntries(
      Object.entries(entry.relays).map(([relayUrl, state]) => [
        relayUrl,
        { ...state },
      ]),
    ),
  }
}

class MemoryOutbox implements OutboxRepository {
  readonly entries = new Map<string, OutboxEntry>()
  readonly writes: OutboxEntry[] = []
  readonly claims = new Map<string, number>()

  async get(eventId: string): Promise<OutboxEntry | undefined> {
    const entry = this.entries.get(eventId)
    return entry ? clone(entry) : undefined
  }

  async enqueue(entry: OutboxEntry): Promise<void> {
    const existing = this.entries.get(entry.eventId)
    const relays = { ...existing?.relays }
    for (const [relayUrl, state] of Object.entries(entry.relays)) {
      relays[relayUrl] ??= { ...state }
    }
    const next: OutboxEntry = {
      eventId: entry.eventId,
      event: entry.event,
      createdAt: existing?.createdAt ?? entry.createdAt,
      updatedAt: entry.updatedAt,
      relays,
    }
    const snapshot = clone(next)
    this.entries.set(entry.eventId, snapshot)
    this.writes.push(snapshot)
  }

  async claim(
    eventId: string,
    relayUrl: string,
    now: number,
  ): Promise<RelayDeliveryState | undefined> {
    const entry = this.entries.get(eventId)
    if (!entry) return undefined
    const state = entry.relays[relayUrl]
    if (!state) return undefined
    if (state.status === 'delivered' || state.status === 'exhausted') {
      return undefined
    }
    const claimKey = `${eventId}\0${relayUrl}`
    const claimedAt = this.claims.get(claimKey)
    if (
      claimedAt !== undefined &&
      now - claimedAt < OUTBOX_CLAIM_TTL_MS
    ) {
      return undefined
    }
    if (state.nextAttemptAt > now && claimedAt === undefined) {
      return undefined
    }
    const reclaiming =
      claimedAt !== undefined && now - claimedAt >= OUTBOX_CLAIM_TTL_MS
    const next: RelayDeliveryState = reclaiming
      ? { ...state, lastAttemptAt: now }
      : {
          ...state,
          attempts: state.attempts + 1,
          lastAttemptAt: now,
          status: state.status === 'pending' ? 'pending' : 'retrying',
        }
    const updated = clone(entry)
    updated.relays[relayUrl] = next
    updated.updatedAt = now
    this.entries.set(eventId, updated)
    this.claims.set(claimKey, now)
    this.writes.push(clone(updated))
    return { ...next }
  }

  async complete(
    eventId: string,
    relayUrl: string,
    expectedAttempts: number,
    state: RelayDeliveryState,
  ): Promise<OutboxCompleteResult> {
    const entry = this.entries.get(eventId)
    if (!entry) return 'missing'
    const current = entry.relays[relayUrl]
    if (!current || current.attempts !== expectedAttempts) return 'stale'
    const updated = clone(entry)
    updated.relays[relayUrl] = { ...state }
    updated.updatedAt = state.lastAttemptAt ?? entry.updatedAt
    this.entries.set(eventId, updated)
    this.claims.delete(`${eventId}\0${relayUrl}`)
    this.writes.push(clone(updated))
    return 'applied'
  }

  async listDue(now: number, limit: number): Promise<readonly OutboxEntry[]> {
    return [...this.entries.values()]
      .filter((entry) =>
        Object.entries(entry.relays).some(([relayUrl, state]) => {
          const claimKey = `${entry.eventId}\0${relayUrl}`
          const claimedAt = this.claims.get(claimKey)
          if (
            claimedAt !== undefined &&
            now - claimedAt < OUTBOX_CLAIM_TTL_MS
          ) {
            return false
          }
          return (
            (state.status === 'pending' || state.status === 'retrying') &&
            state.nextAttemptAt <= now
          )
        }),
      )
      .slice(0, limit)
      .map(clone)
  }

  async delete(eventId: string): Promise<void> {
    this.entries.delete(eventId)
    for (const key of [...this.claims.keys()]) {
      if (key.startsWith(`${eventId}\0`)) this.claims.delete(key)
    }
  }
}

describe('DurableOutboxPublisher', () => {
  it('retains partial success and retries only the failed relay', async () => {
    let now = 1_000
    const clock: Clock = {
      now: () => now,
      sleep: async () => undefined,
    }
    const repository = new MemoryOutbox()
    const attempts = new Map<string, number>()
    const publish = vi.fn(async (relayUrl: string) => {
      const attempt = (attempts.get(relayUrl) ?? 0) + 1
      attempts.set(relayUrl, attempt)
      if (relayUrl === 'wss://two.example' && attempt === 1) {
        throw new Error('relay unavailable')
      }
    })
    const publisher = new DurableOutboxPublisher({
      repository,
      client: { publish },
      clock,
      random: () => 0.5,
      retryPolicy: {
        maxAttempts: 3,
        initialDelayMs: 100,
        maxDelayMs: 1_000,
        multiplier: 2,
        jitterRatio: 0,
      },
    })

    const first = await publisher.publish(signedEvent(), [
      'wss://one.example',
      'wss://two.example',
    ])

    expect(first).toMatchObject({
      status: 'partial',
      attemptedRelays: 2,
      deliveredRelays: 1,
      pendingRelays: 1,
      failedRelays: 0,
    })
    expect(first.relays['wss://one.example']).toMatchObject({
      status: 'delivered',
      attempts: 1,
    })
    expect(first.relays['wss://two.example']).toMatchObject({
      status: 'retrying',
      attempts: 1,
      nextAttemptAt: 1_100,
      lastError: 'relay unavailable',
    })

    const initialWrite = repository.writes[0]
    expect(initialWrite?.relays['wss://one.example']?.status).toBe(
      'pending',
    )
    expect(initialWrite?.relays['wss://two.example']?.status).toBe(
      'pending',
    )

    expect(await publisher.retryDue()).toEqual([])
    now = 1_100
    const retried = await publisher.retryDue()

    expect(retried).toHaveLength(1)
    expect(retried[0]).toMatchObject({
      status: 'complete',
      deliveredRelays: 2,
      pendingRelays: 0,
      attemptedThisRun: ['wss://two.example'],
    })
    expect(retried[0]?.relays['wss://one.example']?.attempts).toBe(1)
    expect(retried[0]?.relays['wss://two.example']?.attempts).toBe(2)
    expect(publish).toHaveBeenCalledTimes(3)
  })

  it('serializes concurrent flushes so a relay is published once', async () => {
    let now = 1_000
    const clock: Clock = {
      now: () => now,
      sleep: async () => undefined,
    }
    const repository = new MemoryOutbox()
    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    let releasePublish!: () => void
    const gate = new Promise<void>((resolve) => {
      releasePublish = resolve
    })
    const publish = vi.fn(async () => {
      resolveStarted()
      await gate
    })
    const publisher = new DurableOutboxPublisher({
      repository,
      client: { publish },
      clock,
    })
    const event = signedEvent()
    await publisher.enqueue(event, ['wss://one.example'])

    const first = publisher.flush(event.id)
    await started
    const second = publisher.flush(event.id)
    releasePublish()
    await Promise.all([first, second])

    expect(publish).toHaveBeenCalledTimes(1)
    expect(
      (await repository.get(event.id))?.relays['wss://one.example'],
    ).toMatchObject({
      status: 'delivered',
      attempts: 1,
    })
  })

  it('does not resurrect an outbox row deleted during publish', async () => {
    let now = 1_000
    const clock: Clock = {
      now: () => now,
      sleep: async () => undefined,
    }
    const repository = new MemoryOutbox()
    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    let releasePublish!: () => void
    const gate = new Promise<void>((resolve) => {
      releasePublish = resolve
    })
    const publish = vi.fn(async () => {
      resolveStarted()
      await gate
    })
    const publisher = new DurableOutboxPublisher({
      repository,
      client: { publish },
      clock,
    })
    const event = signedEvent()
    await publisher.enqueue(event, ['wss://one.example'])

    const flush = publisher.flush(event.id)
    await started
    await repository.delete(event.id)
    releasePublish()
    const result = await flush

    expect(result.attemptedThisRun).toEqual(['wss://one.example'])
    expect(await repository.get(event.id)).toBeUndefined()
    expect(repository.entries.size).toBe(0)
  })
})
