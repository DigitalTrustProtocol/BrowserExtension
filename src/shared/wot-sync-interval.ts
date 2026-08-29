/** chrome.alarms name for periodic WoT sync / maintenance. */
export const MAINTENANCE_ALARM = 'attentionx-maintenance'

/** Default network refresh interval (minutes). */
export const WOT_SYNC_INTERVAL_DEFAULT_MINUTES = 15

/** Paused: no periodic sync — manual Sync now only. */
export const WOT_SYNC_INTERVAL_PAUSED_MINUTES = 0

/** Selectable refresh intervals (minutes). */
export const WOT_SYNC_INTERVAL_OPTIONS = [5, 15, 30, 60] as const

export function normalizeSyncIntervalMinutes(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Math.round(value)
    if (rounded === WOT_SYNC_INTERVAL_PAUSED_MINUTES) return rounded
    if ((WOT_SYNC_INTERVAL_OPTIONS as readonly number[]).includes(rounded)) {
      return rounded
    }
  }
  return WOT_SYNC_INTERVAL_DEFAULT_MINUTES
}
