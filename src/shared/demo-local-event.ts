/**
 * Unsigned local Nostr-shaped records for Demo mode.
 * Never relayed; heap/ingest use `pubkey`, not `sig`.
 *
 * @module shared/demo-local-event
 */

import { getEventHash, type Event, type EventTemplate } from 'nostr-tools'

/** Shape-valid dummy so nostr-tools `validateEvent` accepts the record. Not a signature. */
export const UNSIGNED_DEMO_SIG = '0'.repeat(128)

export function unsignedDemoEvent(
  template: EventTemplate,
  pubkey: string,
): Event {
  const event = {
    kind: template.kind,
    created_at: template.created_at,
    tags: template.tags,
    content: template.content,
    pubkey: pubkey.trim().toLowerCase(),
  }
  return {
    ...event,
    id: getEventHash(event),
    sig: UNSIGNED_DEMO_SIG,
  }
}
