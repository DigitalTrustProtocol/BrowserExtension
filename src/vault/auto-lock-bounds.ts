/**
 * Bounds for vault auto-lock timeouts.
 *
 * Accept only the documented "never lock" value (`0`) or a bounded positive
 * safe integer. Invalid values (negative, NaN, Infinity, non-integers) must
 * not clear the active timer — that path accidentally disables locking without
 * entering the intentional never-lock mode.
 */

/** Absolute ceiling for timed auto-lock (24 hours). */
export const AUTO_LOCK_MAX_MS = 24 * 60 * 60 * 1000

/**
 * Whether `ms` is an allowed auto-lock interval: `0` (never) or a positive
 * safe integer up to {@link AUTO_LOCK_MAX_MS}.
 */
export function isValidAutoLockMs(ms: unknown): ms is number {
  return (
    typeof ms === 'number' &&
    Number.isSafeInteger(ms) &&
    (ms === 0 || (ms > 0 && ms <= AUTO_LOCK_MAX_MS))
  )
}

/**
 * Reject invalid auto-lock values before vault state or storage is updated.
 * @throws if `ms` is not `0` or a bounded positive safe integer
 */
export function assertValidAutoLockMs(ms: unknown): asserts ms is number {
  if (!isValidAutoLockMs(ms)) {
    throw new Error(
      `Invalid auto-lock timeout: expected 0 or a positive integer up to ${AUTO_LOCK_MAX_MS} ms`,
    )
  }
}
