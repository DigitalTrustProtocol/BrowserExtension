import type { Event } from 'nostr-tools'
import { describe, expect, it, vi } from 'vitest'
import {
  DurableOutboxPublisher,
  type OutboxEntry,
  type OutboxRepository,
} from './outbox'
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

  async get(eventId: string): Promise<OutboxEntry | undefined> {
    const entry = this.entries.get(eventId)
    return entry ? clone(entry) : undefined
  }

  async put(entry: OutboxEntry): Promise<void> {
    const snapshot = clone(entry)
    this.entries.set(entry.eventId, snapshot)
    this.writes.push(snapshot)
  }

  async listDue(now: number, limit: number): Promise<readonly OutboxEntry[]> {
    return [...this.entries.values()]
      .filter((entry) =>
        Object.values(entry.relays).some(
          (state) =>
            (state.status === 'pending' ||
              state.status === 'retrying') &&
            state.nextAttemptAt <= now,
        ),
      )
      .slice(0, limit)
      .map(clone)
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
})
