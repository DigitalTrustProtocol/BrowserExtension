import type { Event } from 'nostr-tools'

export type EventStorageClass =
  | 'regular'
  | 'replaceable'
  | 'addressable'
  | 'ephemeral'

/** NIP-01 kind classes. Kind 5 is a regular event that also deletes. */
export function storageClass(kind: number): EventStorageClass {
  if (kind === 0 || kind === 3 || (kind >= 10_000 && kind < 20_000)) {
    return 'replaceable'
  }
  if (kind >= 20_000 && kind < 30_000) return 'ephemeral'
  if (kind >= 30_000 && kind < 40_000) return 'addressable'
  return 'regular'
}

export function addressableD(event: Event): string {
  for (const tag of event.tags) {
    if (tag[0] === 'd') return tag[1] ?? ''
  }
  return ''
}

export function replaceableKey(event: Event): string {
  return `${event.pubkey}:${event.kind}`
}

export function addressableKey(event: Event): string {
  return `${event.kind}:${event.pubkey}:${addressableD(event)}`
}

/**
 * Newer `created_at` wins. Equal timestamps keep the lowest id (NIP-01).
 * Same id is not newer.
 */
export function isNewerStoredEvent(candidate: Event, current: Event): boolean {
  if (candidate.id === current.id) return false
  if (candidate.created_at !== current.created_at) {
    return candidate.created_at > current.created_at
  }
  return candidate.id < current.id
}

/** Newest first. Equal timestamps break ties by ascending id so paging is stable. */
export function compareNewestFirst(left: Event, right: Event): number {
  if (left.created_at !== right.created_at) {
    return right.created_at - left.created_at
  }
  if (left.id < right.id) return -1
  if (left.id > right.id) return 1
  return 0
}
