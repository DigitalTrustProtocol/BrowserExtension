/**
 * MAIN-world hub: requests a capability-bound MessagePort from the content
 * script and routes all page↔content AttentionX traffic over it.
 */

import {
  createPageWorldPortRequestWire,
  parsePageWorldPortOfferWire,
} from '../shared/page-world-bridge-protocol'

export type PageWorldMessageHandler = (data: unknown) => void

export interface PageWorldPagePort {
  post(data: unknown): void
  subscribe(handler: PageWorldMessageHandler): () => void
  /** Resolves once the content script has transferred a MessagePort. */
  whenReady(timeoutMs?: number): Promise<void>
  stop(): void
}

let hub: PageWorldPagePort | undefined

export function ensurePageWorldPagePort(
  targetWindow: Window = window,
): PageWorldPagePort {
  if (hub) return hub

  const PORT_RETRY_MS = 50
  const PORT_RETRY_MAX = 40

  const handlers = new Set<PageWorldMessageHandler>()
  const outboundQueue: unknown[] = []
  let port: MessagePort | null = null
  let stopped = false
  let retryCount = 0
  let retryTimer: number | undefined
  let readyResolve: (() => void) | undefined
  let readyReject: ((reason: Error) => void) | undefined
  let readyPromise: Promise<void> | undefined

  function deliver(data: unknown): void {
    for (const handler of handlers) {
      try {
        handler(data)
      } catch {
        /* ignore subscriber errors */
      }
    }
  }

  function flushQueue(): void {
    if (!port) return
    while (outboundQueue.length > 0) {
      const next = outboundQueue.shift()
      try {
        port.postMessage(next)
      } catch {
        port = null
        outboundQueue.unshift(next)
        return
      }
    }
  }

  function clearRetryTimer(): void {
    if (retryTimer !== undefined) {
      targetWindow.clearTimeout(retryTimer)
      retryTimer = undefined
    }
  }

  function requestPort(): void {
    if (stopped || port) return
    targetWindow.postMessage(
      createPageWorldPortRequestWire(),
      targetWindow.location.origin,
    )
  }

  function schedulePortRetry(): void {
    if (stopped || port || retryCount >= PORT_RETRY_MAX) return
    clearRetryTimer()
    retryTimer = targetWindow.setTimeout(() => {
      retryTimer = undefined
      if (stopped || port) return
      retryCount += 1
      requestPort()
      schedulePortRetry()
    }, PORT_RETRY_MS)
  }

  function claimPort(next: MessagePort): void {
    if (stopped || port) {
      try {
        next.close()
      } catch {
        /* ignore */
      }
      return
    }
    port = next
    clearRetryTimer()
    port.onmessage = (event: MessageEvent<unknown>) => {
      deliver(event.data)
    }
    port.start()
    flushQueue()
    readyResolve?.()
    readyResolve = undefined
    readyReject = undefined
  }

  const onOffer = (event: MessageEvent): void => {
    if (stopped) return
    if (event.source !== targetWindow) return
    if (event.origin !== targetWindow.location.origin) return
    if (!parsePageWorldPortOfferWire(event.data)) return
    const next = event.ports[0]
    if (!next) return
    // Claim before other same-page listeners can observe the transferred port.
    event.stopImmediatePropagation()
    claimPort(next)
  }

  targetWindow.addEventListener('message', onOffer)
  requestPort()
  schedulePortRetry()

  hub = {
    post(data) {
      if (stopped) return
      if (port) {
        try {
          port.postMessage(data)
          return
        } catch {
          port = null
        }
      }
      if (outboundQueue.length < 200) outboundQueue.push(data)
    },
    subscribe(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    whenReady(timeoutMs = 5_000) {
      if (port) return Promise.resolve()
      if (!readyPromise) {
        readyPromise = new Promise<void>((resolve, reject) => {
          readyResolve = resolve
          readyReject = reject
        })
      }
      return new Promise<void>((resolve, reject) => {
        const timer = targetWindow.setTimeout(() => {
          reject(new Error('Page-world bridge port timeout'))
        }, timeoutMs)
        void readyPromise!
          .then(() => {
            targetWindow.clearTimeout(timer)
            resolve()
          })
          .catch((error: unknown) => {
            targetWindow.clearTimeout(timer)
            reject(error instanceof Error ? error : new Error(String(error)))
          })
      })
    },
    stop() {
      stopped = true
      clearRetryTimer()
      targetWindow.removeEventListener('message', onOffer)
      if (port) {
        try {
          port.onmessage = null
          port.close()
        } catch {
          /* ignore */
        }
      }
      port = null
      outboundQueue.length = 0
      handlers.clear()
      readyReject?.(new Error('Page-world bridge stopped'))
      readyResolve = undefined
      readyReject = undefined
      readyPromise = undefined
      hub = undefined
    },
  }

  return hub
}
