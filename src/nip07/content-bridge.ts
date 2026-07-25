/**
 * Isolated-world bridge: page NIP-07 requests ↔ background (no WebLN).
 */

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

  const NIP07_ALLOWED_METHODS = [
    'getPublicKey',
    'signEvent',
    'getRelays',
    'nip04Encrypt',
    'nip04Decrypt',
    'nip44Encrypt',
    'nip44Decrypt',
  ] as const

  interface PortRequest {
    id: string
    responseType: string
    method: string
    params: unknown
  }

  interface PortState {
    port: ReturnType<typeof browser.runtime.connect> | null
    queue: PortRequest[]
    inflight: PortRequest | null
  }

  const state: PortState = { port: null, queue: [], inflight: null }

  function postResponse(
    responseType: string,
    id: string,
    result: unknown,
    error: unknown,
  ): void {
    window.postMessage(
      { type: responseType, id, result, error },
      window.location.origin,
    )
  }

  function processNextInQueue(): void {
    if (state.inflight || state.queue.length === 0) return
    const request = state.queue.shift()!
    state.inflight = request
    const port = getOrCreatePort()
    if (!port) {
      state.inflight = null
      postResponse(
        request.responseType,
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
        postResponse(
          current.responseType,
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
          postResponse(
            current.responseType,
            current.id,
            null,
            'Extension context invalidated — reload the page',
          )
        }
        while (state.queue.length > 0) {
          const queued = state.queue.shift()!
          postResponse(
            queued.responseType,
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
    id: string,
    responseType: string,
    method: string,
    params: unknown,
  ): void {
    state.queue.push({ id, responseType, method, params })
    processNextInQueue()
  }

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return
    if (event.data?.type !== 'NIP07_REQUEST') return
    const { id, method, params } = event.data as {
      id: string
      method: string
      params: unknown
    }
    if (
      !(NIP07_ALLOWED_METHODS as readonly string[]).includes(method)
    ) {
      postResponse('NIP07_RESPONSE', id, null, `Unknown method: ${method}`)
      return
    }
    enqueue(id, 'NIP07_RESPONSE', method, params ?? {})
  })

  // Forward account-changed broadcasts from background into the page.
  try {
    browser.runtime.onMessage.addListener((msg: { type?: string; pubkey?: string }) => {
      if (msg?.type === 'NOSTR_ACCOUNT_CHANGED') {
        window.postMessage(
          { type: 'NOSTR_ACCOUNT_CHANGED', pubkey: msg.pubkey },
          window.location.origin,
        )
      }
    })
  } catch {
    /* ignore */
  }
}
