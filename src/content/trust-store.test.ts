import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKGROUND_API_VERSION } from '../shared/contracts'
import { TrustStore } from './trust-store'
import type { TrustDescriptor } from './types'

function descriptorFor(value: string): TrustDescriptor {
  return { subject: { type: 'i', value }, context: 'identity' }
}

function resultFor(value: string) {
  return {
    subject: { type: 'i', value },
    context: 'identity',
    resolution: 'trusted',
    statements: [],
    paths: [],
    truncated: false,
    computedAt: 0,
  }
}

let sendMessage: ReturnType<typeof vi.fn>

beforeEach(() => {
  sendMessage = vi.fn(async (request: { items: { key: string }[] }) => ({
    ok: true,
    version: BACKGROUND_API_VERSION,
    data: {
      graphVersion: 7,
      results: Object.fromEntries(
        request.items.map((item) => [item.key, resultFor(item.key)]),
      ),
    },
  }))
  vi.stubGlobal('chrome', { runtime: { sendMessage } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TrustStore', () => {
  it('coalesces concurrent requests into one batch', async () => {
    const store = new TrustStore()
    store.request('a', descriptorFor('ext:twitter_id:1'))
    store.request('b', descriptorFor('ext:twitter_id:2'))
    store.request('a', descriptorFor('ext:twitter_id:1'))

    await store.flushNow()

    expect(sendMessage).toHaveBeenCalledTimes(1)
    const [request] = sendMessage.mock.calls[0] as [
      { type: string; items: { key: string }[] },
    ]
    expect(request.type).toBe('QUERY_TRUST_BATCH')
    expect(request.items.map((item) => item.key)).toEqual(['a', 'b'])
    expect(store.graphVersion).toBe(7)
  })

  it('serves subscribers from cache without a second round trip', async () => {
    const store = new TrustStore()
    store.request('a', descriptorFor('ext:twitter_id:1'))
    await store.flushNow()

    const seen: unknown[] = []
    store.subscribe('a', (result) => seen.push(result))
    store.request('a', descriptorFor('ext:twitter_id:1'))
    await store.flushNow()

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(2)
  })

  it('refetches invalidated keys and notifies subscribers', async () => {
    const store = new TrustStore()
    const listener = vi.fn()
    store.subscribe('a', listener)
    store.request('a', descriptorFor('ext:twitter_id:1'))
    await store.flushNow()
    listener.mockClear()

    store.invalidate(['a'])
    expect(listener).toHaveBeenCalledWith(undefined, undefined)
    await store.flushNow()

    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(store.get('a')).toBeDefined()
  })

  it('reports per-key errors without throwing', async () => {
    sendMessage.mockImplementation(async () => ({
      ok: true,
      version: BACKGROUND_API_VERSION,
      data: { graphVersion: 1, results: {}, errors: { a: 'bad subject' } },
    }))
    const store = new TrustStore()
    store.request('a', descriptorFor('ext:twitter_id:1'))
    await store.flushNow()

    expect(store.get('a')).toBeUndefined()
    expect(store.getError('a')).toBe('bad subject')
  })
})
