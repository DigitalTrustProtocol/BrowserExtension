import 'fake-indexeddb/auto'
import type { Event, Filter, SimplePool } from 'nostr-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AttentionXRepository,
  deleteAttentionXDatabase,
} from '../storage'
import {
  DurableIdentityRepository,
  RepositoryOutboxAdapter,
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
    await adapter.put(entry!)
    expect(
      (await repository.getOutbox(event.id))?.relays['wss://relay.example'],
    ).toMatchObject({ status: 'exhausted', attempts: 1 })
    repository.close()
  })

  it('persists observations and every resolution state in storage v3', async () => {
    const name = `attentionx-adapter-identity-${Date.now()}`
    databaseNames.push(name)
    const repository = await AttentionXRepository.open({ name })
    const adapter = new DurableIdentityRepository(repository)
    await adapter.saveObservations([{
      handle: 'nasa',
      twitterId: '11348282',
      observedAt: 100,
      sourceOperation: 'UserByScreenName',
      displayName: 'NASA',
      iconPath: 'profile_images/11348282/nasa',
    }])
    await adapter.saveResolution({
      state: 'pending',
      handle: 'pending',
      resolvedAt: 100,
      expiresAt: 200,
      retryAt: 200,
      reasons: ['relay-unavailable'],
    })
    await adapter.saveResolution({
      state: 'unresolved',
      handle: 'missing',
      resolvedAt: 100,
      expiresAt: 200,
      retryAt: 200,
    })
    await adapter.saveResolution({
      state: 'conflict',
      handle: 'conflict',
      resolvedAt: 100,
      expiresAt: 200,
      candidates: [{
        twitterId: '1',
        provenance: 'profile-jsonld',
        observedAt: 100,
      }, {
        twitterId: '2',
        provenance: 'verified-nip39',
        observedAt: 100,
        nostrPubkey: '4'.repeat(64),
      }],
    })
    await adapter.saveResolution({
      state: 'resolved',
      handle: 'profile',
      twitterId: '42',
      provenance: 'profile-jsonld',
      resolvedAt: 100,
      expiresAt: 200,
    })

    const reopened = new DurableIdentityRepository(repository)
    expect(await reopened.getObservations('nasa', 0)).toHaveLength(1)
    expect(await repository.getXIdentity('11348282')).toMatchObject({
      displayName: 'NASA',
      iconPath: 'profile_images/11348282/nasa',
    })
    await adapter.saveObservations([{
      handle: 'nasa',
      twitterId: '11348282',
      observedAt: 200,
      sourceOperation: 'UserByScreenName',
      displayName: 'NASA Official',
      iconPath: 'profile_images/11348282/nasa-new',
    }])
    expect(await repository.getXIdentity('11348282')).toMatchObject({
      displayName: 'NASA Official',
      iconPath: 'profile_images/11348282/nasa-new',
      updatedAt: 200,
    })
    expect(await reopened.getResolution('pending')).toMatchObject({
      state: 'pending',
      reasons: ['relay-unavailable'],
    })
    expect(await reopened.getResolution('missing')).toMatchObject({
      state: 'unresolved',
    })
    expect(await reopened.getResolution('conflict')).toMatchObject({
      state: 'conflict',
      candidates: [
        { twitterId: '1', provenance: 'profile-jsonld' },
        { twitterId: '2', provenance: 'verified-nip39' },
      ],
    })
    expect(await repository.getHandleAlias('profile')).toMatchObject({
      source: 'profile-jsonld',
    })
    repository.close()
  })
})
