import { t } from '@lib/i18n.js'
import type { RatingClaimEvidence, RatingQueryResult } from '../../../graph'
import styles from './SubjectRatings.module.css'

const POINTS_PER_STAR = 20
const HALF_STAR_REMAINDER = 0.5
const STAR_INDEXES = [0, 1, 2, 3, 4] as const
/** Analog 5-point star in 24-space — same filled body for Maps gold and empty gray. */
const STAR_PATH =
  'M12 3.2 14.7 8.7l6.1.9-4.4 4.3 1 6.1L12 16.9 6.6 20l1-6.1L3.2 9.6l6.1-.9Z'

export const HISTOGRAM_STAR_ORDER = [5, 4, 3, 2, 1] as const

export type RatingStarFill = 'none' | 'half' | 'full'

export type HistogramStar = 1 | 2 | 3 | 4 | 5

export type HistogramStarCounts = Record<HistogramStar, number>

/** Active kind 32014 scores only. Empty score is Delete and is not a claim. */
export function isActiveRatingScore(score: number): boolean {
  return Number.isFinite(score)
}

export function visibleRatingClaims(
  claims: readonly RatingClaimEvidence[],
): RatingClaimEvidence[] {
  return claims.filter((claim) => isActiveRatingScore(claim.score))
}

export function ownRatingScore(
  own: RatingClaimEvidence | undefined,
): number | null {
  if (own === undefined || !isActiveRatingScore(own.score)) return null
  return Math.round(own.score)
}

/**
 * Bucket a 0–100 wire score onto 0–5 stars. Score `0` is not a star button
 * and is omitted from the histogram.
 */
export function starsFromScore(score: number): 0 | HistogramStar {
  if (!Number.isFinite(score)) return 0
  const stars = Math.round(Math.min(Math.max(score, 0), 100) / POINTS_PER_STAR)
  if (stars <= 0) return 0
  if (stars >= 5) return 5
  return stars as HistogramStar
}

export function scoreFromStars(stars: HistogramStar): '20' | '40' | '60' | '80' | '100' {
  switch (stars) {
    case 1:
      return '20'
    case 2:
      return '40'
    case 3:
      return '60'
    case 4:
      return '80'
    case 5:
      return '100'
    default: {
      const _exhaustive: never = stars
      return _exhaustive
    }
  }
}

export function histogramStarCounts(
  claims: readonly RatingClaimEvidence[],
): HistogramStarCounts {
  const counts: HistogramStarCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const claim of visibleRatingClaims(claims)) {
    const stars = starsFromScore(claim.score)
    if (stars === 0) continue
    counts[stars] += 1
  }
  return counts
}

export function matchesStarFilter(
  score: number,
  selected: HistogramStar | null,
): boolean {
  if (selected === null) return true
  return starsFromScore(score) === selected
}

/** Pressed overlay star is 1–5. Score `0` does not light a star. */
export function ownRatingStars(
  own: RatingClaimEvidence | undefined,
): HistogramStar | null {
  const score = ownRatingScore(own)
  if (score === null) return null
  const stars = starsFromScore(score)
  return stars === 0 ? null : stars
}

export function shouldShowRatingDelete(
  rating: RatingQueryResult | null,
): boolean {
  return rating?.own !== undefined
}

/**
 * 0–100 wire score → one of five analog stars.
 * 20 points per star; leftover ≥ 10 paints a half.
 */
export function ratingStarFill(score: number, index: number): RatingStarFill {
  if (!Number.isFinite(score) || score <= 0) return 'none'
  const remainder = Math.min(score, 100) / POINTS_PER_STAR - index
  if (remainder >= 1) return 'full'
  if (remainder >= HALF_STAR_REMAINDER) return 'half'
  return 'none'
}

export function ratingStarFills(score: number): RatingStarFill[] {
  return STAR_INDEXES.map((index) => ratingStarFill(score, index))
}

export function AnalogStar({ fill }: { fill: RatingStarFill }) {
  switch (fill) {
    case 'none':
    case 'half':
    case 'full':
      return (
        <span className={styles.star} data-fill={fill}>
          <svg
            className={styles.starGlyph}
            viewBox="2 2 20 20"
            aria-hidden="true"
          >
            {fill === 'full' ? null : (
              <path d={STAR_PATH} className={styles.starEmpty} />
            )}
            {fill === 'none' ? null : (
              <path d={STAR_PATH} className={styles.starFill} />
            )}
          </svg>
        </span>
      )
    default: {
      const _exhaustive: never = fill
      return _exhaustive
    }
  }
}

export function AnalogStars(props: { score: number }) {
  return (
    <span className={styles.stars} aria-hidden="true">
      {ratingStarFills(props.score).map((fill, index) => (
        <AnalogStar key={index} fill={fill} />
      ))}
    </span>
  )
}

export default function RatingHistogram(props: {
  rating: RatingQueryResult
  selectedStars: HistogramStar | null
  onSelectStars: (stars: HistogramStar | null) => void
}) {
  const { rating, selectedStars, onSelectStars } = props
  const counts = histogramStarCounts(rating.claims)

  return (
    <div
      className={styles.hist}
      role="group"
      aria-label={t('panel.statementScan.starFilter')}
    >
      {HISTOGRAM_STAR_ORDER.map((stars) => {
        const count = counts[stars]
        const pressed = selectedStars === stars
        const score = Number(scoreFromStars(stars))
        return (
          <button
            key={stars}
            type="button"
            className={styles.histRow}
            aria-pressed={pressed}
            disabled={count === 0}
            aria-label={t('panel.statementScan.starRowAria', {
              stars,
              count,
            })}
            onClick={() => {
              if (count === 0) return
              onSelectStars(pressed ? null : stars)
            }}
          >
            <AnalogStars score={score} />
            <span className={styles.histCount}>{count}</span>
          </button>
        )
      })}
    </div>
  )
}
