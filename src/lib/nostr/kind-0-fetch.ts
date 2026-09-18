import {
  getEventHash,
  validateEvent,
  verifyEvent,
  type Event,
  type Filter,
} from 'nostr-tools'
import { SimplePoolAdapter } from '../../background/adapters.ts'
import { parseKind0Content } from './kind-0.ts'

const AUTHOR_BATCH = 20
const KIND0_LIMIT_PER_AUTHOR = 1

export type Kind0QueryEvents = (
  relayUrls: readonly string[],
  filter: Filter,
  signal?: AbortSignal,
) => Promise<Event[]>

export interface Kind0Winner {
  metadata: Record<string, unknown>
  createdAt: number
  eventId: string
}

let queryEventsImpl: Kind0QueryEvents | undefined
let fallbackAdapter: SimplePoolAdapter | undefined
const inFlight = new Map<string, Promise<Map<string, Kind0Winner>>>()

export function setKind0QueryEvents(query: Kind0QueryEvents): void {
  queryEventsImpl = query
}

function resolveQuery(): Kind0QueryEvents {
  if (queryEventsImpl) return queryEventsImpl
  fallbackAdapter ??= new SimplePoolAdapter()
  return (relayUrls, filter, signal) =>
    fallbackAdapter!.queryEvents(relayUrls, filter, signal)
}

function uniqueHexPubkeys(pubkeys: readonly string[]): string[] {
  return [
    ...new Set(
      pubkeys
        .map((pubkey) => pubkey.trim().toLowerCase())
        .filter((pubkey) => /^[0-9a-f]{64}$/.test(pubkey)),
    ),
  ].sort()
}

function isNewerKind0(next: Event, current: Kind0Winner | undefined): boolean {
  if (!current) return true
  if (next.created_at !== current.createdAt) {
    return next.created_at > current.createdAt
  }
  return next.id < current.eventId
}

function acceptKind0(event: Event): Record<string, unknown> | null {
  if (event.kind !== 0) return null
  if (!validateEvent(event)) return null
  if (getEventHash(event) !== event.id || !verifyEvent(event)) return null
  return parseKind0Content(event.content)
}

export async function fetchKind0Batch(input: {
  pubkeys: readonly string[]
  relayUrls: readonly string[]
  signal?: AbortSignal
}): Promise<Map<string, Kind0Winner>> {
  const authors = uniqueHexPubkeys(input.pubkeys)
  const relays = [...new Set(input.relayUrls.filter(Boolean))]
  if (authors.length === 0 || relays.length === 0) return new Map()
  const key = `${relays.join(',')}|${authors.join(',')}`
  const pending = inFlight.get(key)
  if (pending) return pending

  const work = (async () => {
    const winners = new Map<string, Kind0Winner>()
    const query = resolveQuery()
    for (let index = 0; index < authors.length; index += AUTHOR_BATCH) {
      if (input.signal?.aborted) break
      const batch = authors.slice(index, index + AUTHOR_BATCH)
      const filter: Filter = {
        kinds: [0],
        authors: batch,
        limit: Math.max(batch.length * KIND0_LIMIT_PER_AUTHOR, batch.length),
      }
      let events: Event[]
      try {
        events = await query(relays, filter, input.signal)
      } catch {
        continue
      }
      for (const event of events) {
        const metadata = acceptKind0(event)
        if (!metadata) continue
        const pubkey = event.pubkey.trim().toLowerCase()
        const current = winners.get(pubkey)
        if (!isNewerKind0(event, current)) continue
        winners.set(pubkey, {
          metadata,
          createdAt: event.created_at,
          eventId: event.id,
        })
      }
    }
    return winners
  })()

  inFlight.set(key, work)
  try {
    return await work
  } finally {
    inFlight.delete(key)
  }
}
