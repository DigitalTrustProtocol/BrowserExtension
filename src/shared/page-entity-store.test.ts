import { afterEach, describe, expect, it, vi } from 'vitest'
import { nip19 } from 'nostr-tools'
import {
  BACKGROUND_API_VERSION,
  type QueryOutgoingTrustResult,
} from './contracts'
import {
  getPageEntityStore,
  resetPageEntityStoreForTests,
} from './page-entity-store'

type RuntimeListener = (message: unknown) => void

const IDENTITY_NPUB = nip19.npubEncode('ab'.repeat(32))

const sendMessage = vi.fn(async (
  request: { type: string; twitterId?: string },
): Promise<unknown> => {
  if (request.type === 'GET_X_IDENTITY') {
    return {
      ok: true,
      version: BACKGROUND_API_VERSION,
      data: {
        identity: {
          twitterId: request.twitterId,
          handle: 'nasa',
          xNpub: IDENTITY_NPUB,
        },
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
        followTrustRed: 25, followTrustThreshold: 75,
      },
    }
  }
  return { ok: true, version: BACKGROUND_API_VERSION, data: {} }
})

const runtimeListeners = new Set<RuntimeListener>()
const addRuntimeListener = vi.fn((listener: RuntimeListener) => {
  runtimeListeners.add(listener)
})
const removeRuntimeListener = vi.fn((listener: RuntimeListener) => {
  runtimeListeners.delete(listener)
})

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage,
    onMessage: {
      addListener: addRuntimeListener,
      removeListener: removeRuntimeListener,
    },
  },
})

function emitRuntime(message: unknown): void {
  for (const listener of runtimeListeners) listener(message)
}

describe('page entity store', () => {
  afterEach(() => {
    resetPageEntityStoreForTests()
    runtimeListeners.clear()
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

  it('prefetches outgoing trust once for a selected pubkey', async () => {
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
    ).toHaveLength(0)
    expect(
      sendMessage.mock.calls.filter(
        (call) => (call[0] as { type: string }).type === 'QUERY_OUTGOING_TRUST',
      ),
    ).toHaveLength(1)
  })

  it('invalidates and re-prefetches outgoing trust after a graph update', async () => {
    const store = getPageEntityStore()
    const stop = store.subscribe(() => undefined)
    const selected = {
      subject: { type: 'p' as const, value: 'ab'.repeat(32) },
    }

    store.prefetchSelection(selected)
    await vi.waitFor(() => {
      expect(store.getOutgoing(selected.subject).status).toBe('ready')
    })
    emitRuntime({ type: 'TRUST_GRAPH_UPDATED' })

    await vi.waitFor(() => {
      expect(
        sendMessage.mock.calls.filter(
          (call) =>
            (call[0] as { type: string }).type === 'QUERY_OUTGOING_TRUST',
        ),
      ).toHaveLength(2)
    })
    stop()
  })

  it('coalesces a viewer and graph update pair into one outgoing refetch', async () => {
    const store = getPageEntityStore()
    const stop = store.subscribe(() => undefined)
    const selected = {
      subject: { type: 'p' as const, value: 'ab'.repeat(32) },
    }

    store.prefetchSelection(selected)
    await vi.waitFor(() => {
      expect(store.getOutgoing(selected.subject).status).toBe('ready')
    })
    emitRuntime({
      type: 'VIEWER_CHANGED',
      origin: 'operator',
      publish: 'forbidden',
      readOnly: true,
    })
    emitRuntime({ type: 'TRUST_GRAPH_UPDATED' })

    await vi.waitFor(() => {
      expect(
        sendMessage.mock.calls.filter(
          (call) =>
            (call[0] as { type: string }).type === 'QUERY_OUTGOING_TRUST',
        ),
      ).toHaveLength(2)
    })
    stop()
  })

  it('invalidates the selected user outgoing trust when its identity changes', async () => {
    const store = getPageEntityStore()
    const stop = store.subscribe(() => undefined)
    const selected = {
      subject: { type: 'i' as const, value: 'user:id:1' },
    }

    store.requestUser('1')
    await vi.waitFor(() => {
      expect(store.getUser('1')).not.toBeUndefined()
    })
    store.prefetchSelection(selected)
    await vi.waitFor(() => {
      expect(store.getOutgoing(selected.subject).status).toBe('ready')
    })
    emitRuntime({
      type: 'X_IDENTITY_UPDATED',
      twitterId: '1',
      state: 'verified',
      handle: 'nasa',
      statusChanged: true,
    })

    await vi.waitFor(() => {
      expect(
        sendMessage.mock.calls.filter(
          (call) =>
            (call[0] as { type: string }).type === 'QUERY_OUTGOING_TRUST',
        ),
      ).toHaveLength(2)
    })
    stop()
  })

  it('drops an outdated outgoing response and keeps the replacement result', async () => {
    const store = getPageEntityStore()
    const stop = store.subscribe(() => undefined)
    const selected = {
      subject: { type: 'p' as const, value: 'ab'.repeat(32) },
    }
    let resolveFirst: (value: QueryOutgoingTrustResult) => void = () =>
      undefined
    let resolveSecond: (value: QueryOutgoingTrustResult) => void = () =>
      undefined
    const first = new Promise<QueryOutgoingTrustResult>((resolve) => {
      resolveFirst = resolve
    })
    const second = new Promise<QueryOutgoingTrustResult>((resolve) => {
      resolveSecond = resolve
    })
    sendMessage
      .mockImplementationOnce(async () => ({
        ok: true,
        version: BACKGROUND_API_VERSION,
        data: await first,
      }))
      .mockImplementationOnce(async () => ({
        ok: true,
        version: BACKGROUND_API_VERSION,
        data: await second,
      }))

    store.prefetchSelection(selected)
    expect(store.getOutgoing(selected.subject).status).toBe('loading')
    emitRuntime({ type: 'TRUST_GRAPH_UPDATED' })
    await vi.waitFor(() => {
      expect(
        sendMessage.mock.calls.filter(
          (call) =>
            (call[0] as { type: string }).type === 'QUERY_OUTGOING_TRUST',
        ),
      ).toHaveLength(2)
    })
    resolveFirst({
      subject: selected.subject,
      statements: [],
      truncated: false,
    })
    await Promise.resolve()
    expect(store.getOutgoing(selected.subject).status).toBe('loading')

    resolveSecond({
      subject: selected.subject,
      statements: [],
      truncated: false,
    })
    await vi.waitFor(() => {
      expect(store.getOutgoing(selected.subject).status).toBe('ready')
    })
    stop()
  })
})
