/**
 * Read 32009 counts from a resolver score. RatingScore has none of these.
 */

import { TrustScore, type Score } from './trust/Score'

export function trustScoreCounts(score: Score): {
  trust: number
  distrust: number
  trustValue: number
  /** Hitting-degree Neutral edges. Not in `count` / percent. */
  neutral: number
} {
  if (score instanceof TrustScore) {
    return {
      trust: score.trust,
      distrust: score.distrust,
      trustValue: score.trustValue,
      neutral: score.neutral,
    }
  }
  return { trust: 0, distrust: 0, trustValue: 0, neutral: 0 }
}
