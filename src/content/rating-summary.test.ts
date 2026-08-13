import { describe, expect, it } from 'vitest'
import { starFillFromAverage, starRowFill } from './rating-summary'

describe('starFillFromAverage', () => {
  it('is empty when there is no rating', () => {
    expect(starFillFromAverage(null)).toBe('none')
  })

  it('uses a left half for low scores through 2½ (50)', () => {
    expect(starFillFromAverage(0)).toBe('half')
    expect(starFillFromAverage(50)).toBe('half')
  })

  it('fills the star above 2½', () => {
    expect(starFillFromAverage(51)).toBe('full')
    expect(starFillFromAverage(100)).toBe('full')
  })
})

describe('starRowFill', () => {
  it('leaves the row empty for spam (0) and missing scores', () => {
    expect([0, 1, 2, 3, 4].map((i) => starRowFill(0, i))).toEqual([
      'none',
      'none',
      'none',
      'none',
      'none',
    ])
    expect(starRowFill(undefined, 0)).toBe('none')
  })

  it('fills two stars and a half for ai-slop (50)', () => {
    expect([0, 1, 2, 3, 4].map((i) => starRowFill(50, i))).toEqual([
      'full',
      'full',
      'half',
      'none',
      'none',
    ])
  })

  it('fills whole stars for 1–5 clicks', () => {
    expect([0, 1, 2, 3, 4].map((i) => starRowFill(40, i))).toEqual([
      'full',
      'full',
      'none',
      'none',
      'none',
    ])
    expect([0, 1, 2, 3, 4].map((i) => starRowFill(100, i))).toEqual([
      'full',
      'full',
      'full',
      'full',
      'full',
    ])
  })
})
