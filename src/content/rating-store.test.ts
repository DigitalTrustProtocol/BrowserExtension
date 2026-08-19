import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKGROUND_API_VERSION } from '../shared/contracts'
import { RatingStore } from './rating-store'
import type { TrustDescriptor } from './types'

function descriptorFor(value: string): TrustDescriptor {
  return { subject: { type: 'i', value } }
}

function resultFor(value: string) {
  return {
    subject: { type: 'i' as const, value },
    context: '',
    claims: [],
    averageScore: 80,
    claimCount: 1,
    degree: 1,
    sourceEventIds: [],
    computedAt: 0,
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

describe('RatingStore', () => {
  it('coalesces concurrent requests into one QUERY_RATING_BATCH', async () => {
    const store = new RatingStore()
    store.request('a', descriptorFor('post:id:1'))
    store.request('b', descriptorFor('post:id:2'))
    store.request('a', descriptorFor('post:id:1'))

    await store.flushNow()

    expect(sendMessage).toHaveBeenCalledTimes(1)
    const [request] = sendMessage.mock.calls[0] as [
      { type: string; items: { key: string }[] },
    ]
    expect(request.type).toBe('QUERY_RATING_BATCH')
    expect(request.items.map((item) => item.key)).toEqual(['a', 'b'])
    expect(store.graphVersion).toBe(7)
  })

  it('keeps isLoading true during a mutation even with a cached result', () => {
    const store = new RatingStore()
    store.seed([
      {
        key: 'a',
        descriptor: descriptorFor('post:id:1'),
        result: resultFor('a'),
      },
    ])

    expect(store.isLoading('a')).toBe(false)
    store.beginMutation('a')
    expect(store.isLoading('a')).toBe(true)
    store.endMutation('a')
    expect(store.isLoading('a')).toBe(false)
  })

  it('does not prune a cached result while a mutation is in flight', () => {
    const store = new RatingStore()
    store.seed([
      {
        key: 'a',
        descriptor: descriptorFor('post:id:1'),
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
})
