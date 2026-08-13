/**
 * Quick 32014 labels for the post star popover.
 * Each shortcut maps onto a whole-star score so the tap is obvious.
 * Protocol `l` values stay lowercase; display names are translated.
 */
export type RatingClaimPolarity = 'good' | 'bad'

export type RatingQuickClaimId =
  | 'insightful'
  | 'genuine'
  | 'funny'
  | 'ai-slop'
  | 'misleading'
  | 'spam'

export interface RatingQuickClaim {
  id: RatingQuickClaimId
  /** Wire `score` tag; always `stars * 20`. */
  score: '100' | '80' | '60' | '40' | '20' | '0'
  stars: 5 | 4 | 3 | 2 | 1 | 0
  polarity: RatingClaimPolarity
}

export const RATING_QUICK_CLAIMS: readonly RatingQuickClaim[] = [
  { id: 'insightful', score: '100', stars: 5, polarity: 'good' },
  { id: 'genuine', score: '80', stars: 4, polarity: 'good' },
  { id: 'funny', score: '60', stars: 3, polarity: 'good' },
  { id: 'ai-slop', score: '40', stars: 2, polarity: 'bad' },
  { id: 'misleading', score: '20', stars: 1, polarity: 'bad' },
  { id: 'spam', score: '0', stars: 0, polarity: 'bad' },
]

export function claimsForPolarity(
  polarity: RatingClaimPolarity,
): RatingQuickClaim[] {
  return RATING_QUICK_CLAIMS.filter((claim) => claim.polarity === polarity)
}
