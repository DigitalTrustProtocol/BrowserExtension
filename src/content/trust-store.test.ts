import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKGROUND_API_VERSION } from '../shared/contracts'
import { TrustStore } from './trust-store'
import type { TrustDescriptor } from './types'

function descriptorFor(value: string): TrustDescriptor {
  return { subject: { type: 'i', value } }
}

function resultFor(value: string) {
  return {
    subject: { type: 'i' as const, value },
    context: '',
    resolution: 'trusted' as const,
    trust: 1,
    distrust: 0,
    trustValue: 1,
    degree: 1,
    connected: true,
    statements: [],
    paths: [],
    truncated: false,
    computedAt: 0,
    sourceEventIds: [],
    graphVersion: 1,
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
    store.request('a', descriptorFor('user:id:1'))
    store.request('b', descriptorFor('user:id:2'))
    store.request('a', descriptorFor('user:id:1'))

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
    store.request('a', descriptorFor('user:id:1'))
    await store.flushNow()

    const seen: unknown[] = []
    store.subscribe('a', (result) => seen.push(result))
    store.request('a', descriptorFor('user:id:1'))
    await store.flushNow()

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(2)
  })

  it('refetches invalidated keys and notifies subscribers', async () => {
    const store = new TrustStore()
    const listener = vi.fn()
    store.subscribe('a', listener)
    store.request('a', descriptorFor('user:id:1'))
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
    store.request('a', descriptorFor('user:id:1'))
    await store.flushNow()

    expect(store.get('a')).toBeUndefined()
    expect(store.getError('a')).toBe('bad subject')
  })

  it('tracks loading while a batch is queued or in flight', async () => {
    let resolveBatch: (value: unknown) => void = () => {}
    sendMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBatch = resolve
        }),
    )
    const store = new TrustStore()
    store.request('a', descriptorFor('user:id:1'))

    expect(store.isLoading('a')).toBe(true)

    const flush = store.flushNow()
    expect(store.isLoading('a')).toBe(true)

    resolveBatch({
      ok: true,
      version: BACKGROUND_API_VERSION,
      data: {
        graphVersion: 3,
        results: { a: resultFor('a') },
      },
    })
    await flush

    expect(store.isLoading('a')).toBe(false)
    expect(store.get('a')).toBeDefined()
  })

  it('keeps isLoading true during a mutation even with a cached result', () => {
    const store = new TrustStore()
    const listener = vi.fn()
    store.seed([
      {
        key: 'a',
        descriptor: descriptorFor('user:id:1'),
        result: resultFor('a'),
      },
    ])
    store.subscribe('a', listener)
    listener.mockClear()

    expect(store.isLoading('a')).toBe(false)
    store.beginMutation('a')
    expect(store.isLoading('a')).toBe(true)
    expect(listener).toHaveBeenCalledWith(store.get('a'), undefined)

    store.endMutation('a')
    expect(store.isLoading('a')).toBe(false)
    expect(listener).toHaveBeenLastCalledWith(store.get('a'), undefined)
  })

  it('does not prune a cached result while a mutation is in flight', () => {
    const store = new TrustStore()
    store.seed([
      {
        key: 'a',
        descriptor: descriptorFor('user:id:1'),
        result: resultFor('a'),
      },
    ])
    store.beginMutation('a')
    store.prune()
    expect(store.get('a')).toBeDefined()
    store.endMutation('a')
    store.prune()
    expect(store.get('a')).toBeUndefined()
  })

  it('does not prune descriptors while a batch is in flight', async () => {
    let resolveBatch: (value: unknown) => void = () => {}
    sendMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBatch = resolve
        }),
    )
    const store = new TrustStore()
    store.request('a', descriptorFor('user:id:1'))

    const flush = store.flushNow()
    expect(store.isLoading('a')).toBe(true)

    store.prune()
    expect(store.isLoading('a')).toBe(true)

    resolveBatch({
      ok: true,
      version: BACKGROUND_API_VERSION,
      data: {
        graphVersion: 3,
        results: { a: resultFor('a') },
      },
    })
    await flush

    expect(store.get('a')).toBeDefined()
    store.prune()
    expect(store.get('a')).toBeUndefined()
  })

  it('seeds full results so request hits cache without a network round trip', async () => {
    const store = new TrustStore()
    const descriptor = descriptorFor('user:id:1')
    const result = resultFor('user:id:1')
    store.seed([{ key: 'a', descriptor, result }])

    expect(store.get('a')).toEqual(result)
    store.request('a', descriptor)
    await store.flushNow()

    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('invokes resolved hook on seed and cache-hit request', async () => {
    const { setTrustStoreResolvedHook } = await import('./trust-store')
    const store = new TrustStore()
    const hook = vi.fn()
    setTrustStoreResolvedHook(hook)
    try {
      const descriptor = descriptorFor('post:id:99')
      const result = resultFor('post:id:99')
      store.seed([{ key: 'k', descriptor, result }])
      expect(hook).toHaveBeenCalledWith(descriptor, result)
      hook.mockClear()
      store.request('k', descriptor)
      expect(hook).toHaveBeenCalledWith(descriptor, result)
    } finally {
      setTrustStoreResolvedHook(undefined)
    }
  })
})
