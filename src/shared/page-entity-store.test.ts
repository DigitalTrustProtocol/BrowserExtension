import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKGROUND_API_VERSION } from './contracts'
import {
  getPageEntityStore,
  resetPageEntityStoreForTests,
} from './page-entity-store'

const sendMessage = vi.fn(async (request: { type: string; twitterId?: string }) => {
  if (request.type === 'GET_X_IDENTITY') {
    return {
      ok: true,
      version: BACKGROUND_API_VERSION,
      data: { identity: { twitterId: request.twitterId, handle: 'nasa' } },
    }
  }
  if (request.type === 'GET_SELECTED_SUBJECT') {
    return {
      ok: true,
      version: BACKGROUND_API_VERSION,
      data: {
        selected: {
          subject: { type: 'i', value: `user:id:${request.twitterId ?? '1'}` },
        },
        canBack: false,
        canForward: false,
      },
    }
  }
  if (request.type === 'QUERY_TRUST' || request.type === 'QUERY_OUTGOING_TRUST') {
    return {
      ok: true,
      version: BACKGROUND_API_VERSION,
      data: {
        subject: { type: 'i', value: 'user:id:1' },
        statements: [],
        truncated: false,
        resolution: 'none',
        trust: 0,
        distrust: 0,
        trustValue: 0,
        degree: 0,
        connected: false,
        paths: [],
        sourceEventIds: [],
        computedAt: 0,
        graphVersion: 0,
        context: '',
      },
    }
  }
  return { ok: true, version: BACKGROUND_API_VERSION, data: {} }
})

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage,
    onMessage: { addListener: vi.fn() },
  },
})

describe('page entity store', () => {
  afterEach(() => {
    resetPageEntityStoreForTests()
    sendMessage.mockClear()
  })

  it('coalesces GET_X_IDENTITY for the same twitterId', async () => {
    const store = getPageEntityStore()
    store.requestUser('11348282')
    store.requestUser('11348282')
    await vi.waitFor(() => {
      expect(store.getUser('11348282')?.twitterId).toBe('11348282')
    })
    expect(
      sendMessage.mock.calls.filter(
        (call) => (call[0] as { type: string }).type === 'GET_X_IDENTITY',
      ),
    ).toHaveLength(1)
  })

  it('prefetches trusted-by and outgoing trust once for a selected pubkey', async () => {
    const store = getPageEntityStore()
    const selected = {
      subject: { type: 'p' as const, value: 'ab'.repeat(32) },
    }
    store.prefetchSelection(selected)
    store.prefetchSelection(selected)
    await vi.waitFor(() => {
      expect(store.getOutgoing(selected.subject).status).toBe('ready')
    })
    expect(
      sendMessage.mock.calls.filter(
        (call) => (call[0] as { type: string }).type === 'QUERY_TRUST',
      ),
    ).toHaveLength(1)
    expect(
      sendMessage.mock.calls.filter(
        (call) => (call[0] as { type: string }).type === 'QUERY_OUTGOING_TRUST',
      ),
    ).toHaveLength(1)
  })
})
