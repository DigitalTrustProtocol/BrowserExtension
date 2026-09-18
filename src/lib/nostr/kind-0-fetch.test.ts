import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { describe, expect, it, vi } from 'vitest'
import { fetchKind0Batch, setKind0QueryEvents } from './kind-0-fetch'

describe('fetchKind0Batch', () => {
  it('reduces to the newest winner and coalesces concurrent requests', async () => {
    const aliceKey = generateSecretKey()
    const bobKey = generateSecretKey()
    const alice = getPublicKey(aliceKey)
    const bob = getPublicKey(bobKey)
    const old = finalizeEvent(
      {
        kind: 0,
        created_at: 10,
        tags: [],
        content: JSON.stringify({ name: 'Old', about: 'full' }),
      },
      aliceKey,
    )
    const newest = finalizeEvent(
      {
        kind: 0,
        created_at: 20,
        tags: [],
        content: JSON.stringify({ name: 'New', about: 'full' }),
      },
      aliceKey,
    )
    const bobEvent = finalizeEvent(
      {
        kind: 0,
        created_at: 15,
        tags: [],
        content: JSON.stringify({ name: 'Bob', about: 'full' }),
      },
      bobKey,
    )
    const query = vi.fn(async () => [old, newest, bobEvent])
    setKind0QueryEvents(query)
    const [first, second] = await Promise.all([
      fetchKind0Batch({
        pubkeys: [alice, bob],
        relayUrls: ['wss://relay.example'],
      }),
      fetchKind0Batch({
        pubkeys: [alice, bob],
        relayUrls: ['wss://relay.example'],
      }),
    ])
    expect(query).toHaveBeenCalledTimes(1)
    expect(first.get(alice)?.metadata).toEqual({ name: 'New', about: 'full' })
    expect(second.get(bob)?.metadata).toEqual({ name: 'Bob', about: 'full' })
    setKind0QueryEvents(async () => [])
  })
})
