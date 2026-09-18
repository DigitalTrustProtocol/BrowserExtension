import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SYNC_STRATEGY,
  isContinuousSyncStrategy,
  normalizeExternalProfilesEnabled,
  normalizeSyncStrategy,
} from './sync-strategy'

describe('normalizeSyncStrategy', () => {
  it('keeps known strategies and migrates unknown values to interval', () => {
    expect(normalizeSyncStrategy('frontier-interval')).toBe('frontier-interval')
    expect(normalizeSyncStrategy('frontier-continuous')).toBe(
      'frontier-continuous',
    )
    expect(normalizeSyncStrategy('global-continuous')).toBe('global-continuous')
    expect(normalizeSyncStrategy(undefined)).toBe(DEFAULT_SYNC_STRATEGY)
    expect(normalizeSyncStrategy('firehose')).toBe(DEFAULT_SYNC_STRATEGY)
  })
})

describe('isContinuousSyncStrategy', () => {
  it('is false only for interval frontier sync', () => {
    expect(isContinuousSyncStrategy('frontier-interval')).toBe(false)
    expect(isContinuousSyncStrategy('frontier-continuous')).toBe(true)
    expect(isContinuousSyncStrategy('global-continuous')).toBe(true)
  })
})

describe('normalizeExternalProfilesEnabled', () => {
  it('defaults on and only disables for explicit false', () => {
    expect(normalizeExternalProfilesEnabled(undefined)).toBe(true)
    expect(normalizeExternalProfilesEnabled(true)).toBe(true)
    expect(normalizeExternalProfilesEnabled(false)).toBe(false)
  })
})
