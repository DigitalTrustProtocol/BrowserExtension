/**
 * Page-context NIP-07 provider (no WebLN / payments).
 * Runs in MAIN world. Signing happens in the background service worker.
 *
 * Talks to the isolated content bridge over a capability-bound MessagePort
 * established at document_start (not public window NIP07_RESPONSE messages).
 */

import {
  createNip07PortRequestWire,
  createNip07PortRpcRequest,
  parseNip07PortInbound,
  parseNip07PortOfferWire,
  type Nip07AllowedMethod,
} from './page-bridge-protocol.ts'

export {}

interface PendingEntry {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

interface NostrNip04 {
  encrypt: (pubkey: string, plaintext: string) => Promise<string>
  decrypt: (pubkey: string, ciphertext: string) => Promise<string>
}

interface NostrNip44 {
  encrypt: (pubkey: string, plaintext: string) => Promise<string>
  decrypt: (pubkey: string, ciphertext: string) => Promise<string>
}

interface SignedEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

interface NostrProvider {
  getPublicKey: () => Promise<string>
  signEvent: (event: Record<string, unknown>) => Promise<SignedEvent>
  getRelays: () => Promise<Record<string, { read: boolean; write: boolean }>>
  nip04: NostrNip04
  nip44: NostrNip44
}

declare global {
  interface Window {
    __attentionXNip07Injected?: boolean
    nostr: NostrProvider
  }
}

;(() => {
  if (window.__attentionXNip07Injected) return
  window.__attentionXNip07Injected = true

  const RPC_TIMEOUT_MS = 120_000
  const PORT_RETRY_MS = 50
  const PORT_RETRY_MAX = 40

  const pending = new Map<string, PendingEntry>()
  let port: MessagePort | null = null
  let portReady: Promise<MessagePort> | null = null
  let resolvePortReady: ((value: MessagePort) => void) | null = null
  let rejectPortReady: ((reason: Error) => void) | null = null
  let retryCount = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  function randomId(): string {
    const buf = new Uint8Array(16)
    crypto.getRandomValues(buf)
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
  }

  function ensurePortReadyPromise(): Promise<MessagePort> {
    if (port) return Promise.resolve(port)
    if (portReady) return portReady
    portReady = new Promise<MessagePort>((resolve, reject) => {
      resolvePortReady = resolve
      rejectPortReady = reject
    })
    return portReady
  }

  function clearRetryTimer(): void {
    if (retryTimer !== null) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  function requestPort(): void {
    window.postMessage(createNip07PortRequestWire(), window.location.origin)
  }

  function schedulePortRetry(): void {
    if (port || retryCount >= PORT_RETRY_MAX) return
    clearRetryTimer()
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (port) return
      retryCount += 1
      requestPort()
      schedulePortRetry()
    }, PORT_RETRY_MS)
  }

  function resetPortConnection(): void {
    clearRetryTimer()
    if (port) {
      try {
        port.onmessage = null
        port.close()
      } catch {
        /* ignore */
      }
    }
    port = null
    const disconnectError = new Error(
      'NIP-07 bridge disconnected — reload the page',
    )
    rejectPortReady?.(disconnectError)
    portReady = null
    resolvePortReady = null
    rejectPortReady = null
    retryCount = 0
    for (const [id, entry] of pending) {
      clearTimeout(entry.timeoutId)
      pending.delete(id)
      entry.reject(disconnectError)
    }
    void ensurePortReadyPromise()
    requestPort()
    schedulePortRetry()
  }

  function acceptPort(next: MessagePort): void {
    if (port) return
    clearRetryTimer()
    port = next
    port.onmessage = (event: MessageEvent<unknown>) => {
      const message = parseNip07PortInbound(event.data)
      if (!message) return
      if (message.type === 'account-changed') {
        window.dispatchEvent(
          new CustomEvent('nostr:accountChanged', {
            detail: { pubkey: message.pubkey },
          }),
        )
        return
      }
      const entry = pending.get(message.id)
      if (!entry) return
      clearTimeout(entry.timeoutId)
      pending.delete(message.id)
      if (message.error) entry.reject(new Error(message.error))
      else entry.resolve(message.result)
    }
    port.start()
    resolvePortReady?.(port)
    resolvePortReady = null
    rejectPortReady = null
  }

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return
    if (event.origin !== window.location.origin) return
    if (!parseNip07PortOfferWire(event.data)) return
    if (port) return
    const offered = event.ports[0]
    if (!offered) return
    // Claim before other same-page listeners can share the transferred port.
    event.stopImmediatePropagation()
    acceptPort(offered)
  })

  void ensurePortReadyPromise()
  requestPort()
  schedulePortRetry()

  async function call(
    method: Nip07AllowedMethod,
    params?: unknown,
  ): Promise<unknown> {
    const activePort = port ?? (await ensurePortReadyPromise())
    return new Promise((resolve, reject) => {
      const id = randomId()
      const timeoutId = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`NIP-07 timeout: ${method}`))
      }, RPC_TIMEOUT_MS)
      pending.set(id, { resolve, reject, timeoutId })
      try {
        activePort.postMessage(createNip07PortRpcRequest(id, method, params))
      } catch {
        clearTimeout(timeoutId)
        pending.delete(id)
        resetPortConnection()
        reject(new Error('NIP-07 bridge disconnected — reload the page'))
      }
    })
  }

  window.nostr = (window.nostr || {}) as NostrProvider
  window.nostr.getPublicKey = () => call('getPublicKey', {}) as Promise<string>
  window.nostr.signEvent = (event) =>
    call('signEvent', { event }) as Promise<SignedEvent>
  window.nostr.getRelays = () =>
    call('getRelays', {}) as Promise<
      Record<string, { read: boolean; write: boolean }>
    >
  window.nostr.nip04 = {
    encrypt: (pubkey, plaintext) =>
      call('nip04Encrypt', { pubkey, plaintext }) as Promise<string>,
    decrypt: (pubkey, ciphertext) =>
      call('nip04Decrypt', { pubkey, ciphertext }) as Promise<string>,
  }
  window.nostr.nip44 = {
    encrypt: (pubkey, plaintext) =>
      call('nip44Encrypt', { pubkey, plaintext }) as Promise<string>,
    decrypt: (pubkey, ciphertext) =>
      call('nip44Decrypt', { pubkey, ciphertext }) as Promise<string>,
  }

  window.dispatchEvent(new CustomEvent('attentionx-nostr-ready'))
})()
