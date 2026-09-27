import type { Event, Filter } from 'nostr-tools'
import { filterValueCount } from './filter.ts'
import type { RelayLimits } from './limits.ts'

export type ClientFrame =
  | { type: 'EVENT'; event: Event }
  | { type: 'REQ'; subscriptionId: string; filters: Filter[] }
  | { type: 'CLOSE'; subscriptionId: string }

export function parseClientFrame(
  text: string,
  limits: RelayLimits,
): { frame: ClientFrame } | { notice: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { notice: 'invalid: malformed json' }
  }
  if (!Array.isArray(parsed) || parsed.length < 2) {
    return { notice: 'invalid: expected a nostr array' }
  }
  const verb = parsed[0]
  if (verb === 'EVENT') {
    if (!isEventShape(parsed[1])) return { notice: 'invalid: bad event' }
    return { frame: { type: 'EVENT', event: parsed[1] } }
  }
  if (verb === 'CLOSE') {
    const subscriptionId = subscriptionIdOf(parsed[1])
    if (!subscriptionId) return { notice: 'invalid: subscription id' }
    return { frame: { type: 'CLOSE', subscriptionId } }
  }
  if (verb === 'REQ') {
    const subscriptionId = subscriptionIdOf(parsed[1])
    if (!subscriptionId) return { notice: 'invalid: subscription id' }
    const filters = parsed.slice(2)
    if (filters.length === 0) return { notice: 'invalid: REQ needs a filter' }
    if (filters.length > limits.maxFilters) {
      return { notice: 'invalid: too many filters' }
    }
    const normalized: Filter[] = []
    for (const filter of filters) {
      if (!isFilterShape(filter)) return { notice: 'invalid: bad filter' }
      if (filterValueCount(filter) > limits.maxFilterValues) {
        return { notice: 'invalid: too many filter values' }
      }
      normalized.push(filter)
    }
    return { frame: { type: 'REQ', subscriptionId, filters: normalized } }
  }
  return { notice: `invalid: unknown message ${String(verb)}` }
}

export function okFrame(
  eventId: string,
  accepted: boolean,
  message: string,
): string {
  return JSON.stringify(['OK', eventId, accepted, message])
}

export function eventFrame(subscriptionId: string, event: Event): string {
  return JSON.stringify(['EVENT', subscriptionId, event])
}

export function eoseFrame(subscriptionId: string): string {
  return JSON.stringify(['EOSE', subscriptionId])
}

export function closedFrame(subscriptionId: string, reason: string): string {
  return JSON.stringify(['CLOSED', subscriptionId, reason])
}

export function noticeFrame(message: string): string {
  return JSON.stringify(['NOTICE', message])
}

function subscriptionIdOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 128) return undefined
  return trimmed
}

function isEventShape(value: unknown): value is Event {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<Event>
  return (
    typeof event.id === 'string' &&
    typeof event.pubkey === 'string' &&
    typeof event.sig === 'string' &&
    typeof event.content === 'string' &&
    typeof event.kind === 'number' &&
    typeof event.created_at === 'number' &&
    Array.isArray(event.tags)
  )
}

function isFilterShape(value: unknown): value is Filter {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return true
}
