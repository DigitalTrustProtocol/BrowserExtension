/**
 * Local storage budget, post idle-age, and pruning toggles. Pruning runs only
 * while usage is above the soft budget: idle-post events, and events authored
 * outside the web of trust of every local key. Trust about users from inside
 * that web of trust always stays (see docs/architecture.md § Storage budget
 * and retention).
 */
export interface StorageRetentionSettings {
  softBudgetMb: number
  hardBudgetMb: number
  postIdleDays: number
  prunePostEvents: boolean
  pruneUserEvents: boolean
}

export const STORAGE_RETENTION_DEFAULTS: StorageRetentionSettings = {
  softBudgetMb: 500,
  hardBudgetMb: 2000,
  postIdleDays: 180,
  prunePostEvents: false,
  pruneUserEvents: false,
}

/** Out-of-WoT events must be held this long before they may be pruned. */
export const USER_EVENT_PRUNE_MIN_HELD_DAYS = 30

/** chrome.alarms name for the throttled background pruner. */
export const STORAGE_PRUNE_ALARM = 'attentionx-storage-prune'
export const STORAGE_PRUNE_PERIOD_MIN = 2

export const STORAGE_BUDGET_MB_MIN = 10
export const STORAGE_BUDGET_MB_MAX = 100_000
export const STORAGE_IDLE_DAYS_MIN = 7
export const STORAGE_IDLE_DAYS_MAX = 3650

/** Idle-age buckets reported in stats (days since `lastSeen`). */
export const STORAGE_IDLE_BUCKET_DAYS = [30, 90, 180, 365] as const

export type StorageBudgetStatus = 'ok' | 'overSoft' | 'overHard'

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Clamp every knob; hard budget is raised to at least the soft budget. */
export function normalizeStorageRetention(
  value: unknown,
): StorageRetentionSettings {
  const stored =
    typeof value === 'object' && value !== null
      ? (value as Partial<Record<keyof StorageRetentionSettings, unknown>>)
      : {}
  const d = STORAGE_RETENTION_DEFAULTS
  const softBudgetMb = clampInteger(
    stored.softBudgetMb,
    STORAGE_BUDGET_MB_MIN,
    STORAGE_BUDGET_MB_MAX,
    d.softBudgetMb,
  )
  const hardBudgetMb = Math.max(
    softBudgetMb,
    clampInteger(
      stored.hardBudgetMb,
      STORAGE_BUDGET_MB_MIN,
      STORAGE_BUDGET_MB_MAX,
      d.hardBudgetMb,
    ),
  )
  return {
    softBudgetMb,
    hardBudgetMb,
    postIdleDays: clampInteger(
      stored.postIdleDays,
      STORAGE_IDLE_DAYS_MIN,
      STORAGE_IDLE_DAYS_MAX,
      d.postIdleDays,
    ),
    prunePostEvents: stored.prunePostEvents === true,
    pruneUserEvents: stored.pruneUserEvents === true,
  }
}

export function isStoragePruningEnabled(
  settings: StorageRetentionSettings,
): boolean {
  return settings.prunePostEvents || settings.pruneUserEvents
}

export function storageBudgetStatus(
  usageBytes: number | undefined,
  settings: StorageRetentionSettings,
): StorageBudgetStatus {
  if (usageBytes === undefined) return 'ok'
  const mb = usageBytes / (1024 * 1024)
  if (mb > settings.hardBudgetMb) return 'overHard'
  if (mb > settings.softBudgetMb) return 'overSoft'
  return 'ok'
}
