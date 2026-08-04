/**
 * Handshake protocol between MAIN-world page observer and isolated content
 * bridges. After a one-time window.postMessage that transfers a MessagePort,
 * identity / proof / JSON-filter traffic travels only on that port so
 * same-page scripts cannot forge observations or proof results.
 */

export const PAGE_WORLD_BRIDGE_SOURCE = 'attentionx-page-world' as const
export const PAGE_WORLD_BRIDGE_VERSION = 1 as const

/** window.postMessage: page asks content for a MessagePort */
export const PAGE_WORLD_PORT_REQUEST_TYPE =
  'attentionx-page-world-port-request' as const
/** window.postMessage: content offers port2 via the transfer list */
export const PAGE_WORLD_PORT_OFFER_TYPE =
  'attentionx-page-world-port-offer' as const

export type PageWorldPortRequestWire = {
  source: typeof PAGE_WORLD_BRIDGE_SOURCE
  version: typeof PAGE_WORLD_BRIDGE_VERSION
  type: typeof PAGE_WORLD_PORT_REQUEST_TYPE
}

export type PageWorldPortOfferWire = {
  source: typeof PAGE_WORLD_BRIDGE_SOURCE
  version: typeof PAGE_WORLD_BRIDGE_VERSION
  type: typeof PAGE_WORLD_PORT_OFFER_TYPE
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isBridgeEnvelope(value: Record<string, unknown>): boolean {
  return (
    value.source === PAGE_WORLD_BRIDGE_SOURCE &&
    value.version === PAGE_WORLD_BRIDGE_VERSION
  )
}

export function parsePageWorldPortRequestWire(
  value: unknown,
): PageWorldPortRequestWire | undefined {
  if (!isRecord(value) || !isBridgeEnvelope(value)) return undefined
  if (value.type !== PAGE_WORLD_PORT_REQUEST_TYPE) return undefined
  return {
    source: PAGE_WORLD_BRIDGE_SOURCE,
    version: PAGE_WORLD_BRIDGE_VERSION,
    type: PAGE_WORLD_PORT_REQUEST_TYPE,
  }
}

export function parsePageWorldPortOfferWire(
  value: unknown,
): PageWorldPortOfferWire | undefined {
  if (!isRecord(value) || !isBridgeEnvelope(value)) return undefined
  if (value.type !== PAGE_WORLD_PORT_OFFER_TYPE) return undefined
  return {
    source: PAGE_WORLD_BRIDGE_SOURCE,
    version: PAGE_WORLD_BRIDGE_VERSION,
    type: PAGE_WORLD_PORT_OFFER_TYPE,
  }
}

export function createPageWorldPortRequestWire(): PageWorldPortRequestWire {
  return {
    source: PAGE_WORLD_BRIDGE_SOURCE,
    version: PAGE_WORLD_BRIDGE_VERSION,
    type: PAGE_WORLD_PORT_REQUEST_TYPE,
  }
}

export function createPageWorldPortOfferWire(): PageWorldPortOfferWire {
  return {
    source: PAGE_WORLD_BRIDGE_SOURCE,
    version: PAGE_WORLD_BRIDGE_VERSION,
    type: PAGE_WORLD_PORT_OFFER_TYPE,
  }
}
