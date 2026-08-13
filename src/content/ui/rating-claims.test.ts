import { describe, expect, it } from 'vitest'
import { RATING_QUICK_CLAIMS, claimsForPolarity } from './rating-claims'

describe('RATING_QUICK_CLAIMS', () => {
  it('balances the same number of good and bad shortcuts', () => {
    expect(claimsForPolarity('good')).toHaveLength(3)
    expect(claimsForPolarity('bad')).toHaveLength(3)
  })

  it('maps each claim onto a unique whole-star score', () => {
    const stars = RATING_QUICK_CLAIMS.map((claim) => claim.stars)
    expect(stars).toEqual([5, 4, 3, 2, 1, 0])
    for (const claim of RATING_QUICK_CLAIMS) {
      expect(Number(claim.score)).toBe(claim.stars * 20)
    }
  })

  it('keeps good claims above bad claims so the groups stay separated', () => {
    const polarities = RATING_QUICK_CLAIMS.map((claim) => claim.polarity)
    expect(polarities).toEqual([
      'good',
      'good',
      'good',
      'bad',
      'bad',
      'bad',
    ])
  })
})
