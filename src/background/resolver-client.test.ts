import { describe, expect, it } from 'vitest'
import { DEFAULT_GRAPH_SERVER_URL } from '../shared/server-list'
import {
  ResolverClient,
  type ResolverSocket,
  type ResolverTransport,
} from './resolver-client'
import { parseResolverInfo } from './resolver-protocol'

const NIP11 = {
  limitation: { auth_required: false, restricted_writes: true },
  dtp: {
    api: 'v1',
    instanceId: 'abc',
    capabilities: [
      'trust.query',
      'trust.batch',
      'rating.query',
      'rating.batch',
      'graph.neighborhood',
      'lookup.incoming',
      'lookup.outgoing',
    ],
  },
}

class ScriptedSocket implements ResolverSocket {
  sent: string[] = []
  #messages = new Set<(data: string) => void>()
  #closed = false

  send(data: string): void {
    this.sent.push(data)
    const frame = JSON.parse(data) as unknown[]
    if (frame[0] !== 'DTP') return
    const reqId = frame[1]
    const op = frame[2]
    if (op === 'info') {
      queueMicrotask(() =>
        this.emit(
          JSON.stringify([
            'DTP-OK',
            reqId,
            { api: 'v1', graphVersion: 7, instanceId: 'abc' },
          ]),
        ),
      )
    } else if (op === 'session.update') {
      queueMicrotask(() =>
        this.emit(JSON.stringify(['DTP-OK', reqId, { defaults: {} }])),
      )
    } else if (op === 'trust.batch') {
      const params = frame[3] as { items: Array<{ key: string; subject: unknown; context: string }> }
      const results: Record<string, unknown> = {}
      for (const item of params.items) {
        results[item.key] = {
          subject: item.subject,
          context: item.context,
          resolution: 'trusted',
          trust: 2,
          distrust: 0,
          trustValue: 2,
          degree: 1,
          connected: true,
          statements: [],
          paths: [],
          sourceEventIds: [],
          computedAt: 1,
          graphVersion: 9,
          truncated: false,
          followTrustThreshold: 75,
          followTrustRed: 25,
        }
      }
      queueMicrotask(() =>
        this.emit(
          JSON.stringify(['DTP-OK', reqId, { graphVersion: 9, results }]),
        ),
      )
    }
  }

  close(): void {
    this.#closed = true
  }

  emit(data: string): void {
    if (this.#closed) return
    for (const handler of this.#messages) handler(data)
  }

  onMessage(handler: (data: string) => void): void {
    this.#messages.add(handler)
  }

  onClose(): void {}

  onError(): void {}
}

function transport(options?: {
  nip11?: unknown
  failFetch?: boolean
}): { transport: ResolverTransport; sockets: ScriptedSocket[] } {
  const sockets: ScriptedSocket[] = []
  return {
    sockets,
    transport: {
      async fetchNip11() {
        if (options?.failFetch) throw new Error('offline')
        return options?.nip11 ?? NIP11
      },
      openSocket() {
        const socket = new ScriptedSocket()
        sockets.push(socket)
        queueMicrotask(() => socket.emit(JSON.stringify(['AUTH', 'challenge'])))
        return socket
      },
    },
  }
}

describe('parseResolverInfo', () => {
  it('accepts protocol v1 with the read capabilities', () => {
    const parsed = parseResolverInfo(NIP11)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.info.restrictedWrites).toBe(true)
    expect(parsed.info.authRequired).toBe(false)
  })

  it('rejects a host that is not this protocol', () => {
    const parsed = parseResolverInfo({ name: 'relay' })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toMatch(/resolver/i)
  })
})

describe('ResolverClient handshake', () => {
  it('is up after the AUTH challenge and an info result', async () => {
    const { transport: wire } = transport()
    const client = new ResolverClient({ transport: wire, idleMs: 60_000 })
    const handshake = await client.handshake(DEFAULT_GRAPH_SERVER_URL)
    expect(handshake.status).toBe('up')
    expect(handshake.graphVersion).toBe(7)
    expect(handshake.instanceId).toBe('abc')
    expect(handshake.restrictedWrites).toBe(true)
    client.close()
  })

  it('is down when the document is not v1', async () => {
    const { transport: wire } = transport({ nip11: { dtp: { api: 'v0', capabilities: [] } } })
    const client = new ResolverClient({ transport: wire, idleMs: 60_000 })
    const handshake = await client.handshake(DEFAULT_GRAPH_SERVER_URL)
    expect(handshake.status).toBe('down')
    expect(handshake.error).toMatch(/v1/)
    client.close()
  })

  it('is down when the host does not answer', async () => {
    const { transport: wire } = transport({ failFetch: true })
    const client = new ResolverClient({ transport: wire, idleMs: 60_000 })
    const handshake = await client.handshake(DEFAULT_GRAPH_SERVER_URL)
    expect(handshake.status).toBe('down')
    client.close()
  })
})

describe('ResolverClient queries', () => {
  it('sends session defaults then trust.batch on one socket', async () => {
    const { transport: wire, sockets } = transport()
    const client = new ResolverClient({ transport: wire, idleMs: 60_000 })
    client.setUrl(DEFAULT_GRAPH_SERVER_URL)
    const session = {
      rootPubkey: 'ab'.repeat(32),
      followTrustThreshold: 75,
      followTrustRed: 25,
      maxDepth: 4,
    }
    const batch = await client.trustBatch({
      session,
      items: [
        {
          key: 'a',
          subject: { type: 'i', value: 'user:id:1' },
          context: 'identity',
        },
      ],
    })
    expect(batch.results.a?.resolution).toBe('trusted')
    expect(batch.graphVersion).toBe(9)
    expect(sockets).toHaveLength(1)
    const ops = sockets[0]!.sent.map((line) => (JSON.parse(line) as unknown[])[2])
    expect(ops).toEqual(['session.update', 'trust.batch'])
    client.close()
  })
})
