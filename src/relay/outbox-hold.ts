/** Regret window before outbox items are offered to relays. */
export const OUTBOX_HOLD_MS = 5 * 60 * 1000

/**
 * How long a flush may hold an event-relay claim before another flush can
 * reclaim it (covers service-worker death mid-publish).
 */
export const OUTBOX_CLAIM_TTL_MS = 5 * 60 * 1000

/** chrome.alarms name for releasing held outbox publishes. */
export const OUTBOX_HOLD_ALARM = 'attentionx-outbox-hold'

export function outboxHoldUntil(now = Date.now()): number {
  return now + OUTBOX_HOLD_MS
}

export function isOutboxClaimActive(
  claimedAt: number | undefined,
  now: number,
  ttlMs = OUTBOX_CLAIM_TTL_MS,
): boolean {
  return (
    claimedAt !== undefined &&
    Number.isFinite(claimedAt) &&
    now - claimedAt < ttlMs
  )
}
