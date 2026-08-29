import { describe, expect, it } from 'vitest'
import {
  WOT_SYNC_INTERVAL_DEFAULT_MINUTES,
  WOT_SYNC_INTERVAL_PAUSED_MINUTES,
  normalizeSyncIntervalMinutes,
} from './wot-sync-interval'

describe('normalizeSyncIntervalMinutes', () => {
  it('keeps selectable intervals and paused', () => {
    for (const minutes of [5, 15, 30, 60]) {
      expect(normalizeSyncIntervalMinutes(minutes)).toBe(minutes)
    }
    expect(normalizeSyncIntervalMinutes(WOT_SYNC_INTERVAL_PAUSED_MINUTES)).toBe(
      0,
    )
  })

  it('falls back to the default for off-list or invalid values', () => {
    expect(normalizeSyncIntervalMinutes(7)).toBe(
      WOT_SYNC_INTERVAL_DEFAULT_MINUTES,
    )
    expect(normalizeSyncIntervalMinutes(-5)).toBe(
      WOT_SYNC_INTERVAL_DEFAULT_MINUTES,
    )
    expect(normalizeSyncIntervalMinutes(16)).toBe(
      WOT_SYNC_INTERVAL_DEFAULT_MINUTES,
    )
    expect(normalizeSyncIntervalMinutes('15')).toBe(
      WOT_SYNC_INTERVAL_DEFAULT_MINUTES,
    )
    expect(normalizeSyncIntervalMinutes(undefined)).toBe(
      WOT_SYNC_INTERVAL_DEFAULT_MINUTES,
    )
    expect(normalizeSyncIntervalMinutes(Number.NaN)).toBe(
      WOT_SYNC_INTERVAL_DEFAULT_MINUTES,
    )
  })
})
