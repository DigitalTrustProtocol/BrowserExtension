/**
 * Protocol between MAIN-world NIP-07 inject and isolated content bridge.
 *
 * After a one-time window.postMessage handshake that transfers a MessagePort,
 * all RPC and account-change notifications travel only on that port so
 * same-page scripts cannot forge responses by racing public NIP07_RESPONSE
 * messages.
 */

export const NIP07_PAGE_BRIDGE_SOURCE = 'attentionx-nip07' as const
export const NIP07_PAGE_BRIDGE_VERSION = 1 as const

/** window.postMessage: inject asks bridge for a MessagePort */
export const NIP07_PORT_REQUEST_TYPE = 'attentionx-nip07-port-request' as const
/** window.postMessage: bridge offers port2 via the transfer list */
export const NIP07_PORT_OFFER_TYPE = 'attentionx-nip07-port-offer' as const

export const NIP07_ALLOWED_METHODS = [
  'getPublicKey',
  'signEvent',
  'getRelays',
  'nip04Encrypt',
  'nip04Decrypt',
  'nip44Encrypt',
  'nip44Decrypt',
] as const

export type Nip07AllowedMethod = (typeof NIP07_ALLOWED_METHODS)[number]

export type Nip07PortRequestWire = {
  source: typeof NIP07_PAGE_BRIDGE_SOURCE
  version: typeof NIP07_PAGE_BRIDGE_VERSION
  type: typeof NIP07_PORT_REQUEST_TYPE
}

export type Nip07PortOfferWire = {
  source: typeof NIP07_PAGE_BRIDGE_SOURCE
  version: typeof NIP07_PAGE_BRIDGE_VERSION
  type: typeof NIP07_PORT_OFFER_TYPE
}

export type Nip07PortRpcRequest = {
  source: typeof NIP07_PAGE_BRIDGE_SOURCE
  version: typeof NIP07_PAGE_BRIDGE_VERSION
  type: 'rpc-request'
  id: string
  method: Nip07AllowedMethod
  params: unknown
}

export type Nip07PortRpcResponse = {
  source: typeof NIP07_PAGE_BRIDGE_SOURCE
  version: typeof NIP07_PAGE_BRIDGE_VERSION
  type: 'rpc-response'
  id: string
  result?: unknown
  error?: string | null
}

export type Nip07PortAccountChanged = {
  source: typeof NIP07_PAGE_BRIDGE_SOURCE
  version: typeof NIP07_PAGE_BRIDGE_VERSION
  type: 'account-changed'
  pubkey?: string
}

export type Nip07PortInbound =
  | Nip07PortRpcResponse
  | Nip07PortAccountChanged

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isBridgeEnvelope(value: Record<string, unknown>): boolean {
  return (
    value.source === NIP07_PAGE_BRIDGE_SOURCE &&
    value.version === NIP07_PAGE_BRIDGE_VERSION
  )
}

export function isNip07AllowedMethod(
  method: unknown,
): method is Nip07AllowedMethod {
  return (
    typeof method === 'string' &&
    (NIP07_ALLOWED_METHODS as readonly string[]).includes(method)
  )
}

export function parseNip07PortRequestWire(
  value: unknown,
): Nip07PortRequestWire | undefined {
  if (!isRecord(value) || !isBridgeEnvelope(value)) return undefined
  if (value.type !== NIP07_PORT_REQUEST_TYPE) return undefined
  return {
    source: NIP07_PAGE_BRIDGE_SOURCE,
    version: NIP07_PAGE_BRIDGE_VERSION,
    type: NIP07_PORT_REQUEST_TYPE,
  }
}

export function parseNip07PortOfferWire(
  value: unknown,
): Nip07PortOfferWire | undefined {
  if (!isRecord(value) || !isBridgeEnvelope(value)) return undefined
  if (value.type !== NIP07_PORT_OFFER_TYPE) return undefined
  return {
    source: NIP07_PAGE_BRIDGE_SOURCE,
    version: NIP07_PAGE_BRIDGE_VERSION,
    type: NIP07_PORT_OFFER_TYPE,
  }
}

export function parseNip07PortInbound(
  value: unknown,
): Nip07PortInbound | undefined {
  if (!isRecord(value) || !isBridgeEnvelope(value)) return undefined
  if (value.type === 'rpc-response') {
    if (typeof value.id !== 'string' || value.id.length === 0) return undefined
    if (
      value.error !== undefined &&
      value.error !== null &&
      typeof value.error !== 'string'
    ) {
      return undefined
    }
    return {
      source: NIP07_PAGE_BRIDGE_SOURCE,
      version: NIP07_PAGE_BRIDGE_VERSION,
      type: 'rpc-response',
      id: value.id,
      result: value.result,
      error: typeof value.error === 'string' ? value.error : null,
    }
  }
  if (value.type === 'account-changed') {
    if (value.pubkey !== undefined && typeof value.pubkey !== 'string') {
      return undefined
    }
    return {
      source: NIP07_PAGE_BRIDGE_SOURCE,
      version: NIP07_PAGE_BRIDGE_VERSION,
      type: 'account-changed',
      pubkey: value.pubkey,
    }
  }
  return undefined
}

export function parseNip07PortRpcRequest(
  value: unknown,
): Nip07PortRpcRequest | undefined {
  if (!isRecord(value) || !isBridgeEnvelope(value)) return undefined
  if (value.type !== 'rpc-request') return undefined
  if (typeof value.id !== 'string' || value.id.length === 0) return undefined
  if (!isNip07AllowedMethod(value.method)) return undefined
  return {
    source: NIP07_PAGE_BRIDGE_SOURCE,
    version: NIP07_PAGE_BRIDGE_VERSION,
    type: 'rpc-request',
    id: value.id,
    method: value.method,
    params: value.params ?? {},
  }
}

export function createNip07PortRequestWire(): Nip07PortRequestWire {
  return {
    source: NIP07_PAGE_BRIDGE_SOURCE,
    version: NIP07_PAGE_BRIDGE_VERSION,
    type: NIP07_PORT_REQUEST_TYPE,
  }
}

export function createNip07PortOfferWire(): Nip07PortOfferWire {
  return {
    source: NIP07_PAGE_BRIDGE_SOURCE,
    version: NIP07_PAGE_BRIDGE_VERSION,
    type: NIP07_PORT_OFFER_TYPE,
  }
}

export function createNip07PortRpcRequest(
  id: string,
  method: Nip07AllowedMethod,
  params: unknown,
): Nip07PortRpcRequest {
  return {
    source: NIP07_PAGE_BRIDGE_SOURCE,
    version: NIP07_PAGE_BRIDGE_VERSION,
    type: 'rpc-request',
    id,
    method,
    params: params ?? {},
  }
}

export function createNip07PortRpcResponse(
  id: string,
  result: unknown,
  error: string | null,
): Nip07PortRpcResponse {
  return {
    source: NIP07_PAGE_BRIDGE_SOURCE,
    version: NIP07_PAGE_BRIDGE_VERSION,
    type: 'rpc-response',
    id,
    result,
    error,
  }
}

export function createNip07PortAccountChanged(
  pubkey: string | undefined,
): Nip07PortAccountChanged {
  return {
    source: NIP07_PAGE_BRIDGE_SOURCE,
    version: NIP07_PAGE_BRIDGE_VERSION,
    type: 'account-changed',
    pubkey,
  }
}
