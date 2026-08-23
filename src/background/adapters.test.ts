import 'fake-indexeddb/auto'
import {
  finalizeEvent,
  generateSecretKey,
  type Event,
  type Filter,
  type SimplePool,
} from 'nostr-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AttentionXRepository,
  deleteAttentionXDatabase,
} from '../storage'
import { buildKind32009Event } from '../shared/kind-32009'
import { buildKind32014Event } from '../shared/kind-32014'
import {
  RepositoryOutboxAdapter,
  RepositorySyncAdapter,
  SimplePoolAdapter,
} from './adapters'

const event: Event = {
  id: '1'.repeat(64),
  pubkey: '2'.repeat(64),
  created_at: 1,
  kind: 10011,
  tags: [],
  content: '',
  sig: '3'.repeat(128),
}

interface SubscriptionCallbacks {
  maxWait: number
  onevent: (value: Event) => void
  oneose: () => void
  onclose: (reasons: Array<{ url: string; reason: string }>) => void
}

class FakePool {
  filter?: Filter
  callbacks?: SubscriptionCallbacks
  readonly close = vi.fn()

  subscribe(
    _relays: string[],
    filter: Filter,
    callbacks: SubscriptionCallbacks,
  ) {
    this.filter = filter
    this.callbacks = callbacks
    return { close: this.close }
  }
}

const databaseNames: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  for (const name of databaseNames.splice(0)) {
    await deleteAttentionXDatabase(name)
  }
})

describe('SimplePoolAdapter', () => {
  it('resolves only on actual EOSE and passes a bounded filter', async () => {
    const pool = new FakePool()
    const adapter = new SimplePoolAdapter(pool as unknown as SimplePool)
    const query = adapter.queryEvents(
      ['wss://relay.example'],
      { kinds: [10011], limit: 1 },
    )
    pool.callbacks?.onevent(event)
    pool.callbacks?.oneose()

    await expect(query).resolves.toEqual([event])
    expect(pool.filter?.limit).toBe(1)
    expect(pool.callbacks?.maxWait).toBeGreaterThan(5_000)
  })

  it('rejects its explicit timeout before the library EOSE timeout', async () => {
    vi.useFakeTimers()
    const pool = new FakePool()
    const adapter = new SimplePoolAdapter(pool as unknown as SimplePool)
    const query = adapter.queryEvents(
      ['wss://relay.example'],
      { kinds: [10011], limit: 1 },
    )
    const rejection = expect(query).rejects.toThrow('timed out before EOSE')

    await vi.advanceTimersByTimeAsync(5_000)
    await rejection
    expect(pool.close).toHaveBeenCalledWith('attentionx query timeout')
  })

  it('rejects overflow instead of treating it as a complete query', async () => {
    const pool = new FakePool()
    const adapter = new SimplePoolAdapter(pool as unknown as SimplePool)
    const query = adapter.queryEvents(
      ['wss://relay.example'],
      { kinds: [10011], limit: 1 },
    )
    pool.callbacks?.onevent(event)
    pool.callbacks?.onevent({ ...event, id: '4'.repeat(64) })
    pool.callbacks?.oneose()

    await expect(query).rejects.toThrow('exceeded limit 1')
    expect(pool.close).toHaveBeenCalledWith('attentionx query overflow')
  })
})

describe('repository adapters', () => {
  it('keeps explicit exhausted outbox delivery terminal', async () => {
    const name = `attentionx-adapter-outbox-${Date.now()}`
    databaseNames.push(name)
    const repository = await AttentionXRepository.open({ name })
    await repository.storeEventAndEnqueue(
      event,
      ['wss://relay.example'],
      1,
    )
    await repository.recordOutboxAttempt(
      event.id,
      'wss://relay.example',
      { ok: false, exhausted: true, error: 'terminal' },
      2,
    )
    const adapter = new RepositoryOutboxAdapter(repository)
    const entry = await adapter.get(event.id)

    expect(entry?.relays['wss://relay.example']).toMatchObject({
      status: 'exhausted',
      attempts: 1,
    })
    await adapter.enqueue(entry!)
    expect(
      (await repository.getOutbox(event.id))?.relays['wss://relay.example'],
    ).toMatchObject({ status: 'exhausted', attempts: 1 })
    repository.close()
  })

  it('does not recreate outbox rows on complete after delete', async () => {
    const name = `attentionx-adapter-outbox-delete-${Date.now()}`
    databaseNames.push(name)
    const repository = await AttentionXRepository.open({ name })
    await repository.storeEventAndEnqueue(
      event,
      ['wss://relay.example'],
      1,
    )
    await repository.clearOutboxHold(event.id, 1)
    const adapter = new RepositoryOutboxAdapter(repository)
    const claimed = await adapter.claim(event.id, 'wss://relay.example', 1)
    expect(claimed?.attempts).toBe(1)

    await repository.deleteOutbox(event.id)
    const result = await adapter.complete(event.id, 'wss://relay.example', 1, {
      status: 'delivered',
      attempts: 1,
      nextAttemptAt: 2,
      lastAttemptAt: 1,
      deliveredAt: 2,
    })
    expect(result).toBe('missing')
    expect(await repository.getOutbox(event.id)).toBeUndefined()
    repository.close()
  })
})

describe('RepositorySyncAdapter ingest scopes', () => {
  it('stores empty-scope 32009 and rejects empty-scope 32014', async () => {
    const name = `attentionx-adapter-scope-${Date.now()}`
    databaseNames.push(name)
    const repository = await AttentionXRepository.open({ name })
    const adapter = new RepositorySyncAdapter(repository)
    const secretKey = generateSecretKey()
    const emptyTrust = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:7' },
        value: '1',
        scopes: [],
        createdAt: 1_700_000_000,
      }),
      secretKey,
    )
    const emptyRating = finalizeEvent(
      await buildKind32014Event({
        subject: { type: 'i', value: 'post:id:9' },
        score: '50',
        scopes: [],
        createdAt: 1_700_000_000,
      }),
      secretKey,
    )
    const xRating = finalizeEvent(
      await buildKind32014Event({
        subject: { type: 'i', value: 'post:id:9' },
        score: '50',
        scopes: ['x.com'],
        createdAt: 1_700_000_001,
      }),
      secretKey,
    )

    await expect(adapter.ingestEvent(emptyTrust)).resolves.toBe('stored')
    await expect(adapter.ingestEvent(emptyRating)).resolves.toBe('rejected')
    await expect(adapter.ingestEvent(xRating)).resolves.toBe('stored')
    expect(await repository.getEvent(emptyTrust.id)).toBeDefined()
    expect(await repository.getEvent(emptyRating.id)).toBeUndefined()
    expect(await repository.getEvent(xRating.id)).toBeDefined()
    repository.close()
  })
})
