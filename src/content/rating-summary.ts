import type { RatingQueryResult } from '../graph'
import type { TrustTone } from './types'

/** Discrete fill for the compact post star (too small for 0–100 clip). */
export type StarFill = 'none' | 'half' | 'full'

/** Map a 0–100 average to none / left-half / full. `0` is an active rating. */
export function starFillFromAverage(score: number | null): StarFill {
  if (score === null) return 'none'
  if (score <= 50) return 'half'
  return 'full'
}

/**
 * Fill for star `index` (0–4) in the 5-star row.
 * 20 points per star; leftover `50` scores still paint as 2½.
 */
export function starRowFill(score: number | undefined, index: number): StarFill {
  if (score === undefined || score <= 0) return 'none'
  const remainder = score / 20 - index
  if (remainder >= 1) return 'full'
  if (remainder >= 0.5) return 'half'
  return 'none'
}

/**
 * Same 80% / 30% bands as trust ratio: green, yellow, red.
 * No score stays gray (neutral).
 */
export function toneForRatingScore(score: number | null): TrustTone {
  if (score === null) return 'neutral'
  if (score >= 80) return 'trust'
  if (score >= 30) return 'question'
  return 'misleading'
}

/** Compact rating snapshot for the post star. */
export interface RatingSummary {
  averageScore: number | null
  ownScore?: number
  claimCount: number
  labels: string[]
  tone: TrustTone
}

export function summarizeRating(result: RatingQueryResult): RatingSummary {
  const labels: string[] = []
  const seen = new Set<string>()
  for (const claim of result.claims) {
    for (const label of claim.labels) {
      if (seen.has(label)) continue
      seen.add(label)
      labels.push(label)
    }
  }
  return {
    averageScore: result.averageScore,
    ...(result.own !== undefined ? { ownScore: result.own.score } : {}),
    claimCount: result.claimCount,
    labels,
    tone: toneForRatingScore(result.averageScore),
  }
}

export function formatRatingScore(summary: RatingSummary): string | undefined {
  if (summary.averageScore === null) return undefined
  return String(Math.round(summary.averageScore))
}
