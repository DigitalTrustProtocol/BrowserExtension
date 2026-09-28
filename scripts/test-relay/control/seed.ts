import type { Event } from 'nostr-tools'

export interface ParsedSeed {
  events: Event[]
  malformed: number
}

/** JSON array, or `{ "events": [...] }`. Extra local fields are dropped. */
export function parseSeedDocument(text: string): ParsedSeed {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new Error('Seed file must be JSON')
  }
  const rows = seedRows(parsed)
  const events: Event[] = []
  let malformed = 0
  for (const row of rows) {
    const event = portableEvent(row)
    if (!event) {
      malformed += 1
      continue
    }
    events.push(event)
  }
  events.sort(compareSeedEvents)
  return { events, malformed }
}

export function compareSeedEvents(left: Event, right: Event): number {
  if (left.created_at !== right.created_at) return left.created_at - right.created_at
  if (left.id < right.id) return -1
  if (left.id > right.id) return 1
  return 0
}

function seedRows(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const events = (parsed as { events?: unknown }).events
    if (Array.isArray(events)) return events
  }
  throw new Error('Seed file must be a JSON array or { "events": [...] }')
}

function portableEvent(value: unknown): Event | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.pubkey !== 'string') return undefined
  const createdAt = row.created_at
  const kind = row.kind
  if (typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt)) return undefined
  if (typeof kind !== 'number' || !Number.isSafeInteger(kind)) return undefined
  if (typeof row.content !== 'string' || typeof row.sig !== 'string') return undefined
  if (!Array.isArray(row.tags)) return undefined
  const tags: string[][] = []
  for (const tag of row.tags) {
    if (!Array.isArray(tag) || !tag.every((part) => typeof part === 'string')) {
      return undefined
    }
    tags.push([...tag])
  }
  return {
    id: row.id,
    pubkey: row.pubkey,
    created_at: createdAt,
    kind,
    tags,
    content: row.content,
    sig: row.sig,
  }
}
