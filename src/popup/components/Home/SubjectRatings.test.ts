import { describe, expect, it } from 'vitest'
import type { RatingClaimEvidence } from '../../../graph'
import {
  histogramStarCounts,
  isActiveRatingScore,
  matchesStarFilter,
  ownRatingScore,
  ownRatingStars,
  ratingStarFills,
  shouldShowRatingDelete,
  starsFromScore,
  scoreFromStars,
  visibleRatingClaims,
} from './SubjectRatings'
import type { RatingQueryResult } from '../../../graph'

const subject = { type: 'i' as const, value: 'post:id:42' }

function claim(
  overrides: Partial<RatingClaimEvidence> & Pick<RatingClaimEvidence, 'eventId' | 'author' | 'score'>,
): RatingClaimEvidence {
  return {
    subject,
    context: '',
    labels: [],
    content: '',
    createdAt: 1,
    distance: 1,
    ...overrides,
  }
}

describe('starsFromScore', () => {
  it('buckets 20-point steps onto 1–5 and omits 0', () => {
    expect(starsFromScore(0)).toBe(0)
    expect(starsFromScore(20)).toBe(1)
    expect(starsFromScore(40)).toBe(2)
    expect(starsFromScore(60)).toBe(3)
    expect(starsFromScore(80)).toBe(4)
    expect(starsFromScore(100)).toBe(5)
  })

  it('rounds leftover wire scores onto the nearest star', () => {
    expect(starsFromScore(50)).toBe(3)
    expect(starsFromScore(10)).toBe(1)
    expect(starsFromScore(Number.NaN)).toBe(0)
  })
})

describe('scoreFromStars', () => {
  it('maps 1–5 onto the NIP-32014 quick star form', () => {
    expect(scoreFromStars(1)).toBe('20')
    expect(scoreFromStars(2)).toBe('40')
    expect(scoreFromStars(3)).toBe('60')
    expect(scoreFromStars(4)).toBe('80')
    expect(scoreFromStars(5)).toBe('100')
  })
})

describe('histogramStarCounts', () => {
  it('counts 5★–1★ and omits score 0', () => {
    expect(
      histogramStarCounts([
        claim({ eventId: 'a', author: 'a', score: 100 }),
        claim({ eventId: 'b', author: 'b', score: 100 }),
        claim({ eventId: 'c', author: 'c', score: 60 }),
        claim({ eventId: 'd', author: 'd', score: 0 }),
        claim({ eventId: 'e', author: 'e', score: Number.NaN }),
      ]),
    ).toEqual({ 5: 2, 4: 0, 3: 1, 2: 0, 1: 0 })
  })
})

describe('matchesStarFilter', () => {
  it('keeps only the selected star and ignores 0 unless unfiltered', () => {
    expect(matchesStarFilter(60, null)).toBe(true)
    expect(matchesStarFilter(0, null)).toBe(true)
    expect(matchesStarFilter(60, 3)).toBe(true)
    expect(matchesStarFilter(80, 3)).toBe(false)
    expect(matchesStarFilter(0, 1)).toBe(false)
  })
})

describe('ownRatingStars', () => {
  it('is absent without an own claim or for score 0', () => {
    expect(ownRatingStars(undefined)).toBeNull()
    expect(
      ownRatingStars(claim({ eventId: 'own', author: 'root', score: 0, distance: 0 })),
    ).toBeNull()
  })

  it('maps an own 60 onto 3★', () => {
    expect(
      ownRatingStars(claim({ eventId: 'own', author: 'root', score: 60, distance: 0 })),
    ).toBe(3)
  })
})

describe('shouldShowRatingDelete', () => {
  it('shows Delete only when an own 32014 winner exists', () => {
    const empty: RatingQueryResult = {
      subject,
      context: '',
      claims: [],
      averageScore: null,
      claimCount: 0,
      degree: 0,
      sourceEventIds: [],
      computedAt: 1,
      graphVersion: 1,
      paths: [],
    }
    expect(shouldShowRatingDelete(null)).toBe(false)
    expect(shouldShowRatingDelete(empty)).toBe(false)
    expect(
      shouldShowRatingDelete({
        ...empty,
        own: claim({ eventId: 'own', author: 'root', score: 80, distance: 0 }),
      }),
    ).toBe(true)
  })
})

describe('ownRatingScore', () => {
  it('is absent without an own claim', () => {
    expect(ownRatingScore(undefined)).toBeNull()
  })

  it('rounds an active own score', () => {
    expect(ownRatingScore(claim({ eventId: 'own', author: 'root', score: 79.4, distance: 0 }))).toBe(79)
  })
})

describe('visibleRatingClaims', () => {
  it('keeps finite scores including 0 and drops non-finite Deletes', () => {
    const rows = visibleRatingClaims([
      claim({ eventId: 'a', author: 'alice', score: 0 }),
      claim({ eventId: 'b', author: 'bob', score: Number.NaN }),
      claim({ eventId: 'c', author: 'carol', score: 80 }),
    ])
    expect(rows.map((row) => row.eventId)).toEqual(['a', 'c'])
  })
})

describe('isActiveRatingScore', () => {
  it('treats 0 as an active rating, not a Delete', () => {
    expect(isActiveRatingScore(0)).toBe(true)
    expect(isActiveRatingScore(50)).toBe(true)
    expect(isActiveRatingScore(Number.NaN)).toBe(false)
  })
})

describe('ratingStarFills', () => {
  it('maps 80 to four full stars', () => {
    expect(ratingStarFills(80)).toEqual(['full', 'full', 'full', 'full', 'none'])
  })

  it('maps 0, 50, and 100 onto empty, two-and-a-half, and five stars', () => {
    expect(ratingStarFills(0)).toEqual(['none', 'none', 'none', 'none', 'none'])
    expect(ratingStarFills(50)).toEqual(['full', 'full', 'half', 'none', 'none'])
    expect(ratingStarFills(100)).toEqual(['full', 'full', 'full', 'full', 'full'])
  })
})
