import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import type { Event, Filter } from 'nostr-tools'
import { eventMatchesFilter } from './filter.ts'
import { idleFaults, isDown, type FaultState } from './faults.ts'
import { DEFAULT_RELAY_LIMITS, type RelayLimits } from './limits.ts'
import { TEST_RELAY_NIP11 } from './nip11.ts'
import {
  closedFrame,
  eoseFrame,
  eventFrame,
  noticeFrame,
  okFrame,
  parseClientFrame,
} from './protocol.ts'
import { EventStore, type AcceptResult } from './store.ts'

const RECEIVED_CAP = 2_000
const MAX_FRAME_BYTES = 256 * 1024

export interface ReceivedRecord {
  event: Event
  at: number
  accepted: boolean
  reason?: string
}

export interface RelayHostOptions {
  limits?: RelayLimits
  verify?: boolean
  /** Cluster admin handler. WebSocket and NIP-11 stay local to this relay. */
  handleAdmin?: (
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ) => Promise<void>
}

interface Subscription {
  id: string
  filters: Filter[]
  live: boolean
  eoseTimer: ReturnType<typeof setTimeout> | undefined
}

interface Peer {
  socket: WebSocket
  subscriptions: Map<string, Subscription>
  eventTimes: number[]
  timers: Set<ReturnType<typeof setTimeout>>
}

/**
 * One local relay: HTTP (NIP-11 + admin) and WebSocket (NIP-01) on the same port.
 */
export class RelayHost {
  readonly store: EventStore
  readonly #verify: boolean
  readonly #limits: RelayLimits
  readonly #http: ReturnType<typeof createServer>
  readonly #sockets: WebSocketServer
  readonly #handleAdmin: RelayHostOptions['handleAdmin']
  #faults: FaultState = idleFaults()
  #peers = new Set<Peer>()
  #dropTimer: ReturnType<typeof setInterval> | undefined
  #received: ReceivedRecord[] = []
  #waiters: Array<{
    match: (event: Event) => boolean
    resolve: (event: Event) => void
  }> = []
  #accepted = 0
  #rejected = 0
  #duplicates = 0
  #port = 0
  #closed = false

  constructor(options: RelayHostOptions = {}) {
    this.#limits = options.limits ?? DEFAULT_RELAY_LIMITS
    this.#verify = options.verify !== false
    this.#handleAdmin = options.handleAdmin
    this.store = new EventStore(this.#limits)
    this.#http = createServer((request, response) => {
      void this.#onHttp(request, response)
    })
    this.#sockets = new WebSocketServer({ server: this.#http })
    this.#sockets.on('connection', (socket) => this.#onConnection(socket))
  }

  get port(): number {
    return this.#port
  }

  get url(): string {
    return `ws://127.0.0.1:${this.#port}`
  }

  get adminUrl(): string {
    return `http://127.0.0.1:${this.#port}`
  }

  get verify(): boolean {
    return this.#verify
  }

  get faults(): FaultState {
    return { ...this.#faults }
  }

  async listen(port: number): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.#http.off('error', onError)
        reject(error)
      }
      this.#http.on('error', onError)
      this.#http.listen(port, '127.0.0.1', () => {
        this.#http.off('error', onError)
        resolve()
      })
    })
    const address = this.#http.address() as AddressInfo
    this.#port = address.port
    return this.#port
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#clearDropTimer()
    for (const peer of [...this.#peers]) {
      this.#disposePeer(peer)
      peer.socket.terminate()
    }
    await new Promise<void>((resolve) => this.#sockets.close(() => resolve()))
    this.#http.closeAllConnections?.()
    if (!this.#http.listening) return
    await new Promise<void>((resolve) => {
      this.#http.close(() => resolve())
    })
  }

  setFaults(next: FaultState): void {
    this.#faults = { ...next }
    this.#clearDropTimer()
    if (next.dropEveryMs > 0) {
      this.#dropTimer = setInterval(() => {
        this.#dropPeers('error: injected drop')
      }, next.dropEveryMs)
      this.#dropTimer.unref()
    }
    if (isDown(next)) this.#dropPeers('error: relay down')
  }

  stats(): RelayStats {
    let subscriptions = 0
    for (const peer of this.#peers) subscriptions += peer.subscriptions.size
    return {
      port: this.#port,
      url: this.url,
      stored: this.store.size,
      accepted: this.#accepted,
      rejected: this.#rejected,
      duplicates: this.#duplicates,
      connections: this.#peers.size,
      subscriptions,
      verify: this.#verify,
      faults: this.faults,
    }
  }

  /** In-process publish used by the simulator. Still fans out to subscribers. */
  publish(event: Event): AcceptResult {
    return this.#accept(event, undefined)
  }

  received(query: ReceivedQuery = {}): ReceivedRecord[] {
    const limit = query.limit ?? 50
    const matched = this.#received.filter((row) =>
      matchesReceived(row, query),
    )
    return matched.slice(-limit).reverse()
  }

  /**
   * Resolve with the newest already-received match, or the next accepted one.
   * `fresh` ignores the backlog and waits for an event accepted after the call.
   */
  waitFor(query: WaitQuery): Promise<Event> {
    const timeoutMs = query.timeoutMs ?? 5_000
    if (!query.fresh) {
      const existing = this.received({ ...query, limit: 1 }).find(
        (row) => row.accepted,
      )
      if (existing) return Promise.resolve(existing.event)
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        match: (event: Event) => eventMatchesQuery(event, query),
        resolve: (event: Event) => {
          clearTimeout(timer)
          resolve(event)
        },
      }
      const timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter((item) => item !== waiter)
        reject(new Error('Timed out waiting for a relay event'))
      }, timeoutMs)
      this.#waiters.push(waiter)
    })
  }

  reset(): void {
    this.store.reset()
    this.#received = []
    this.#accepted = 0
    this.#rejected = 0
    this.#duplicates = 0
  }

  async #onHttp(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? '/', this.adminUrl)
    if (request.method === 'OPTIONS') {
      response.setHeader('access-control-allow-origin', '*')
      response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
      response.setHeader('access-control-allow-headers', 'content-type')
      response.statusCode = 204
      response.end()
      return
    }
    if (request.method === 'GET' && url.pathname === '/') {
      response.setHeader('content-type', 'application/nostr+json')
      response.setHeader('access-control-allow-origin', '*')
      response.end(JSON.stringify(TEST_RELAY_NIP11))
      return
    }
    if (url.pathname.startsWith('/admin') && this.#handleAdmin) {
      await this.#handleAdmin(request, response, url)
      return
    }
    response.statusCode = 404
    response.end()
  }

  #onConnection(socket: WebSocket): void {
    if (isDown(this.#faults)) {
      socket.close(1013, 'down')
      return
    }
    const peer: Peer = {
      socket,
      subscriptions: new Map(),
      eventTimes: [],
      timers: new Set(),
    }
    this.#peers.add(peer)
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        this.#send(peer, noticeFrame('invalid: binary frames are not supported'))
        return
      }
      const text = rawText(data)
      if (Buffer.byteLength(text) > MAX_FRAME_BYTES) {
        socket.close(1009, 'frame too large')
        return
      }
      this.#later(peer, this.#faults.latencyMs, () => this.#onFrame(peer, text))
    })
    socket.on('close', () => this.#disposePeer(peer))
    socket.on('error', () => this.#disposePeer(peer))
  }

  #onFrame(peer: Peer, text: string): void {
    if (!this.#peers.has(peer)) return
    const parsed = parseClientFrame(text, this.#limits)
    if ('notice' in parsed) {
      this.#send(peer, noticeFrame(parsed.notice))
      return
    }
    const frame = parsed.frame
    if (frame.type === 'EVENT') {
      this.#onEvent(peer, frame.event)
      return
    }
    if (frame.type === 'CLOSE') {
      this.#closeSubscription(peer, frame.subscriptionId, undefined)
      return
    }
    this.#openSubscription(peer, frame.subscriptionId, frame.filters)
  }

  #onEvent(peer: Peer, event: Event): void {
    if (this.#rateLimited(peer)) {
      this.#tally({
        ok: false,
        reason: 'rate-limited: slow down',
      }, event)
      this.#send(peer, okFrame(event.id, false, 'rate-limited: slow down'))
      return
    }
    if (this.#injectedReject()) {
      this.#tally({ ok: false, reason: 'error: injected reject' }, event)
      this.#send(peer, okFrame(event.id, false, 'error: injected reject'))
      return
    }
    const result = this.#accept(event, peer)
    const message = result.ok ? '' : result.reason
    this.#send(peer, okFrame(event.id, result.ok, message))
  }

  #accept(event: Event, peer: Peer | undefined): AcceptResult {
    const result = this.store.accept(event, this.#verify)
    if (result.ok) this.#noteRate(peer)
    this.#tally(result, event)
    if (result.ok) this.#fanout(event)
    return result
  }

  #openSubscription(peer: Peer, subscriptionId: string, filters: Filter[]): void {
    if (
      !peer.subscriptions.has(subscriptionId) &&
      peer.subscriptions.size >= this.#limits.maxSubscriptions
    ) {
      this.#send(
        peer,
        closedFrame(subscriptionId, 'invalid: too many subscriptions'),
      )
      return
    }
    this.#closeSubscription(peer, subscriptionId, undefined)
    const subscription: Subscription = {
      id: subscriptionId,
      filters,
      live: false,
      eoseTimer: undefined,
    }
    peer.subscriptions.set(subscriptionId, subscription)
    const seen = new Set<string>()
    for (const filter of filters) {
      for (const event of this.store.query(filter)) {
        if (seen.has(event.id)) continue
        seen.add(event.id)
        this.#send(peer, eventFrame(subscriptionId, event))
      }
    }
    // Live before EOSE so events that arrive during an EOSE delay are not lost.
    // They are delivered before the EOSE frame when that frame is delayed.
    subscription.live = true
    if (this.#faults.suppressEose) return
    const delay = this.#faults.eoseDelayMs
    const finish = (): void => {
      subscription.eoseTimer = undefined
      if (!peer.subscriptions.has(subscriptionId)) return
      this.#send(peer, eoseFrame(subscriptionId))
    }
    if (delay > 0) {
      subscription.eoseTimer = setTimeout(finish, delay)
      peer.timers.add(subscription.eoseTimer)
    } else {
      finish()
    }
  }

  #closeSubscription(
    peer: Peer,
    subscriptionId: string,
    reason: string | undefined,
  ): void {
    const existing = peer.subscriptions.get(subscriptionId)
    if (!existing) return
    if (existing.eoseTimer) clearTimeout(existing.eoseTimer)
    peer.subscriptions.delete(subscriptionId)
    if (reason) this.#send(peer, closedFrame(subscriptionId, reason))
  }

  #fanout(event: Event): void {
    for (const peer of this.#peers) {
      for (const subscription of peer.subscriptions.values()) {
        if (!subscription.live) continue
        const matched = subscription.filters.some((filter) =>
          eventMatchesFilter(event, filter),
        )
        if (matched) this.#send(peer, eventFrame(subscription.id, event))
      }
    }
  }

  #tally(result: AcceptResult, event: Event): void {
    if (result.ok) this.#accepted += 1
    else if (result.reason.startsWith('duplicate:')) this.#duplicates += 1
    else this.#rejected += 1
    this.#received.push({
      event,
      at: Date.now(),
      accepted: result.ok,
      ...(result.ok ? {} : { reason: result.reason }),
    })
    if (this.#received.length > RECEIVED_CAP) {
      this.#received.splice(0, this.#received.length - RECEIVED_CAP)
    }
    if (!result.ok) return
    const pending = this.#waiters
    this.#waiters = []
    for (const waiter of pending) {
      if (waiter.match(event)) waiter.resolve(event)
      else this.#waiters.push(waiter)
    }
  }

  #injectedReject(): boolean {
    const percent = this.#faults.rejectPercent
    if (percent <= 0) return false
    if (percent >= 100) return true
    return Math.random() * 100 < percent
  }

  #rateLimited(peer: Peer): boolean {
    const cap = this.#faults.ratePerSec
    if (cap <= 0) return false
    const now = Date.now()
    peer.eventTimes = peer.eventTimes.filter((at) => now - at < 1_000)
    return peer.eventTimes.length >= cap
  }

  #noteRate(peer: Peer | undefined): void {
    if (!peer || this.#faults.ratePerSec <= 0) return
    peer.eventTimes.push(Date.now())
  }

  #send(peer: Peer, frame: string): void {
    this.#later(peer, this.#faults.latencyMs, () => {
      if (peer.socket.readyState === peer.socket.OPEN) peer.socket.send(frame)
    })
  }

  #later(peer: Peer, delayMs: number, run: () => void): void {
    if (delayMs <= 0) {
      run()
      return
    }
    const timer = setTimeout(() => {
      peer.timers.delete(timer)
      run()
    }, delayMs)
    peer.timers.add(timer)
  }

  #dropPeers(reason: string): void {
    for (const peer of [...this.#peers]) {
      try {
        peer.socket.close(1011, reason)
      } catch {
        /* already closed */
      }
      this.#disposePeer(peer)
    }
  }

  #disposePeer(peer: Peer): void {
    if (!this.#peers.delete(peer)) return
    for (const timer of peer.timers) clearTimeout(timer)
    for (const subscription of peer.subscriptions.values()) {
      if (subscription.eoseTimer) clearTimeout(subscription.eoseTimer)
    }
    peer.subscriptions.clear()
    peer.timers.clear()
  }

  #clearDropTimer(): void {
    if (this.#dropTimer) clearInterval(this.#dropTimer)
    this.#dropTimer = undefined
  }
}

export interface RelayStats {
  port: number
  url: string
  stored: number
  accepted: number
  rejected: number
  duplicates: number
  connections: number
  subscriptions: number
  verify: boolean
  faults: FaultState
}

export interface ReceivedQuery {
  author?: string
  kind?: number
  tagName?: string
  tagValue?: string
  limit?: number
  acceptedOnly?: boolean
}

export interface WaitQuery extends ReceivedQuery {
  timeoutMs?: number
  fresh?: boolean
}

function matchesReceived(row: ReceivedRecord, query: ReceivedQuery): boolean {
  if (query.acceptedOnly && !row.accepted) return false
  return eventMatchesQuery(row.event, query)
}

function eventMatchesQuery(event: Event, query: ReceivedQuery): boolean {
  if (query.author && event.pubkey !== query.author.toLowerCase()) return false
  if (query.kind !== undefined && event.kind !== query.kind) return false
  if (query.tagName) {
    const found = event.tags.some(
      (tag) =>
        tag[0] === query.tagName &&
        (query.tagValue === undefined || tag[1] === query.tagValue),
    )
    if (!found) return false
  }
  return true
}

function rawText(data: RawData): string {
  if (typeof data === 'string') return data
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}
