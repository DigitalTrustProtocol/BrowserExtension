/**
 * Vendored from DigitalTrustProtocol/Trust (src/lib/trust/graph/Edge.ts).
 * AttentionX: update from ITrustEvent fields directly (no nip32010 tag helpers).
 */

import type { GraphTrustValue, ITrustEvent } from './types'

export interface IEdge {
  index?: number
  addressableId: string
  author: string
  kind: number
  value: GraphTrustValue
  context: string
  createdAt: number
  eventId: string
  /** Activate — valid only when current time >= this. Undefined = valid immediately. */
  activate?: number
  /** Expire — valid only when current time <= this. Undefined = no expiry. */
  expire?: number
  content: string | undefined
  update(event: ITrustEvent): this
  /** True if edge is valid for resolution at given time (default: now). */
  isValidAt(now?: number): boolean
}

export class EdgeT1 implements IEdge {
  addressableId: string
  author: string
  kind: number
  value: GraphTrustValue = 0
  context: string = ''
  createdAt: number = 0
  eventId: string = ''
  activate?: number
  expire?: number
  index: number = 0
  content: string | undefined = undefined

  constructor(event: ITrustEvent) {
    this.kind = event.kind
    this.author = event.pubkey
    this.addressableId = event.addressableId
    this.update(event)
  }

  update(event: ITrustEvent): this {
    this.value = event.value
    this.context = event.c_tag
    this.createdAt = event.created_at
    this.eventId = event.eventId
    this.activate = event.activate
    this.expire = event.expire
    this.content = event.content
    return this
  }

  isValidAt(time?: number): boolean {
    const t = time ?? Math.floor(Date.now() / 1000)
    if (this.activate !== undefined && t < this.activate) return false
    if (this.expire !== undefined && t > this.expire) return false
    return true
  }
}
