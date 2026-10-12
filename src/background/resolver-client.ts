/**
 * Service-worker client for resolver protocol v1.
 * One long-lived socket per selected server, plus a short handshake probe.
 */

import type { Event } from 'nostr-tools'
import type {
  GraphServerHandshake,
  QueryRatingBatchResult,
  QueryTrustBatchResult,
} from '../shared/contracts'
import { graphServerWebSocketUrl } from '../shared/server-list'
import type {
  RatingQueryResult,
  TrustQueryResult,
  TrustSubject,
} from '../graph/types'
import {
  asLookupPage,
  asNeighborhood,
  asRatingBatchResult,
  asRatingQueryResult,
  asTrustBatchResult,
  asTrustQueryResult,
  emptyRatingResult,
  emptyTrustResult,
  infoGraphVersion,
  parseResolverFrame,
  parseResolverInfo,
  type LookupStatementPage,
  type ResolverInfo,
  type ServerNeighborhood,
} from './resolver-protocol'

export interface ResolverSessionDefaults {
  rootPubkey: string
  followTrustThreshold: number
  followTrustRed: number
  maxDepth: number
}

export interface ResolverSocket {
  send(data: string): void
  close(): void
  onMessage(handler: (data: string) => void): void
  onClose(handler: () => void): void
  onError(handler: () => void): void
}

export interface ResolverTransport {
  fetchNip11(url: string, signal: AbortSignal): Promise<unknown>
  openSocket(wsUrl: string): ResolverSocket
}

export class ResolverUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResolverUnavailable'
  }
}

export interface ResolverIngestResult {
  ok: boolean
  restricted: boolean
  message: string
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface PendingIngest {
  resolve: (value: ResolverIngestResult) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_IDLE_MS = 45_000
const DEFAULT_CONNECT_MS = 8_000
const DEFAULT_REQUEST_MS = 4_000

export interface ResolverClientOptions {
  transport: ResolverTransport
  onGraphPush?: () => void
  idleMs?: number
  connectTimeoutMs?: number
  requestTimeoutMs?: number
  now?: () => number
}

export type GraphResolver = Pick<
  ResolverClient,
  | 'setUrl'
  | 'close'
  | 'handshake'
  | 'writesAllowed'
  | 'trustQuery'
  | 'trustBatch'
  | 'ratingQuery'
  | 'ratingBatch'
  | 'lookupIncoming'
  | 'lookupOutgoing'
  | 'neighborhood'
  | 'ingestEvent'
>

export class ResolverClient {
  readonly #transport: ResolverTransport
  readonly #onGraphPush: (() => void) | undefined
  readonly #idleMs: number
  readonly #connectTimeoutMs: number
  readonly #requestTimeoutMs: number
  readonly #now: () => number
  #httpUrl = ''
  #socket: ResolverSocket | undefined
  #ready = false
  #opening: Promise<void> | undefined
  #seq = 0
  #pending = new Map<string, PendingCall>()
  #ingests = new Map<string, PendingIngest>()
  #idle: ReturnType<typeof setTimeout> | undefined
  #sessionKey = ''
  #instanceId: string | undefined
  #backoffMs = 500
  #nextConnectAt = 0

  constructor(options: ResolverClientOptions) {
    this.#transport = options.transport
    this.#onGraphPush = options.onGraphPush
    this.#idleMs = options.idleMs ?? DEFAULT_IDLE_MS
    this.#connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_MS
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_MS
    this.#now = options.now ?? Date.now
  }

  setUrl(httpUrl: string): void {
    if (this.#httpUrl === httpUrl) return
    this.#httpUrl = httpUrl
    this.close()
  }

  close(): void {
    this.#ready = false
    this.#sessionKey = ''
    if (this.#idle) clearTimeout(this.#idle)
    this.#idle = undefined
    const socket = this.#socket
    this.#socket = undefined
    socket?.close()
    const unavailable = new ResolverUnavailable('Resolver connection closed')
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(unavailable)
    }
    this.#pending.clear()
    for (const pending of this.#ingests.values()) {
      clearTimeout(pending.timer)
      pending.reject(unavailable)
    }
    this.#ingests.clear()
  }

  async handshake(httpUrl: string): Promise<GraphServerHandshake> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.#connectTimeoutMs)
    try {
      let body: unknown
      try {
        body = await this.#transport.fetchNip11(httpUrl, controller.signal)
      } catch (error) {
        return {
          url: httpUrl,
          status: 'down',
          error: error instanceof Error ? error.message : 'Unreachable',
        }
      }
      const parsed = parseResolverInfo(body)
      if (!parsed.ok) {
        return {
          url: httpUrl,
          status: 'down',
          error: parsed.error,
          ...(parsed.api ? { api: parsed.api } : {}),
        }
      }
      const probed = await this.#probe(httpUrl, parsed.info)
      return probed
    } finally {
      clearTimeout(timer)
    }
  }

  async writesAllowed(httpUrl: string): Promise<boolean> {
    const handshake = await this.handshake(httpUrl)
    if (handshake.status !== 'up') {
      throw new ResolverUnavailable(handshake.error ?? 'Server is down')
    }
    return handshake.restrictedWrites !== true
  }

  async trustQuery(input: {
    session: ResolverSessionDefaults
    subject: TrustSubject
    context: string
    now?: number
    format?: 'default' | 'path'
  }): Promise<TrustQueryResult> {
    const fallback = this.#trustFallback(input.subject, input.context, input.session, input.now)
    const result = await this.#call(input.session, 'trust.query', {
      ...this.#sessionParams(input.session),
      subject: input.subject,
      context: input.context,
      ...(input.now !== undefined ? { now: input.now } : {}),
      ...(input.format ? { format: input.format } : {}),
    })
    return asTrustQueryResult(result, fallback)
  }

  async trustBatch(input: {
    session: ResolverSessionDefaults
    items: Array<{ key: string; subject: TrustSubject; context: string }>
    now?: number
    format?: 'default' | 'path'
  }): Promise<QueryTrustBatchResult> {
    const keys = input.items.map((item) => item.key)
    const result = await this.#call(input.session, 'trust.batch', {
      ...this.#sessionParams(input.session),
      items: input.items.map((item) => ({
        key: item.key,
        subject: item.subject,
        context: item.context,
      })),
      ...(input.now !== undefined ? { now: input.now } : {}),
      ...(input.format ? { format: input.format } : {}),
    })
    return asTrustBatchResult(
      result,
      (key) => {
        const item = input.items.find((row) => row.key === key)
        return this.#trustFallback(
          item?.subject ?? { type: 'i', value: '' },
          item?.context ?? '',
          input.session,
          input.now,
        )
      },
      keys,
    )
  }

  async ratingQuery(input: {
    session: ResolverSessionDefaults
    subject: TrustSubject
    context: string
    labels?: string[]
    now?: number
    format?: 'default' | 'path'
  }): Promise<RatingQueryResult> {
    const fallback = this.#ratingFallback(
      input.subject,
      input.context,
      input.session,
      input.now,
    )
    const result = await this.#call(input.session, 'rating.query', {
      ...this.#sessionParams(input.session),
      subject: input.subject,
      context: input.context,
      ...(input.labels ? { labels: input.labels } : {}),
      ...(input.now !== undefined ? { now: input.now } : {}),
      ...(input.format ? { format: input.format } : {}),
    })
    return asRatingQueryResult(result, fallback)
  }

  async ratingBatch(input: {
    session: ResolverSessionDefaults
    items: Array<{
      key: string
      subject: TrustSubject
      context: string
      labels?: string[]
    }>
    now?: number
  }): Promise<QueryRatingBatchResult> {
    const result = await this.#call(input.session, 'rating.batch', {
      ...this.#sessionParams(input.session),
      items: input.items.map((item) => ({
        key: item.key,
        subject: item.subject,
        context: item.context,
        ...(item.labels ? { labels: item.labels } : {}),
      })),
      ...(input.now !== undefined ? { now: input.now } : {}),
    })
    return asRatingBatchResult(
      result,
      (key) => {
        const item = input.items.find((row) => row.key === key)
        return this.#ratingFallback(
          item?.subject ?? { type: 'i', value: '' },
          item?.context ?? '',
          input.session,
          input.now,
        )
      },
      input.items.map((item) => item.key),
    )
  }

  async lookupIncoming(
    session: ResolverSessionDefaults,
    keys: readonly string[],
  ): Promise<LookupStatementPage> {
    const result = await this.#call(session, 'lookup.incoming', {
      keys: [...keys],
      kinds: [32009],
      context: 'identity',
      mergeKeys: true,
      limit: 200,
    })
    return asLookupPage(result, 'identity')
  }

  async lookupOutgoing(
    session: ResolverSessionDefaults,
    keys: readonly string[],
  ): Promise<LookupStatementPage> {
    const result = await this.#call(session, 'lookup.outgoing', {
      keys: [...keys],
      kinds: [32009],
      context: 'identity',
      subjectTypes: ['p', 'user:id'],
      limit: 200,
    })
    return asLookupPage(result, 'identity')
  }

  async neighborhood(
    session: ResolverSessionDefaults,
    params: {
      centerId: number | string
      direction?: string
      valueFilter?: string
      context?: string
      limit?: number
    },
  ): Promise<ServerNeighborhood> {
    const result = await this.#call(session, 'graph.neighborhood', {
      centerId: params.centerId,
      direction: params.direction ?? 'both',
      valueFilter: params.valueFilter ?? 'both',
      context: params.context ?? 'identity',
      limit: params.limit ?? 200,
    })
    return asNeighborhood(result, params.centerId)
  }

  async ingestEvent(event: Event): Promise<ResolverIngestResult> {
    await this.#connect()
    this.#touch()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#ingests.delete(event.id)
        reject(new ResolverUnavailable('Resolver ingest timed out'))
      }, this.#requestTimeoutMs)
      this.#ingests.set(event.id, { resolve, reject, timer })
      this.#socket?.send(JSON.stringify(['EVENT', event]))
    })
  }

  async #probe(httpUrl: string, info: ResolverInfo): Promise<GraphServerHandshake> {
    const socket = this.#transport.openSocket(graphServerWebSocketUrl(httpUrl))
    try {
      await this.#waitForAuth(socket)
      const reqId = 'handshake'
      const version = await new Promise<number | undefined>((resolve, reject) => {
        const timer = setTimeout(() => resolve(undefined), this.#requestTimeoutMs)
        const previous = socket
        previous.onMessage((data) => {
          const frame = parseResolverFrame(data)
          if (frame.type === 'dtp-ok' && frame.reqId === reqId) {
            clearTimeout(timer)
            resolve(infoGraphVersion(frame.result))
          } else if (frame.type === 'dtp-err' && frame.reqId === reqId) {
            clearTimeout(timer)
            reject(new Error(frame.message || frame.code))
          }
        })
        socket.send(JSON.stringify(['DTP', reqId, 'info', {}]))
      }).catch(() => undefined)
      return {
        url: httpUrl,
        status: 'up',
        api: info.api,
        ...(info.instanceId ? { instanceId: info.instanceId } : {}),
        ...(version !== undefined ? { graphVersion: version } : {}),
        restrictedWrites: info.restrictedWrites,
      }
    } catch (error) {
      return {
        url: httpUrl,
        status: 'down',
        error: error instanceof Error ? error.message : 'Handshake failed',
        api: info.api,
      }
    } finally {
      socket.close()
    }
  }

  async #waitForAuth(socket: ResolverSocket): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Handshake timed out')),
        this.#connectTimeoutMs,
      )
      socket.onError(() => {
        clearTimeout(timer)
        reject(new Error('Handshake failed'))
      })
      socket.onClose(() => {
        clearTimeout(timer)
        reject(new Error('Handshake closed'))
      })
      socket.onMessage((data) => {
        const frame = parseResolverFrame(data)
        if (frame.type !== 'auth') return
        clearTimeout(timer)
        resolve()
      })
    })
  }

  async #connect(): Promise<void> {
    if (!this.#httpUrl) throw new ResolverUnavailable('No graph server selected')
    if (this.#ready && this.#socket) return
    if (this.#now() < this.#nextConnectAt) {
      throw new ResolverUnavailable('Server is down')
    }
    if (this.#opening) return this.#opening
    this.#opening = this.#openConnection()
    try {
      await this.#opening
    } finally {
      this.#opening = undefined
    }
  }

  async #openConnection(): Promise<void> {
    const url = this.#httpUrl
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.#connectTimeoutMs)
    try {
      const body = await this.#transport.fetchNip11(url, controller.signal)
      const parsed = parseResolverInfo(body)
      if (!parsed.ok) throw new ResolverUnavailable(parsed.error)
      if (parsed.info.instanceId && parsed.info.instanceId !== this.#instanceId) {
        const changed = this.#instanceId !== undefined
        this.#instanceId = parsed.info.instanceId
        if (changed) this.#onGraphPush?.()
      } else if (parsed.info.instanceId) {
        this.#instanceId = parsed.info.instanceId
      }
      const socket = this.#transport.openSocket(graphServerWebSocketUrl(url))
      this.#socket = socket
      socket.onMessage((data) => this.#onMessage(data))
      socket.onClose(() => {
        if (this.#socket === socket) this.close()
      })
      socket.onError(() => {
        if (this.#socket === socket) this.close()
      })
      await this.#waitUntilReady()
      this.#ready = true
      this.#backoffMs = 500
      this.#nextConnectAt = 0
      this.#touch()
    } catch (error) {
      this.#socket?.close()
      this.#socket = undefined
      this.#ready = false
      this.#nextConnectAt = this.#now() + this.#backoffMs
      this.#backoffMs = Math.min(30_000, this.#backoffMs * 2)
      throw error instanceof ResolverUnavailable
        ? error
        : new ResolverUnavailable(
            error instanceof Error ? error.message : 'Server is down',
          )
    } finally {
      clearTimeout(timer)
    }
  }

  #waitUntilReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new ResolverUnavailable('Handshake timed out')),
        this.#connectTimeoutMs,
      )
      const socket = this.#socket
      if (!socket) {
        clearTimeout(timer)
        reject(new ResolverUnavailable('Handshake failed'))
        return
      }
      const previous = this.#onAuthed
      this.#onAuthed = () => {
        clearTimeout(timer)
        this.#onAuthed = previous
        resolve()
      }
    })
  }

  #onAuthed: (() => void) | undefined

  #onMessage(data: string): void {
    const frame = parseResolverFrame(data)
    switch (frame.type) {
      case 'auth':
        this.#onAuthed?.()
        return
      case 'dtp-ok': {
        const pending = this.#pending.get(frame.reqId)
        if (!pending) return
        clearTimeout(pending.timer)
        this.#pending.delete(frame.reqId)
        pending.resolve(frame.result)
        return
      }
      case 'dtp-err': {
        const pending = this.#pending.get(frame.reqId)
        if (!pending) return
        clearTimeout(pending.timer)
        this.#pending.delete(frame.reqId)
        const message = frame.message || frame.code
        pending.reject(
          frame.code === 'invalid'
            ? new Error(message)
            : new ResolverUnavailable(message),
        )
        return
      }
      case 'ok': {
        const pending = this.#ingests.get(frame.eventId)
        if (!pending) return
        clearTimeout(pending.timer)
        this.#ingests.delete(frame.eventId)
        const restricted =
          frame.message.startsWith('restricted:') ||
          frame.message.startsWith('auth-required:')
        pending.resolve({
          ok: frame.accepted,
          restricted,
          message: frame.message,
        })
        return
      }
      case 'push':
        if (frame.topic === 'graph') this.#onGraphPush?.()
        return
      case 'ignore':
        return
      default: {
        const _exhaustive: never = frame
        return _exhaustive
      }
    }
  }

  async #call(
    session: ResolverSessionDefaults,
    op: string,
    params: unknown,
  ): Promise<unknown> {
    await this.#connect()
    await this.#ensureSession(session)
    this.#touch()
    const reqId = String(++this.#seq)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(reqId)
        reject(new ResolverUnavailable('Resolver request timed out'))
      }, this.#requestTimeoutMs)
      this.#pending.set(reqId, { resolve, reject, timer })
      this.#socket?.send(JSON.stringify(['DTP', reqId, op, params]))
    })
  }

  async #ensureSession(session: ResolverSessionDefaults): Promise<void> {
    const key = JSON.stringify(session)
    if (key === this.#sessionKey) return
    const reqId = String(++this.#seq)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(reqId)
        reject(new ResolverUnavailable('Resolver session timed out'))
      }, this.#requestTimeoutMs)
      this.#pending.set(reqId, {
        resolve: () => resolve(),
        reject,
        timer,
      })
      this.#socket?.send(
        JSON.stringify([
          'DTP',
          reqId,
          'session.update',
          {
            defaults: {
              rootPubkey: session.rootPubkey,
              bindingMode: 'lenient',
              followTrustThreshold: session.followTrustThreshold,
              followTrustRed: session.followTrustRed,
              bounds: { maxDepth: session.maxDepth },
              statementLimit: 50,
            },
          },
        ]),
      )
    })
    this.#sessionKey = key
  }

  #sessionParams(session: ResolverSessionDefaults): Record<string, unknown> {
    return {
      rootPubkey: session.rootPubkey,
      followTrustThreshold: session.followTrustThreshold,
      followTrustRed: session.followTrustRed,
      bindingMode: 'lenient',
      bounds: { maxDepth: session.maxDepth },
    }
  }

  #trustFallback(
    subject: TrustSubject,
    context: string,
    session: ResolverSessionDefaults,
    now?: number,
  ): TrustQueryResult {
    return emptyTrustResult({
      subject,
      context,
      now: now ?? Math.floor(this.#now() / 1000),
      followTrustThreshold: session.followTrustThreshold,
      followTrustRed: session.followTrustRed,
    })
  }

  #ratingFallback(
    subject: TrustSubject,
    context: string,
    session: ResolverSessionDefaults,
    now?: number,
  ): RatingQueryResult {
    return emptyRatingResult({
      subject,
      context,
      now: now ?? Math.floor(this.#now() / 1000),
      followTrustThreshold: session.followTrustThreshold,
      followTrustRed: session.followTrustRed,
    })
  }

  #touch(): void {
    if (this.#idle) clearTimeout(this.#idle)
    this.#idle = setTimeout(() => this.close(), this.#idleMs)
  }
}

export function chromeResolverTransport(): ResolverTransport {
  return {
    async fetchNip11(url, signal) {
      const response = await fetch(url, {
        headers: { Accept: 'application/nostr+json' },
        signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json() as Promise<unknown>
    },
    openSocket(wsUrl) {
      const ws = new WebSocket(wsUrl)
      return {
        send(data) {
          ws.send(data)
        },
        close() {
          ws.close()
        },
        onMessage(handler) {
          ws.addEventListener('message', (event) => {
            if (typeof event.data === 'string') handler(event.data)
          })
        },
        onClose(handler) {
          ws.addEventListener('close', () => handler())
        },
        onError(handler) {
          ws.addEventListener('error', () => handler())
        },
      }
    },
  }
}
