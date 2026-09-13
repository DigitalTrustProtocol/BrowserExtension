import { describe, expect, it } from 'vitest'
import en from '../../public/locales/en.json'
import {
  formatTrustScore,
  trustScoreBoardView,
  trustScoreBreakdown,
  type TrustScoreSummary,
} from './trust-score-format'

const t = (key: string, params?: Record<string, string | number>): string => {
  const raw = en[key as keyof typeof en]
  if (typeof raw !== 'string') return key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
}

const disconnected: TrustScoreSummary = {
  resolution: 'none',
  trustCount: 0,
  distrustCount: 0,
  connected: false,
}

describe('formatTrustScore', () => {
  it('hides disconnected scores by default', () => {
    expect(formatTrustScore(disconnected, t)).toBeUndefined()
  })

  it('labels disconnected scores when empty is noConnection', () => {
    expect(
      formatTrustScore(disconnected, t, { empty: 'noConnection' }),
    ).toBe('No connection')
  })

  it('keeps hop labels for network-only evidence', () => {
    expect(
      formatTrustScore(
        {
          resolution: 'trusted',
          connected: true,
          degree: 1,
          trustCount: 1,
          distrustCount: 0,
        },
        t,
      ),
    ).toBe('Trusted · 1°')
  })
})

describe('trustScoreBreakdown', () => {
  it('rounds trust * 100 / (trust + distrust)', () => {
    expect(
      trustScoreBreakdown({
        resolution: 'mixed',
        connected: true,
        trustCount: 3,
        distrustCount: 1,
        degree: 2,
      }),
    ).toEqual({
      connected: true,
      percent: 75,
      trust: 3,
      distrust: 1,
      scored: 4,
      neutral: 0,
      degree: 2,
      resolution: 'mixed',
    })
  })

  it('is 50 when trust and distrust counts are equal', () => {
    expect(
      trustScoreBreakdown({
        resolution: 'mixed',
        connected: true,
        trustCount: 1,
        distrustCount: 1,
      }).percent,
    ).toBe(50)
  })

  it('is 100 when every scored edge is trust', () => {
    expect(
      trustScoreBreakdown({
        resolution: 'trusted',
        connected: true,
        trustCount: 2,
        distrustCount: 0,
      }).percent,
    ).toBe(100)
  })

  it('is 0 when every scored edge is distrust', () => {
    expect(
      trustScoreBreakdown({
        resolution: 'distrusted',
        connected: true,
        trustCount: 0,
        distrustCount: 2,
      }).percent,
    ).toBe(0)
  })

  it('is null when disconnected even if counts exist', () => {
    expect(
      trustScoreBreakdown({
        ...disconnected,
        trustCount: 1,
      }).percent,
    ).toBeNull()
  })
})

describe('trustScoreBoardView', () => {
  it('shows bars, Total, and Neutral footnote', () => {
    const view = trustScoreBoardView(
      {
        resolution: 'mixed',
        connected: true,
        degree: 2,
        trustCount: 3,
        distrustCount: 1,
        neutralCount: 2,
      },
      t,
    )
    expect(view.percentLabel).toBe('75%')
    expect(view.verdict).toBe('Mixed trust · 2°')
    expect(view.showBars).toBe(true)
    expect(view.trust).toEqual({ label: 'Trust', count: 3, widthPct: 75 })
    expect(view.distrust).toEqual({ label: 'Distrust', count: 1, widthPct: 25 })
    expect(view.total).toBe('Total 4')
    expect(view.footnote).toBe('Neutral 2 — not counted in the score')
  })

  it('omits the Neutral footnote when the count is 0', () => {
    const view = trustScoreBoardView(
      {
        resolution: 'trusted',
        connected: true,
        degree: 1,
        trustCount: 1,
        distrustCount: 0,
      },
      t,
    )
    expect(view.footnote).toBeUndefined()
    expect(view.total).toBe('Total 1')
  })

  it('shows No connection without bars', () => {
    const view = trustScoreBoardView(
      { ...disconnected, neutralCount: 2 },
      t,
    )
    expect(view.percentLabel).toBe('—')
    expect(view.verdict).toBe('No connection')
    expect(view.showBars).toBe(false)
    expect(view.total).toBeUndefined()
    expect(view.footnote).toBe('Neutral 2 — not counted in the score')
  })
})
