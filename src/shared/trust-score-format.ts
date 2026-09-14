import type { TrustResolution } from '../graph'
import { trustScorePercent, trustScoredCount } from './trust-score'

export const TONE_COLORS: Record<'trust' | 'question' | 'misleading', string> = {
  trust: '#00a36c',
  question: '#d49b16',
  misleading: '#e5484d',
}

export type TrustScoreTranslate = (
  key: string,
  params?: Record<string, string | number>,
) => string

/** Minimal summary fields needed for compact trust detail text. */
export interface TrustScoreSummary {
  resolution: TrustResolution
  direct?: 1 | 0 | -1
  degree?: number
  trustCount: number
  distrustCount: number
  /** Hitting-degree Neutral count. Not in the percent. Missing means 0. */
  neutralCount?: number
  /** Resolver connected flag. Missing means `resolution !== 'none'`. */
  connected?: boolean
}

export type FormatTrustScoreParts = {
  text?: boolean
  degree?: boolean
  /** Timeline default: hide when there is no path. Notes: show "No connection". */
  empty?: 'hidden' | 'noConnection'
}

export interface TrustScoreBreakdown {
  connected: boolean
  /** Rounded trust share percent (trust * 100 / (trust + distrust)). */
  percent: number | null
  trust: number
  distrust: number
  /** Trust + distrust (Neutral excluded). */
  scored: number
  neutral: number
  degree?: number
  resolution: TrustResolution
}

export interface TrustScoreBoardBar {
  label: string
  count: number
  widthPct: number
}

export interface TrustScoreBoardView {
  percentLabel: string
  verdict: string
  showBars: boolean
  trust: TrustScoreBoardBar
  distrust: TrustScoreBoardBar
  total?: string
  footnote?: string
}

export function formatTrustScore(
  summary: TrustScoreSummary,
  t: TrustScoreTranslate,
  parts: FormatTrustScoreParts = { text: true, degree: true },
): string | undefined {
  if (summary.resolution === 'none') {
    return parts.empty === 'noConnection'
      ? t('content.card.noConnection')
      : undefined
  }

  const showText = parts.text !== false
  const showDegree = parts.degree !== false
  const textPart = showText ? formatTrustScoreText(summary, t) : undefined
  const degreePart = showDegree ? formatTrustDegree(summary) : undefined

  if (textPart && degreePart) {
    if (summary.degree === 0) return textPart
    return `${textPart} · ${degreePart}`
  }
  return textPart ?? degreePart
}

function formatTrustScoreText(
  summary: TrustScoreSummary,
  t: TrustScoreTranslate,
): string | undefined {
  if (summary.degree === 0) {
    if (summary.direct === 1 || summary.resolution === 'trusted') {
      return t('content.card.trustedByYou')
    }
    if (summary.direct === -1 || summary.resolution === 'distrusted') {
      return t('content.card.distrustedByYou')
    }
    if (summary.direct === 0) {
      return t('content.card.neutralByYou')
    }
  }

  const label =
    summary.resolution === 'trusted'
      ? t('content.resolution.trusted')
      : summary.resolution === 'distrusted'
        ? t('content.resolution.distrusted')
        : summary.resolution === 'mixed'
          ? t('content.resolution.mixed')
          : undefined
  if (!label) return undefined
  if (
    summary.degree === undefined &&
    (summary.trustCount > 0 || summary.distrustCount > 0)
  ) {
    return `${label} · +${summary.trustCount}/−${summary.distrustCount}`
  }
  return label
}

function formatTrustDegree(summary: TrustScoreSummary): string | undefined {
  if (summary.degree === undefined) return undefined
  return `${summary.degree}°`
}

export function trustScoreBreakdown(
  summary: TrustScoreSummary,
): TrustScoreBreakdown {
  const trust = summary.trustCount
  const distrust = summary.distrustCount
  const scored = trustScoredCount(trust, distrust)
  const connected = summary.connected ?? summary.resolution !== 'none'
  const percent = connected ? trustScorePercent(trust, distrust) : null
  const neutral = summary.neutralCount ?? 0
  return {
    connected,
    percent,
    trust,
    distrust,
    scored,
    neutral,
    ...(summary.degree !== undefined ? { degree: summary.degree } : {}),
    resolution: summary.resolution,
  }
}

function barWidth(count: number, scored: number): number {
  if (scored <= 0 || count <= 0) return 0
  return Math.round((100 * count) / scored)
}

export function trustScoreBoardView(
  summary: TrustScoreSummary,
  t: TrustScoreTranslate,
): TrustScoreBoardView {
  const breakdown = trustScoreBreakdown(summary)
  const percentLabel =
    breakdown.percent === null
      ? t('content.card.scorePercentEmpty')
      : t('content.card.scorePercent', { percent: breakdown.percent })
  const verdict =
    formatTrustScore(summary, t, { empty: 'noConnection' }) ??
    t('content.card.noConnection')
  const showBars = breakdown.connected && breakdown.scored > 0
  const view: TrustScoreBoardView = {
    percentLabel,
    verdict,
    showBars,
    trust: {
      label: t('content.card.trust'),
      count: breakdown.trust,
      widthPct: barWidth(breakdown.trust, breakdown.scored),
    },
    distrust: {
      label: t('content.card.distrust'),
      count: breakdown.distrust,
      widthPct: barWidth(breakdown.distrust, breakdown.scored),
    },
  }
  if (showBars) {
    view.total = t('content.card.scoreTotal', { count: breakdown.scored })
  }
  if (breakdown.neutral > 0) {
    view.footnote = t('content.card.scoreNeutralFootnote', {
      count: breakdown.neutral,
    })
  }
  return view
}
