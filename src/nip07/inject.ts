/**
 * Page-context NIP-07 provider (no WebLN / payments).
 * Runs in MAIN world. Signing happens in the background service worker.
 */

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

  function randomId(): string {
    const buf = new Uint8Array(16)
    crypto.getRandomValues(buf)
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
  }

  function createChannel(
    msgType: string,
    responseType: string,
    timeoutMs: number,
  ) {
    const pending = new Map<string, PendingEntry>()

    function call(method: string, params?: unknown): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const id = randomId()
        const timeoutId = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`${msgType} timeout: ${method}`))
        }, timeoutMs)
        pending.set(id, { resolve, reject, timeoutId })
        window.postMessage(
          { type: msgType, id, method, params },
          window.location.origin,
        )
      })
    }

    function handleResponse(ev: MessageEvent): void {
      if (ev.data?.type !== responseType) return
      const entry = pending.get(ev.data.id)
      if (!entry) return
      clearTimeout(entry.timeoutId)
      pending.delete(ev.data.id)
      if (ev.data.error) entry.reject(new Error(ev.data.error))
      else entry.resolve(ev.data.result)
    }

    return { call, handleResponse }
  }

  const nip07 = createChannel('NIP07_REQUEST', 'NIP07_RESPONSE', 120_000)

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return
    nip07.handleResponse(event)
    if (event.data?.type === 'NOSTR_ACCOUNT_CHANGED') {
      window.dispatchEvent(
        new CustomEvent('nostr:accountChanged', {
          detail: { pubkey: event.data.pubkey },
        }),
      )
    }
  })

  window.nostr = (window.nostr || {}) as NostrProvider
  window.nostr.getPublicKey = () =>
    nip07.call('getPublicKey', {}) as Promise<string>
  window.nostr.signEvent = (event) =>
    nip07.call('signEvent', { event }) as Promise<SignedEvent>
  window.nostr.getRelays = () =>
    nip07.call('getRelays', {}) as Promise<
      Record<string, { read: boolean; write: boolean }>
    >
  window.nostr.nip04 = {
    encrypt: (pubkey, plaintext) =>
      nip07.call('nip04Encrypt', { pubkey, plaintext }) as Promise<string>,
    decrypt: (pubkey, ciphertext) =>
      nip07.call('nip04Decrypt', { pubkey, ciphertext }) as Promise<string>,
  }
  window.nostr.nip44 = {
    encrypt: (pubkey, plaintext) =>
      nip07.call('nip44Encrypt', { pubkey, plaintext }) as Promise<string>,
    decrypt: (pubkey, ciphertext) =>
      nip07.call('nip44Decrypt', { pubkey, ciphertext }) as Promise<string>,
  }

  window.dispatchEvent(new CustomEvent('attentionx-nostr-ready'))
})()
