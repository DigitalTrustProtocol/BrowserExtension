/** Regret window before outbox items are offered to relays. */
export const OUTBOX_HOLD_MS = 5 * 60 * 1000

/** chrome.alarms name for releasing held outbox publishes. */
export const OUTBOX_HOLD_ALARM = 'attentionx-outbox-hold'

export function outboxHoldUntil(now = Date.now()): number {
  return now + OUTBOX_HOLD_MS
}
