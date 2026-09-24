import { describe, expect, it } from 'vitest'
import {
  createPageWorldPortOfferWire,
  createPageWorldPortRequestWire,
  parsePageWorldPortOfferWire,
  parsePageWorldPortRequestWire,
} from './page-world-bridge-protocol'

describe('page-world bridge protocol', () => {
  it('parses request and offer wire messages', () => {
    const request = createPageWorldPortRequestWire()
    const offer = createPageWorldPortOfferWire()
    expect(parsePageWorldPortRequestWire(request)).toEqual(request)
    expect(parsePageWorldPortOfferWire(offer)).toEqual(offer)
    expect(parsePageWorldPortRequestWire(offer)).toBeUndefined()
    expect(parsePageWorldPortOfferWire(request)).toBeUndefined()
    expect(parsePageWorldPortRequestWire({ ...request, version: 99 })).toBeUndefined()
  })
})

describe('page-world MessageChannel handshake smoke', () => {
  it('transfers a MessagePort that carries application messages', async () => {
    const channel = new MessageChannel()
    const received = new Promise<unknown>((resolve) => {
      channel.port1.onmessage = (event) => resolve(event.data)
      channel.port1.start()
    })
    channel.port2.postMessage({
      source: 'attentionx-page-observer',
      type: 'observed-x-identities',
      count: 1,
    })
    await expect(received).resolves.toMatchObject({
      type: 'observed-x-identities',
      count: 1,
    })
    channel.port1.close()
    channel.port2.close()
  })
})
