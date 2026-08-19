import { describe, expect, it } from 'vitest'
import type { TrustResolution } from '../../../graph'
import {
  clusterFigure,
  clusterPhraseParts,
  formatClusterAria,
  formatClusterCount,
  formatClusterPhrase,
  formatVerdictLabel,
  polarityGlyph,
  trustClusterLine,
  verdictLabelKey,
  type Translate,
} from './TrustGiven'

const STRINGS: Record<string, string> = {
  'panel.trustGiven.trusted': 'Trusted',
  'panel.trustGiven.mixed': 'Mixed',
  'panel.trustGiven.distrusted': 'Distrusted',
  'panel.trustGiven.none': 'No evidence',
  'panel.trustGiven.count': '({count})',
  'panel.trustGiven.clusterAria': '{verdict}, {figure} ({count})',
}

const translate: Translate = (key, params) => {
  let str = STRINGS[key]
  if (str === undefined) return key
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      str = str.replaceAll(`{${name}}`, String(value))
    }
  }
  return str
}

describe('verdictLabelKey', () => {
  it('maps each resolution onto a panel.trustGiven key', () => {
    const cases: [TrustResolution, `panel.trustGiven.${TrustResolution}`][] = [
      ['trusted', 'panel.trustGiven.trusted'],
      ['mixed', 'panel.trustGiven.mixed'],
      ['distrusted', 'panel.trustGiven.distrusted'],
      ['none', 'panel.trustGiven.none'],
    ]
    for (const [resolution, key] of cases) {
      expect(verdictLabelKey(resolution)).toBe(key)
    }
  })
})

describe('formatVerdictLabel', () => {
  it('keeps a short verdict word for empty state and aria, not hop jargon', () => {
    expect(formatVerdictLabel('trusted', translate)).toBe('Trusted')
    expect(formatVerdictLabel('mixed', translate)).toBe('Mixed')
    expect(formatVerdictLabel('distrusted', translate)).toBe('Distrusted')
    expect(formatVerdictLabel('none', translate)).toBe('No evidence')
  })
})

describe('trustClusterLine', () => {
  it('is empty when there is no polar evidence', () => {
    expect(
      trustClusterLine({ resolution: 'none', trust: 0, distrust: 0 }),
    ).toEqual({ kind: 'empty' })
  })

  it('uses hitting-degree trust count as the figure when trusted', () => {
    expect(
      trustClusterLine({ resolution: 'trusted', trust: 1, distrust: 0 }),
    ).toEqual({
      kind: 'present',
      resolution: 'trusted',
      figure: 1,
      count: 1,
    })
  })

  it('uses hitting-degree distrust count as the figure when distrusted', () => {
    expect(
      trustClusterLine({ resolution: 'distrusted', trust: 0, distrust: 2 }),
    ).toEqual({
      kind: 'present',
      resolution: 'distrusted',
      figure: 2,
      count: 2,
    })
  })

  it('keeps trust as the figure when mixed, with total polar statements in count', () => {
    expect(
      trustClusterLine({ resolution: 'mixed', trust: 3, distrust: 1 }),
    ).toEqual({
      kind: 'present',
      resolution: 'mixed',
      figure: 3,
      count: 4,
    })
  })

  it('does not emit a 4.7-style score, a degree field, or a branded mark size', () => {
    const line = trustClusterLine({
      resolution: 'trusted',
      trust: 1,
      distrust: 0,
    })
    expect(line).not.toHaveProperty('degree')
    expect(line).not.toHaveProperty('markSize')
    expect(JSON.stringify(line)).not.toMatch(
      /4\.7|stars|score|22px|0\.62em|--brand|--error/i,
    )
  })
})

describe('clusterFigure', () => {
  it('picks the winning polarity count, never an average', () => {
    expect(clusterFigure('trusted', 5, 1)).toBe(5)
    expect(clusterFigure('distrusted', 1, 8)).toBe(8)
    expect(clusterFigure('mixed', 3, 2)).toBe(3)
  })
})

describe('formatClusterCount', () => {
  it('wraps statement count as a phrase peer of the figure, not a caption', () => {
    expect(formatClusterCount(1, translate)).toBe('(1)')
    expect(formatClusterCount(4, translate)).toBe('(4)')
  })
})

describe('polarityGlyph', () => {
  it('emits ternary 32009 marks as text glyphs, not words or a star score', () => {
    const trusted = polarityGlyph('trusted')
    const distrusted = polarityGlyph('distrusted')
    const mixed = polarityGlyph('mixed')
    expect(trusted).toMatch(/\p{So}/u)
    expect(distrusted).toMatch(/\p{So}/u)
    expect(trusted).not.toBe(distrusted)
    expect(mixed).toBe(`${trusted}${distrusted}`)
    expect(`${trusted}${distrusted}${mixed}`).not.toMatch(/star|4\.7|svg/i)
  })
})

describe('clusterPhraseParts', () => {
  it('keeps figure, 32009 mark, and (n) as one phrase — not a star score', () => {
    const trusted = clusterPhraseParts(
      { kind: 'present', resolution: 'trusted', figure: 1, count: 1 },
      translate,
    )
    expect(trusted).toEqual({
      figure: '1',
      mark: polarityGlyph('trusted'),
      count: '(1)',
    })
    expect(trusted.mark).not.toMatch(/star|4\.7|svg/i)
    expect(
      clusterPhraseParts(
        { kind: 'present', resolution: 'mixed', figure: 3, count: 4 },
        translate,
      ),
    ).toEqual({
      figure: '3',
      mark: polarityGlyph('mixed'),
      count: '(4)',
    })
  })
})

describe('formatClusterPhrase', () => {
  it('typesets figure, mark, and (n) as one spaced phrase', () => {
    const trusted = {
      kind: 'present' as const,
      resolution: 'trusted' as const,
      figure: 1,
      count: 1,
    }
    expect(formatClusterPhrase(trusted, translate)).toBe(
      `1 ${polarityGlyph('trusted')} (1)`,
    )
    expect(
      formatClusterPhrase(
        { kind: 'present', resolution: 'mixed', figure: 3, count: 4 },
        translate,
      ),
    ).toBe(`3 ${polarityGlyph('mixed')} (4)`)
  })
})

describe('formatClusterAria', () => {
  it('names verdict, figure, and statement count without inventing a score', () => {
    expect(
      formatClusterAria(
        {
          kind: 'present',
          resolution: 'trusted',
          figure: 1,
          count: 1,
        },
        translate,
      ),
    ).toBe('Trusted, 1 (1)')
  })
})
