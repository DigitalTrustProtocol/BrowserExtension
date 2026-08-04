/**
 * Isolated-world bridge: page NIP-07 MessagePort ↔ background (no WebLN).
 *
 * Establishes a capability-bound MessageChannel with the MAIN-world inject so
 * RPC responses are not forgeable via public window.postMessage races.
 */

import {
  createNip07PortAccountChanged,
  createNip07PortOfferWire,
  createNip07PortRpcResponse,
  parseNip07PortRequestWire,
  parseNip07PortRpcRequest,
} from './page-bridge-protocol.ts'

export {}

declare global {
  interface Window {
    __attentionXNip07Bridge?: boolean
  }
}

if (!window.__attentionXNip07Bridge) {
  window.__attentionXNip07Bridge = true

  const browser =
    (globalThis as unknown as Record<string, typeof chrome>).browser ?? chrome

  interface PortRequest {
    id: string
    method: string
    params: unknown
    pagePort: MessagePort
  }

  interface BackgroundState {
    port: ReturnType<typeof browser.runtime.connect> | null
    queue: PortRequest[]
    inflight: PortRequest | null
  }

  const state: BackgroundState = { port: null, queue: [], inflight: null }
  /** Active page MessagePorts (one per successful handshake; usually one). */
  const pagePorts = new Set<MessagePort>()

  function postToPage(
    pagePort: MessagePort,
    id: string,
    result: unknown,
    error: unknown,
  ): void {
    const errorText =
      error === undefined || error === null
        ? null
        : typeof error === 'string'
          ? error
          : String(error)
    try {
      pagePort.postMessage(createNip07PortRpcResponse(id, result, errorText))
    } catch {
      pagePorts.delete(pagePort)
    }
  }

  function processNextInQueue(): void {
    if (state.inflight || state.queue.length === 0) return
    const request = state.queue.shift()!
    state.inflight = request
    const port = getOrCreatePort()
    if (!port) {
      state.inflight = null
      postToPage(
        request.pagePort,
        request.id,
        null,
        'Extension context invalidated — reload the page',
      )
      processNextInQueue()
      return
    }
    const origin = window.location.hostname
    port.postMessage({
      method: 'nip07_' + request.method,
      params: {
        ...(request.params as Record<string, unknown>),
        origin,
      },
    })
  }

  function getOrCreatePort(): ReturnType<typeof browser.runtime.connect> | null {
    if (state.port) return state.port
    try {
      const port = browser.runtime.connect({ name: 'nip07' })
      port.onMessage.addListener((msg: { result?: unknown; error?: string }) => {
        const current = state.inflight
        if (!current) return
        state.inflight = null
        postToPage(
          current.pagePort,
          current.id,
          msg.result ?? null,
          msg.error ?? null,
        )
        processNextInQueue()
      })
      port.onDisconnect.addListener(() => {
        state.port = null
        if (state.inflight) {
          const current = state.inflight
          state.inflight = null
          postToPage(
            current.pagePort,
            current.id,
            null,
            'Extension context invalidated — reload the page',
          )
        }
        while (state.queue.length > 0) {
          const queued = state.queue.shift()!
          postToPage(
            queued.pagePort,
            queued.id,
            null,
            'Extension context invalidated — reload the page',
          )
        }
      })
      state.port = port
      return port
    } catch {
      return null
    }
  }

  function enqueue(
    pagePort: MessagePort,
    id: string,
    method: string,
    params: unknown,
  ): void {
    state.queue.push({ id, method, params, pagePort })
    processNextInQueue()
  }

  function attachPagePort(pagePort: MessagePort): void {
    pagePorts.add(pagePort)
    pagePort.onmessage = (event: MessageEvent<unknown>) => {
      const request = parseNip07PortRpcRequest(event.data)
      if (!request) {
        const id =
          event.data &&
          typeof event.data === 'object' &&
          !Array.isArray(event.data) &&
          typeof (event.data as { id?: unknown }).id === 'string'
            ? (event.data as { id: string }).id
            : null
        if (id) {
          postToPage(pagePort, id, null, 'Invalid NIP-07 request')
        }
        return
      }
      enqueue(pagePort, request.id, request.method, request.params)
    }
    pagePort.start()
  }

  function offerPort(): void {
    // Avoid unbounded channels if the inject retries while an offer is in flight.
    if (pagePorts.size >= 3) return
    const channel = new MessageChannel()
    attachPagePort(channel.port1)
    window.postMessage(
      createNip07PortOfferWire(),
      window.location.origin,
      [channel.port2],
    )
  }

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return
    if (event.origin !== window.location.origin) return
    if (!parseNip07PortRequestWire(event.data)) return
    offerPort()
  })

  // Forward account-changed broadcasts from background onto connected page ports.
  try {
    browser.runtime.onMessage.addListener(
      (msg: { type?: string; pubkey?: string }) => {
        if (msg?.type !== 'NOSTR_ACCOUNT_CHANGED') return
        const payload = createNip07PortAccountChanged(msg.pubkey)
        for (const pagePort of pagePorts) {
          try {
            pagePort.postMessage(payload)
          } catch {
            pagePorts.delete(pagePort)
          }
        }
      },
    )
  } catch {
    /* ignore */
  }
}
