import { describe, expect, it } from 'vitest'
import {
  createNip07PortAccountChanged,
  createNip07PortOfferWire,
  createNip07PortRequestWire,
  createNip07PortRpcRequest,
  createNip07PortRpcResponse,
  isNip07AllowedMethod,
  parseNip07PortInbound,
  parseNip07PortOfferWire,
  parseNip07PortRequestWire,
  parseNip07PortRpcRequest,
} from './page-bridge-protocol.ts'

describe('nip07 page-bridge-protocol', () => {
  it('parses port request and offer wire messages', () => {
    expect(parseNip07PortRequestWire(createNip07PortRequestWire())).toEqual(
      createNip07PortRequestWire(),
    )
    expect(parseNip07PortOfferWire(createNip07PortOfferWire())).toEqual(
      createNip07PortOfferWire(),
    )
    expect(parseNip07PortRequestWire({ type: 'NIP07_REQUEST' })).toBeUndefined()
    expect(
      parseNip07PortOfferWire({
        type: 'attentionx-nip07-port-offer',
        source: 'other',
        version: 1,
      }),
    ).toBeUndefined()
  })

  it('accepts only allowlisted RPC methods', () => {
    expect(isNip07AllowedMethod('signEvent')).toBe(true)
    expect(isNip07AllowedMethod('getPublicKey')).toBe(true)
    expect(isNip07AllowedMethod('signMessage')).toBe(false)
    expect(
      parseNip07PortRpcRequest(
        createNip07PortRpcRequest('abc', 'getRelays', {}),
      ),
    ).toMatchObject({ id: 'abc', method: 'getRelays' })
    expect(
      parseNip07PortRpcRequest({
        ...createNip07PortRpcRequest('abc', 'getRelays', {}),
        method: 'evil',
      }),
    ).toBeUndefined()
  })

  it('parses inbound rpc-response and account-changed messages', () => {
    expect(
      parseNip07PortInbound(createNip07PortRpcResponse('id-1', { ok: true }, null)),
    ).toMatchObject({
      type: 'rpc-response',
      id: 'id-1',
      result: { ok: true },
      error: null,
    })
    expect(
      parseNip07PortInbound(
        createNip07PortRpcResponse('id-2', null, 'denied'),
      ),
    ).toMatchObject({
      type: 'rpc-response',
      id: 'id-2',
      error: 'denied',
    })
    expect(
      parseNip07PortInbound(createNip07PortAccountChanged('pubkeyhex')),
    ).toMatchObject({
      type: 'account-changed',
      pubkey: 'pubkeyhex',
    })
    expect(
      parseNip07PortInbound({
        type: 'NIP07_RESPONSE',
        id: 'id-1',
        result: 'spoofed',
      }),
    ).toBeUndefined()
  })

  it('rejects rpc-response with non-string error payloads', () => {
    expect(
      parseNip07PortInbound({
        ...createNip07PortRpcResponse('id-3', null, null),
        error: { message: 'nope' },
      }),
    ).toBeUndefined()
  })
})

describe('nip07 MessageChannel handshake smoke', () => {
  it('delivers rpc-response only on the transferred port', async () => {
    const channel = new MessageChannel()
    const received: unknown[] = []

    const done = new Promise<void>((resolve) => {
      channel.port2.onmessage = (event: MessageEvent<unknown>) => {
        received.push(event.data)
        resolve()
      }
      channel.port2.start()
    })

    channel.port1.postMessage(
      createNip07PortRpcResponse('req-1', 'pubkey', null),
    )
    await done

    expect(received).toHaveLength(1)
    expect(parseNip07PortInbound(received[0])).toMatchObject({
      type: 'rpc-response',
      id: 'req-1',
      result: 'pubkey',
    })

    channel.port1.close()
    channel.port2.close()
  })
})
