import type { Event, Filter } from 'nostr-tools'
import { compareNewestFirst } from './classify.ts'
import type { RelayLimits } from './limits.ts'

const HEX = /^[0-9a-f]+$/

export function filterValueCount(filter: Filter): number {
  let count = 0
  if (filter.ids) count = Math.max(count, filter.ids.length)
  if (filter.authors) count = Math.max(count, filter.authors.length)
  if (filter.kinds) count = Math.max(count, filter.kinds.length)
  for (const [key, value] of Object.entries(filter)) {
    if (key.startsWith('#') && Array.isArray(value)) {
      count = Math.max(count, value.length)
    }
  }
  return count
}

export function eventMatchesFilter(event: Event, filter: Filter): boolean {
  if (filter.ids) {
    if (filter.ids.length === 0) return false
    if (!filter.ids.some((id) => prefixMatches(event.id, id))) return false
  }
  if (filter.authors) {
    if (filter.authors.length === 0) return false
    if (!filter.authors.some((author) => prefixMatches(event.pubkey, author))) {
      return false
    }
  }
  if (filter.kinds) {
    if (filter.kinds.length === 0) return false
    if (!filter.kinds.includes(event.kind)) return false
  }
  if (typeof filter.since === 'number' && event.created_at < filter.since) {
    return false
  }
  if (typeof filter.until === 'number' && event.created_at > filter.until) {
    return false
  }
  for (const [key, value] of Object.entries(filter)) {
    if (!key.startsWith('#') || !Array.isArray(value)) continue
    if (value.length === 0) return false
    const name = key.slice(1)
    const wanted = new Set(value.filter((item) => typeof item === 'string'))
    const found = event.tags.some(
      (tag) => tag[0] === name && tag[1] !== undefined && wanted.has(tag[1]),
    )
    if (!found) return false
  }
  return true
}

function prefixMatches(full: string, prefix: string): boolean {
  const needle = prefix.toLowerCase()
  if (!HEX.test(needle) || needle.length > full.length) return false
  return full.startsWith(needle)
}

/** One filter's matches, newest first, capped by `limit` and the relay max. */
export function queryFilter(
  events: readonly Event[],
  filter: Filter,
  limits: RelayLimits,
): Event[] {
  const cap = resolveLimit(filter.limit, limits.maxLimit)
  if (cap === 0) return []
  const matched: Event[] = []
  for (const event of events) {
    if (eventMatchesFilter(event, filter)) matched.push(event)
  }
  matched.sort(compareNewestFirst)
  return matched.slice(0, cap)
}

function resolveLimit(requested: number | undefined, maxLimit: number): number {
  if (requested === undefined) return maxLimit
  if (!Number.isFinite(requested) || requested < 0) return maxLimit
  return Math.min(maxLimit, Math.floor(requested))
}
