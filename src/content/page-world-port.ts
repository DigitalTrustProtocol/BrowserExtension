/**
 * Isolated-world hub: capability-bound MessagePort ↔ MAIN-world page observer.
 */

import {
  createPageWorldPortOfferWire,
  parsePageWorldPortRequestWire,
} from '../shared/page-world-bridge-protocol'

export type PageWorldMessageHandler = (data: unknown) => void

export interface PageWorldContentPort {
  post(data: unknown): void
  subscribe(handler: PageWorldMessageHandler): () => void
  stop(): void
}

let hub: PageWorldContentPort | undefined

/**
 * Singleton content-side port hub. First call installs the handshake listener.
 */
export function ensurePageWorldContentPort(
  targetWindow: Window = window,
): PageWorldContentPort {
  if (hub) return hub

  const handlers = new Set<PageWorldMessageHandler>()
  const pagePorts = new Set<MessagePort>()
  let stopped = false

  function deliver(data: unknown): void {
    for (const handler of handlers) {
      try {
        handler(data)
      } catch {
        /* ignore subscriber errors */
      }
    }
  }

  function attachPagePort(pagePort: MessagePort): void {
    pagePorts.add(pagePort)
    pagePort.onmessage = (event: MessageEvent<unknown>) => {
      deliver(event.data)
    }
    pagePort.start()
  }

  function offerPort(): void {
    if (stopped) return
    // Avoid unbounded channels if the page retries while an offer is in flight.
    if (pagePorts.size >= 3) return
    const channel = new MessageChannel()
    attachPagePort(channel.port1)
    targetWindow.postMessage(
      createPageWorldPortOfferWire(),
      targetWindow.location.origin,
      [channel.port2],
    )
  }

  const onHandshake = (event: MessageEvent): void => {
    if (stopped) return
    if (event.source !== targetWindow) return
    if (event.origin !== targetWindow.location.origin) return
    if (!parsePageWorldPortRequestWire(event.data)) return
    offerPort()
  }

  targetWindow.addEventListener('message', onHandshake)

  hub = {
    post(data) {
      if (stopped) return
      for (const pagePort of pagePorts) {
        try {
          pagePort.postMessage(data)
        } catch {
          pagePorts.delete(pagePort)
        }
      }
    },
    subscribe(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    stop() {
      stopped = true
      targetWindow.removeEventListener('message', onHandshake)
      for (const pagePort of pagePorts) {
        try {
          pagePort.onmessage = null
          pagePort.close()
        } catch {
          /* ignore */
        }
      }
      pagePorts.clear()
      handlers.clear()
      hub = undefined
    },
  }

  return hub
}
