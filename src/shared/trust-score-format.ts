import type { TrustResolution } from '../graph'

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
  direct?: 1 | -1
  degree?: number
  trustCount: number
  distrustCount: number
}

export function formatTrustScore(
  summary: TrustScoreSummary,
  t: TrustScoreTranslate,
  parts: { text?: boolean; degree?: boolean } = { text: true, degree: true },
): string | undefined {
  if (summary.resolution === 'none') return undefined

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
