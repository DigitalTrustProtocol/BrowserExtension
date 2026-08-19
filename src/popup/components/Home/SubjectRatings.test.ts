import { describe, expect, it } from 'vitest'
import en from '../../../../public/locales/en.json'
import type { RatingClaimEvidence } from '../../../graph'
import {
  formatRatingAuthorCopy,
  formatRatingHeroScore,
  interpolateRatingAverage,
  isActiveRatingScore,
  ownRatingScore,
  ratingAuthorLabel,
  ratingAverageLine,
  ratingHopDistance,
  ratingStarFills,
  visibleRatingClaims,
} from './SubjectRatings'

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

describe('ratingAverageLine', () => {
  it('is empty when there is no average', () => {
    expect(ratingAverageLine(null, 0)).toEqual({ kind: 'empty' })
    expect(ratingAverageLine(null, 3)).toEqual({ kind: 'empty' })
  })

  it('rounds a present 0–100 wire average and keeps the claim count', () => {
    expect(ratingAverageLine(81.6, 12)).toEqual({
      kind: 'present',
      score: 82,
      count: 12,
    })
    expect(ratingAverageLine(0, 1)).toEqual({
      kind: 'present',
      score: 0,
      count: 1,
    })
    expect(ratingAverageLine(80, 1)).toEqual({
      kind: 'present',
      score: 80,
      count: 1,
    })
  })

  it('formats the Maps-style average line on the 0–5 star scale', () => {
    const line = ratingAverageLine(80, 1)
    expect(line.kind).toBe('present')
    if (line.kind !== 'present') return
    expect(
      interpolateRatingAverage(en['panel.ratingsSection.average'], line),
    ).toBe('4.0 (1)')
    const half = ratingAverageLine(81.6, 12)
    expect(half.kind).toBe('present')
    if (half.kind !== 'present') return
    expect(
      interpolateRatingAverage(en['panel.ratingsSection.average'], half),
    ).toBe('4.1 (12)')
    expect(
      interpolateRatingAverage(en['panel.ratingsSection.averageAria'], line),
    ).toBe('Average 4.0 out of 5 from 1 ratings')
  })
})

describe('formatRatingHeroScore', () => {
  it('converts 0–100 onto the same 0–5 scale the analog stars use', () => {
    expect(formatRatingHeroScore(0)).toBe('0.0')
    expect(formatRatingHeroScore(80)).toBe('4.0')
    expect(formatRatingHeroScore(50)).toBe('2.5')
    expect(formatRatingHeroScore(70)).toBe('3.5')
    expect(formatRatingHeroScore(100)).toBe('5.0')
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

describe('ratingAuthorLabel', () => {
  it('marks the own author as You instead of hex', () => {
    expect(ratingAuthorLabel('aabbcc', 'AABBCC')).toEqual({ kind: 'you' })
    expect(formatRatingAuthorCopy({ kind: 'you' }, (key) => key)).toBe(
      'panel.ratingsSection.you',
    )
  })

  it('shortens a foreign pubkey instead of dumping the full hex as the title', () => {
    const hex = 'ab'.repeat(32)
    const label = ratingAuthorLabel(hex, 'root')
    expect(label.kind).toBe('npub')
    if (label.kind !== 'npub') return
    expect(label.text.startsWith('npub1')).toBe(true)
    expect(label.text.includes(hex)).toBe(false)
    expect(label.text.length).toBeLessThan(hex.length)
  })
})

describe('ratingHopDistance', () => {
  it('hides root distance and keeps a quiet hop number otherwise', () => {
    expect(ratingHopDistance(0)).toBeNull()
    expect(ratingHopDistance(1)).toBe(1)
    expect(ratingHopDistance(2)).toBe(2)
  })
})

describe('ratingStarFills', () => {
  it('maps 80 to four full stars so the glance matches hero 4.0', () => {
    expect(ratingStarFills(80)).toEqual(['full', 'full', 'full', 'full', 'none'])
    expect(formatRatingHeroScore(80)).toBe('4.0')
  })

  it('maps 0, 50, and 100 onto empty, two-and-a-half, and five stars', () => {
    expect(ratingStarFills(0)).toEqual(['none', 'none', 'none', 'none', 'none'])
    expect(ratingStarFills(50)).toEqual(['full', 'full', 'half', 'none', 'none'])
    expect(ratingStarFills(100)).toEqual(['full', 'full', 'full', 'full', 'full'])
  })

  it('maps leftover 10-point steps as halves', () => {
    expect(ratingStarFills(10)).toEqual(['half', 'none', 'none', 'none', 'none'])
    expect(ratingStarFills(30)).toEqual(['full', 'half', 'none', 'none', 'none'])
    expect(ratingStarFills(70)).toEqual(['full', 'full', 'full', 'half', 'none'])
    expect(ratingStarFills(90)).toEqual(['full', 'full', 'full', 'full', 'half'])
  })
})
