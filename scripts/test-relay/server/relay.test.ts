import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { startTestRelay } from '../client.ts'
import type { TestRelayCluster } from '../cluster.ts'

const clusters: TestRelayCluster[] = []

afterEach(async () => {
  await Promise.all(clusters.splice(0).map((cluster) => cluster.close()))
})

describe('test relay', () => {
  it('serves NIP-11 and answers REQ newest-first with an inclusive until', async () => {
    const cluster = await open()
    const secret = generateSecretKey()
    const events = [1, 2, 3, 4, 5].map((createdAt) =>
      signed(secret, { kind: 1, created_at: createdAt, tags: [], content: String(createdAt) }),
    )
    for (const event of events) cluster.hosts[0]!.publish(event)

    const info = await fetch(cluster.hosts[0]!.adminUrl)
    expect(info.ok).toBe(true)
    const doc = (await info.json()) as { software?: string }
    expect(doc.software).toBe('attentionx-test-relay')

    const page = await req(cluster.hosts[0]!.url, { kinds: [1], until: 3, limit: 2 })
    expect(page.events.map((event) => event.created_at)).toEqual([3, 2])
    expect(page.eose).toBe(true)
  })

  it('keeps one replaceable and one addressable winner, and applies kind 5', async () => {
    const cluster = await open()
    const secret = generateSecretKey()
    const pubkey = getPublicKey(secret)
    const older = signed(secret, { kind: 0, created_at: 10, tags: [], content: 'old' })
    const newer = signed(secret, { kind: 0, created_at: 20, tags: [], content: 'new' })
    expect(cluster.hosts[0]!.publish(older).ok).toBe(true)
    expect(cluster.hosts[0]!.publish(newer).ok).toBe(true)
    expect(cluster.hosts[0]!.publish(older).ok).toBe(false)

    const slotOld = signed(secret, {
      kind: 30001,
      created_at: 10,
      tags: [['d', 'slot']],
      content: 'old',
    })
    const slotNew = signed(secret, {
      kind: 30001,
      created_at: 11,
      tags: [['d', 'slot']],
      content: 'new',
    })
    cluster.hosts[0]!.publish(slotOld)
    cluster.hosts[0]!.publish(slotNew)

    const ephemeral = signed(secret, {
      kind: 20000,
      created_at: 12,
      tags: [],
      content: 'gone',
    })
    const ephemeralResult = cluster.hosts[0]!.publish(ephemeral)
    expect(ephemeralResult.ok).toBe(true)
    if (ephemeralResult.ok) expect(ephemeralResult.stored).toBe(false)

    const deletion = signed(secret, {
      kind: 5,
      created_at: 30,
      tags: [['e', newer.id], ['a', `30001:${pubkey}:slot`]],
      content: '',
    })
    expect(cluster.hosts[0]!.publish(deletion).ok).toBe(true)

    const left = await req(cluster.hosts[0]!.url, { authors: [pubkey], limit: 20 })
    const kinds = left.events.map((event) => event.kind).sort((a, b) => a - b)
    expect(kinds).toEqual([5])
    expect(left.events.some((event) => event.id === newer.id)).toBe(false)
    expect(left.events.some((event) => event.id === slotNew.id)).toBe(false)
  })

  it('rejects a bad signature, a future timestamp, an oversize event, and a duplicate', async () => {
    const cluster = await open()
    const result = await cluster.command('personas 2')
    expect(result.ok).toBe(true)
    const lines = (await cluster.command('pathological')).lines
    expect(lines.some((line) => line.startsWith('UNEXPECTED'))).toBe(false)
    expect(lines.some((line) => line.includes('invalid: signature'))).toBe(true)
    expect(lines.some((line) => line.includes('too far in the future'))).toBe(true)
    expect(lines.some((line) => line.includes('too large'))).toBe(true)
    expect(lines.some((line) => line.includes('duplicate:'))).toBe(true)
  })

  it('fans out a live event and the admin wait sees a publish', async () => {
    const cluster = await open()
    const socket = new WebSocket(cluster.hosts[0]!.url)
    const frames: unknown[] = []
    await opened(socket)
    socket.addEventListener('message', (message) => {
      frames.push(JSON.parse(String(message.data)))
    })
    socket.send(JSON.stringify(['REQ', 'live', { kinds: [1] }]))
    await waitFor(() => frames.some((frame) => Array.isArray(frame) && frame[0] === 'EOSE'))

    const secret = generateSecretKey()
    const event = signed(secret, { kind: 1, created_at: 50, tags: [], content: 'live' })
    const pending = cluster.waitFor({ kind: 1, fresh: true, timeoutMs: 2_000 })
    cluster.hosts[0]!.publish(event)
    await expect(pending).resolves.toMatchObject({ id: event.id })
    await waitFor(() =>
      frames.some(
        (frame) =>
          Array.isArray(frame) && frame[0] === 'EVENT' && frame[1] === 'live',
      ),
    )
    socket.close()
  })

  it('stores a small bulk load once per relay and reports stats over HTTP', async () => {
    const cluster = await open({ relays: 2 })
    const result = await cluster.command('bulk 30 1')
    expect(result.ok).toBe(true)
    expect(cluster.hosts[0]!.store.size).toBeGreaterThan(10)
    expect(cluster.hosts[1]!.store.size).toBe(cluster.hosts[0]!.store.size)

    const remote = await fetch(`${cluster.hosts[0]!.adminUrl}/admin/stats`)
    const body = (await remote.json()) as { relays: Array<{ stored: number }> }
    expect(body.relays).toHaveLength(2)
    expect(body.relays[0]!.stored).toBe(cluster.hosts[0]!.store.size)
  })

  it('injects OK false while the reject fault is on', async () => {
    const cluster = await open()
    await cluster.command('fault reject 100')
    const secret = generateSecretKey()
    const event = signed(secret, { kind: 1, created_at: 1, tags: [], content: 'nope' })
    const socket = new WebSocket(cluster.hosts[0]!.url)
    const frames: unknown[] = []
    await opened(socket)
    socket.addEventListener('message', (message) => {
      frames.push(JSON.parse(String(message.data)))
    })
    socket.send(JSON.stringify(['EVENT', event]))
    await waitFor(() => frames.length > 0)
    expect(frames[0]).toEqual(['OK', event.id, false, 'error: injected reject'])
    expect(cluster.hosts[0]!.store.size).toBe(0)
    socket.close()
  })
})

async function open(
  options: { relays?: number } = {},
): Promise<TestRelayCluster> {
  const cluster = await startTestRelay({ port: 0, relays: options.relays ?? 1, seed: 'test' })
  clusters.push(cluster)
  return cluster
}

function signed(
  secret: Uint8Array,
  template: { kind: number; created_at: number; tags: string[][]; content: string },
): Event {
  return finalizeEvent(template, secret)
}

async function req(
  url: string,
  filter: Record<string, unknown>,
): Promise<{ events: Event[]; eose: boolean }> {
  const socket = new WebSocket(url)
  const events: Event[] = []
  let eose = false
  await opened(socket)
  socket.addEventListener('message', (message) => {
    const frame = JSON.parse(String(message.data)) as unknown[]
    if (frame[0] === 'EVENT') events.push(frame[2] as Event)
    if (frame[0] === 'EOSE') eose = true
  })
  socket.send(JSON.stringify(['REQ', 'page', filter]))
  await waitFor(() => eose)
  socket.close()
  return { events, eose }
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error('socket error')), { once: true })
  })
}

async function waitFor(ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the relay')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
