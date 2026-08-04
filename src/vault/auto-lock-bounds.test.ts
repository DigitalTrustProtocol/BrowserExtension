import { describe, expect, it } from 'vitest'
import {
  assertValidAutoLockMs,
  AUTO_LOCK_MAX_MS,
  isValidAutoLockMs,
} from './auto-lock-bounds.ts'
import { AUTO_LOCK_OPTIONS } from '../shared/constants.ts'

describe('auto-lock-bounds', () => {
  it('accepts 0 (never lock) and UI preset intervals', () => {
    expect(isValidAutoLockMs(0)).toBe(true)
    for (const opt of AUTO_LOCK_OPTIONS) {
      expect(isValidAutoLockMs(opt.ms)).toBe(true)
    }
    expect(() => assertValidAutoLockMs(900_000)).not.toThrow()
  })

  it('accepts the max bound', () => {
    expect(isValidAutoLockMs(AUTO_LOCK_MAX_MS)).toBe(true)
  })

  it('rejects negative, non-finite, non-integer, and oversized values', () => {
    const invalid = [
      -1,
      -900_000,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      1.5,
      AUTO_LOCK_MAX_MS + 1,
      Number.MAX_SAFE_INTEGER,
      '900000',
      null,
      undefined,
      {},
    ]
    for (const value of invalid) {
      expect(isValidAutoLockMs(value)).toBe(false)
      expect(() => assertValidAutoLockMs(value)).toThrow(/Invalid auto-lock timeout/)
    }
  })
})
