import { describe, expect, it } from 'vitest'
import {
  isStoragePruningEnabled,
  normalizeStorageRetention,
  STORAGE_BUDGET_MB_MAX,
  STORAGE_IDLE_DAYS_MIN,
  STORAGE_RETENTION_DEFAULTS,
  storageBudgetStatus,
} from './storage-retention'

describe('normalizeStorageRetention', () => {
  it('falls back to defaults for missing or invalid values', () => {
    expect(normalizeStorageRetention(undefined)).toEqual(
      STORAGE_RETENTION_DEFAULTS,
    )
    expect(
      normalizeStorageRetention({ softBudgetMb: 'lots', postIdleDays: NaN }),
    ).toEqual(STORAGE_RETENTION_DEFAULTS)
  })

  it('clamps and rounds each knob', () => {
    expect(
      normalizeStorageRetention({
        softBudgetMb: 10 ** 9,
        hardBudgetMb: 10 ** 9,
        postIdleDays: 1,
      }),
    ).toEqual({
      softBudgetMb: STORAGE_BUDGET_MB_MAX,
      hardBudgetMb: STORAGE_BUDGET_MB_MAX,
      postIdleDays: STORAGE_IDLE_DAYS_MIN,
      prunePostEvents: false,
      pruneUserEvents: false,
    })
    expect(normalizeStorageRetention({ postIdleDays: 30.6 }).postIdleDays).toBe(
      31,
    )
  })

  it('turns pruning on only for an explicit true', () => {
    expect(
      normalizeStorageRetention({ prunePostEvents: true, pruneUserEvents: 'yes' }),
    ).toMatchObject({ prunePostEvents: true, pruneUserEvents: false })
    expect(isStoragePruningEnabled(STORAGE_RETENTION_DEFAULTS)).toBe(false)
    expect(
      isStoragePruningEnabled({
        ...STORAGE_RETENTION_DEFAULTS,
        pruneUserEvents: true,
      }),
    ).toBe(true)
  })

  it('drops a stored userIdleDays from older settings', () => {
    expect(
      normalizeStorageRetention({ softBudgetMb: 800, userIdleDays: 30 }),
    ).toEqual({ ...STORAGE_RETENTION_DEFAULTS, softBudgetMb: 800 })
  })

  it('raises the hard budget to at least the soft budget', () => {
    expect(
      normalizeStorageRetention({ softBudgetMb: 800, hardBudgetMb: 100 }),
    ).toMatchObject({ softBudgetMb: 800, hardBudgetMb: 800 })
  })
})

describe('storageBudgetStatus', () => {
  const settings = { ...STORAGE_RETENTION_DEFAULTS }
  const mb = 1024 * 1024

  it('reports ok when usage is unknown or within the soft budget', () => {
    expect(storageBudgetStatus(undefined, settings)).toBe('ok')
    expect(storageBudgetStatus(500 * mb, settings)).toBe('ok')
  })

  it('reports soft and hard overruns', () => {
    expect(storageBudgetStatus(501 * mb, settings)).toBe('overSoft')
    expect(storageBudgetStatus(2001 * mb, settings)).toBe('overHard')
  })
})
