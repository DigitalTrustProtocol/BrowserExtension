/**
 * Relay synchronization strategy persisted in background settings.
 * Existing installs without a stored value migrate to interval frontier sync.
 */

export const SYNC_STRATEGIES = [
  'frontier-interval',
  'frontier-continuous',
  'global-continuous',
] as const

export type SyncStrategy = (typeof SYNC_STRATEGIES)[number]

/** Preserve current REQ/EOSE alarm behavior for existing installs. */
export const DEFAULT_SYNC_STRATEGY: SyncStrategy = 'frontier-interval'

export const EXTERNAL_PROFILES_DEFAULT = true

/**
 * chrome.alarms name that resets the MV3 idle timer while live relay
 * subscriptions are open. Same 30s period as vault-keepalive — this is real
 * work in flight (open WebSockets + heap), not a dummy keep-alive.
 */
export const LIVE_SYNC_KEEPALIVE_ALARM = 'attentionx-live-sync'

/** Chrome clamps alarm periods to 30s (0.5 min) minimum. */
export const LIVE_SYNC_KEEPALIVE_PERIOD_MIN = 0.5

export function isSyncStrategy(value: unknown): value is SyncStrategy {
  return (
    typeof value === 'string' &&
    (SYNC_STRATEGIES as readonly string[]).includes(value)
  )
}

export function isContinuousSyncStrategy(
  value: SyncStrategy,
): boolean {
  return value !== 'frontier-interval'
}

export function normalizeSyncStrategy(value: unknown): SyncStrategy {
  return isSyncStrategy(value) ? value : DEFAULT_SYNC_STRATEGY
}

export function normalizeExternalProfilesEnabled(value: unknown): boolean {
  return value !== false
}
