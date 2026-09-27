/** Limits that imitate a small public relay. Every value is configurable. */

export interface RelayLimits {
  /** Cap applied to a missing or larger `limit`. */
  maxLimit: number
  maxFilters: number
  maxSubscriptions: number
  /** Authors, ids, or values of one `#` tag inside a single filter. */
  maxFilterValues: number
  maxEventBytes: number
  /** Reject `created_at` further ahead than this. `0` disables the check. */
  maxFutureSeconds: number
}

export const DEFAULT_RELAY_LIMITS: RelayLimits = {
  maxLimit: 500,
  maxFilters: 10,
  maxSubscriptions: 32,
  maxFilterValues: 100,
  maxEventBytes: 128 * 1024,
  maxFutureSeconds: 15 * 60,
}
