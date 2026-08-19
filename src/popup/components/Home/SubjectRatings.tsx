import { t } from '@lib/i18n.js'
import { truncateNpub } from '@shared/format/text.ts'
import Card from '@components/Card/Card'
import { SectionLabel } from '@components/SectionLabel/SectionLabel'
import type { RatingClaimEvidence, RatingQueryResult } from '../../../graph'
import styles from './SubjectRatings.module.css'

const LONG_LIST_MIN = 8
const POINTS_PER_STAR = 20
const HALF_STAR_REMAINDER = 0.5
const STAR_INDEXES = [0, 1, 2, 3, 4] as const
/** Analog 5-point star in 24-space — same filled body for Maps gold and empty gray.
 *  Hero SVG crops to viewBox 2 2 20 20 so the body fills the caption slot. */
const STAR_PATH =
  'M12 3.2 14.7 8.7l6.1.9-4.4 4.3 1 6.1L12 16.9 6.6 20l1-6.1L3.2 9.6l6.1-.9Z'

export type RatingStarFill = 'none' | 'half' | 'full'

export type RatingAverageLine =
  | { kind: 'empty' }
  | { kind: 'present'; score: number; count: number }

export type RatingAuthorLabel = { kind: 'you' } | { kind: 'npub'; text: string }

/** Active kind 32014 scores only. Empty score is Delete and is not a claim. */
export function isActiveRatingScore(score: number): boolean {
  return Number.isFinite(score)
}

export function visibleRatingClaims(
  claims: readonly RatingClaimEvidence[],
): RatingClaimEvidence[] {
  return claims.filter((claim) => isActiveRatingScore(claim.score))
}

/** Maps-style cluster: rounded 0–100 average (wire) + count, or empty. */
export function ratingAverageLine(
  averageScore: number | null,
  claimCount: number,
): RatingAverageLine {
  if (averageScore === null) return { kind: 'empty' }
  return {
    kind: 'present',
    score: Math.round(averageScore),
    count: claimCount,
  }
}

/**
 * Kind 32014 stays 0–100. The glance numeral is the same 0–5 quantity
 * the analog stars already use (20 points per star, one decimal like Maps).
 */
export function formatRatingHeroScore(score: number): string {
  if (!Number.isFinite(score)) return (0).toFixed(1)
  const clamped = Math.min(Math.max(score, 0), 100)
  return (clamped / POINTS_PER_STAR).toFixed(1)
}

export function interpolateRatingAverage(
  template: string,
  line: Extract<RatingAverageLine, { kind: 'present' }>,
): string {
  return template
    .replaceAll('{score}', formatRatingHeroScore(line.score))
    .replaceAll('{count}', String(line.count))
}

export function ownRatingScore(
  own: RatingClaimEvidence | undefined,
): number | null {
  if (own === undefined || !isActiveRatingScore(own.score)) return null
  return Math.round(own.score)
}

export function ratingAuthorLabel(
  author: string,
  ownAuthor: string | undefined,
): RatingAuthorLabel {
  if (
    ownAuthor !== undefined &&
    author.toLowerCase() === ownAuthor.toLowerCase()
  ) {
    return { kind: 'you' }
  }
  return { kind: 'npub', text: truncateNpub(author) }
}

export function formatRatingAuthorCopy(
  label: RatingAuthorLabel,
  translate: (key: string) => string,
): string {
  switch (label.kind) {
    case 'you':
      return translate('panel.ratingsSection.you')
    case 'npub':
      return label.text
    default: {
      const _exhaustive: never = label
      return _exhaustive
    }
  }
}

/** Distance is quiet meta, not a WoT hop. Root / own (0) stays hidden. */
export function ratingHopDistance(distance: number): number | null {
  if (!Number.isFinite(distance) || distance <= 0) return null
  return distance
}

/**
 * 0–100 wire score → one of five analog stars.
 * 20 points per star; leftover ≥ 10 paints a half. Same scale as the hero numeral.
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

function LabelTokens({
  labels,
  hints,
}: {
  labels?: string[]
  hints?: Record<string, string>
}) {
  if (labels === undefined || labels.length === 0) return null
  return (
    <div className={styles.labels}>
      {labels.map((label) => {
        const hint = hints?.[label]
        return (
          <span
            key={label}
            className={hint ? styles.labelHint : styles.label}
            title={hint}
            aria-label={hint ? `${label}: ${hint}` : label}
          >
            {label}
          </span>
        )
      })}
    </div>
  )
}

function AverageHero({ line }: { line: RatingAverageLine }) {
  switch (line.kind) {
    case 'empty':
      return (
        <p className={styles.empty} role="status">
          {t('panel.ratingsSection.empty')}
        </p>
      )
    case 'present': {
      const heroScore = formatRatingHeroScore(line.score)
      return (
        <p
          className={styles.hero}
          role="status"
          aria-label={t('panel.ratingsSection.averageAria', {
            score: heroScore,
            count: String(line.count),
          })}
        >
          <span className={styles.heroScore}>{heroScore}</span>
          <HeroStars score={line.score} />
          <span className={styles.heroCount}>
            {t('panel.ratingsSection.count', { count: String(line.count) })}
          </span>
        </p>
      )
    }
    default: {
      const _exhaustive: never = line
      return _exhaustive
    }
  }
}

function HeroStarMark({ fill }: { fill: RatingStarFill }) {
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

function HeroStars({ score }: { score: number }) {
  return (
    <span className={styles.heroStars} aria-hidden="true">
      {ratingStarFills(score).map((fill, index) => (
        <HeroStarMark key={index} fill={fill} />
      ))}
    </span>
  )
}

function ClaimRow({
  claim,
  ownAuthor,
}: {
  claim: RatingClaimEvidence
  ownAuthor: string | undefined
}) {
  const author = formatRatingAuthorCopy(
    ratingAuthorLabel(claim.author, ownAuthor),
    t,
  )
  const own = ownAuthor !== undefined && claim.author.toLowerCase() === ownAuthor.toLowerCase()

  return (
    <li className={own ? `${styles.item} ${styles.itemOwn}` : styles.item}>
      <div className={styles.itemTop}>
        <span className={styles.score}>
          {t('panel.ratingsSection.score', {
            score: String(Math.round(claim.score)),
          })}
        </span>
      </div>
      <div className={styles.author} title={claim.author}>
        {author}
      </div>
      <LabelTokens labels={claim.labels} hints={claim.labelHints} />
      {claim.content ? (
        <p className={styles.content}>{claim.content}</p>
      ) : null}
    </li>
  )
}

export default function SubjectRatings(props: {
  rating: RatingQueryResult | null
  /** When false (identity/user subjects), render nothing. */
  visible: boolean
}) {
  const { rating, visible } = props
  if (!visible || rating === null) return null

  const line = ratingAverageLine(rating.averageScore, rating.claimCount)
  const ownScore = ownRatingScore(rating.own)
  const claims = visibleRatingClaims(rating.claims)
  const ownAuthor = rating.own?.author
  const longList = claims.length >= LONG_LIST_MIN

  return (
    <Card className={styles.root}>
      <SectionLabel>{t('panel.ratingsSection.title')}</SectionLabel>
      <AverageHero line={line} />
      {ownScore === null ? null : (
        <p className={styles.own} role="status">
          <span className={styles.ownLabel}>{t('panel.ratingsSection.own')}</span>
          <span className={styles.ownScore}>
            {t('panel.ratingsSection.score', { score: String(ownScore) })}
          </span>
        </p>
      )}
      {claims.length === 0 ? null : (
        <ul className={longList ? styles.listLong : styles.list}>
          {claims.map((claim) => (
            <ClaimRow
              key={`${claim.eventId}:${claim.author}`}
              claim={claim}
              ownAuthor={ownAuthor}
            />
          ))}
        </ul>
      )}
    </Card>
  )
}
