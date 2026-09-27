import { verifyEvent, type Event } from 'nostr-tools'
import {
  addressableKey,
  isNewerStoredEvent,
  replaceableKey,
  storageClass,
} from './classify.ts'
import { queryFilter } from './filter.ts'
import { DEFAULT_RELAY_LIMITS, type RelayLimits } from './limits.ts'
import type { Filter } from 'nostr-tools'

export type RejectReason =
  | `duplicate: ${string}`
  | `invalid: ${string}`
  | `blocked: ${string}`
  | `rate-limited: ${string}`
  | `error: ${string}`

export type AcceptResult =
  | { ok: true; stored: boolean; replacedId?: string }
  | { ok: false; reason: RejectReason }

const HEX_64 = /^[0-9a-f]{64}$/
const HEX_128 = /^[0-9a-f]{128}$/

/**
 * In-memory NIP-01 store. Replaceable and addressable kinds keep one winner.
 * Ephemeral events are not stored. Kind 5 deletes the author's own events.
 */
export class EventStore {
  readonly #limits: RelayLimits
  #events: Event[] = []
  #indexById = new Map<string, number>()
  #replaceable = new Map<string, string>()
  #addressable = new Map<string, string>()
  #deletedIds = new Set<string>()
  /** Addressable coordinate -> deletion `created_at`. Older events stay rejected. */
  #deletedAddresses = new Map<string, number>()

  constructor(limits: RelayLimits = DEFAULT_RELAY_LIMITS) {
    this.#limits = limits
  }

  get size(): number {
    return this.#events.length
  }

  get limits(): RelayLimits {
    return this.#limits
  }

  snapshot(): Event[] {
    return this.#events.map((event) => structuredClone(event))
  }

  reset(): void {
    this.#events = []
    this.#indexById.clear()
    this.#replaceable.clear()
    this.#addressable.clear()
    this.#deletedIds.clear()
    this.#deletedAddresses.clear()
  }

  /** Insert already-validated winners. Used by snapshot load. */
  replaceAll(events: readonly Event[]): void {
    this.reset()
    for (const event of events) {
      this.#insert(event)
    }
  }

  query(filter: Filter): Event[] {
    return queryFilter(this.#events, filter, this.#limits)
  }

  accept(event: Event, verify: boolean): AcceptResult {
    const invalid = validateShape(event, this.#limits)
    if (invalid) return { ok: false, reason: invalid }
    if (this.#deletedIds.has(event.id)) {
      return { ok: false, reason: 'blocked: deleted' }
    }
    if (verify && !verifyEvent(withoutVerifiedCache(event))) {
      return { ok: false, reason: 'invalid: signature' }
    }
    if (this.#indexById.has(event.id)) {
      return { ok: false, reason: 'duplicate: already have this event' }
    }

    const kindClass = storageClass(event.kind)
    if (kindClass === 'ephemeral') {
      return { ok: true, stored: false }
    }

    if (kindClass === 'replaceable') {
      return this.#acceptReplaceable(event)
    }
    if (kindClass === 'addressable') {
      return this.#acceptAddressable(event)
    }
    this.#insert(event)
    if (event.kind === 5) this.#applyDeletion(event)
    return { ok: true, stored: true }
  }

  #acceptReplaceable(event: Event): AcceptResult {
    const key = replaceableKey(event)
    const currentId = this.#replaceable.get(key)
    if (currentId) {
      const current = this.#events[this.#indexById.get(currentId)!]
      if (!current || !isNewerStoredEvent(event, current)) {
        return { ok: false, reason: 'blocked: replaced by a newer event' }
      }
      this.#removeId(currentId)
      this.#insert(event)
      return { ok: true, stored: true, replacedId: currentId }
    }
    this.#insert(event)
    return { ok: true, stored: true }
  }

  #acceptAddressable(event: Event): AcceptResult {
    const key = addressableKey(event)
    const deletedAt = this.#deletedAddresses.get(key)
    if (deletedAt !== undefined && event.created_at <= deletedAt) {
      return { ok: false, reason: 'blocked: deleted' }
    }
    const currentId = this.#addressable.get(key)
    if (currentId) {
      const current = this.#events[this.#indexById.get(currentId)!]
      if (!current || !isNewerStoredEvent(event, current)) {
        return { ok: false, reason: 'blocked: replaced by a newer event' }
      }
      this.#removeId(currentId)
      this.#insert(event)
      return { ok: true, stored: true, replacedId: currentId }
    }
    this.#insert(event)
    return { ok: true, stored: true }
  }

  #applyDeletion(event: Event): void {
    for (const tag of event.tags) {
      if (tag[0] === 'e' && tag[1]) {
        const target = this.#eventById(tag[1])
        if (
          target &&
          target.pubkey === event.pubkey &&
          target.created_at <= event.created_at
        ) {
          this.#deletedIds.add(target.id)
          this.#removeId(target.id)
        }
      }
      if (tag[0] === 'a' && tag[1]) {
        const parsed = parseAddressTag(tag[1])
        if (!parsed || parsed.pubkey !== event.pubkey) continue
        const previous = this.#deletedAddresses.get(tag[1]) ?? 0
        this.#deletedAddresses.set(tag[1], Math.max(previous, event.created_at))
        const currentId = this.#addressable.get(tag[1])
        if (!currentId) continue
        const current = this.#eventById(currentId)
        if (
          current &&
          current.pubkey === event.pubkey &&
          current.created_at <= event.created_at
        ) {
          this.#deletedIds.add(current.id)
          this.#removeId(current.id)
        }
      }
    }
  }

  #eventById(id: string): Event | undefined {
    const index = this.#indexById.get(id)
    return index === undefined ? undefined : this.#events[index]
  }

  #insert(event: Event): void {
    const index = this.#events.length
    this.#events.push(event)
    this.#indexById.set(event.id, index)
    const kindClass = storageClass(event.kind)
    if (kindClass === 'replaceable') {
      this.#replaceable.set(replaceableKey(event), event.id)
    } else if (kindClass === 'addressable') {
      this.#addressable.set(addressableKey(event), event.id)
    }
  }

  #removeId(id: string): void {
    const index = this.#indexById.get(id)
    if (index === undefined) return
    const event = this.#events[index]
    if (!event) return
    const last = this.#events.length - 1
    const swapped = this.#events[last]
    this.#events.pop()
    this.#indexById.delete(id)
    if (swapped && index !== last) {
      this.#events[index] = swapped
      this.#indexById.set(swapped.id, index)
    }
    const kindClass = storageClass(event.kind)
    if (kindClass === 'replaceable') {
      const key = replaceableKey(event)
      if (this.#replaceable.get(key) === id) this.#replaceable.delete(key)
    } else if (kindClass === 'addressable') {
      const key = addressableKey(event)
      if (this.#addressable.get(key) === id) this.#addressable.delete(key)
    }
  }
}

function validateShape(event: Event, limits: RelayLimits): RejectReason | undefined {
  if (!event || typeof event !== 'object') return 'invalid: event required'
  if (typeof event.id !== 'string' || !HEX_64.test(event.id)) {
    return 'invalid: id'
  }
  if (typeof event.pubkey !== 'string' || !HEX_64.test(event.pubkey)) {
    return 'invalid: pubkey'
  }
  if (typeof event.sig !== 'string' || !HEX_128.test(event.sig)) {
    return 'invalid: sig'
  }
  if (!Number.isSafeInteger(event.kind) || event.kind < 0 || event.kind > 65535) {
    return 'invalid: kind'
  }
  if (!Number.isSafeInteger(event.created_at) || event.created_at < 0) {
    return 'invalid: created_at'
  }
  if (limits.maxFutureSeconds > 0) {
    const latest = Math.floor(Date.now() / 1000) + limits.maxFutureSeconds
    if (event.created_at > latest) return 'invalid: created_at too far in the future'
  }
  if (typeof event.content !== 'string') return 'invalid: content'
  if (!Array.isArray(event.tags)) return 'invalid: tags'
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag.some((part) => typeof part !== 'string')) {
      return 'invalid: tags'
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(event))
  if (bytes > limits.maxEventBytes) return 'invalid: event too large'
  return undefined
}

/** nostr-tools caches `verifyEvent` on a symbol. A copied event keeps a stale `true`. */
function withoutVerifiedCache(event: Event): Event {
  const copy = { ...event, tags: event.tags.map((tag) => [...tag]) }
  for (const key of Object.getOwnPropertySymbols(copy)) {
    delete (copy as unknown as Record<symbol, unknown>)[key]
  }
  return copy
}

function parseAddressTag(
  value: string,
): { kind: number; pubkey: string; d: string } | undefined {
  const [kindText, pubkey, ...rest] = value.split(':')
  const kind = Number(kindText)
  if (!Number.isInteger(kind) || !pubkey || !HEX_64.test(pubkey)) return undefined
  return { kind, pubkey, d: rest.join(':') }
}
