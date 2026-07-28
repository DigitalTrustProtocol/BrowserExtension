/** @vitest-environment happy-dom */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetContentI18nForTests } from '../i18n'
import type { TrustSummary } from '../trust-summary'
import { formatTrustScore } from './signals'

beforeAll(() => {
  resetContentI18nForTests()
})

beforeEach(() => {
  resetContentI18nForTests()
})

describe('formatTrustScore', () => {
  const base: TrustSummary = {
    resolution: 'none',
    tone: 'neutral',
    trustCount: 0,
    distrustCount: 0,
    paths: 0,
    truncated: false,
  }

  it('labels direct trust at degree 0', () => {
    expect(
      formatTrustScore({
        ...base,
        resolution: 'trusted',
        tone: 'trust',
        direct: 1,
        degree: 0,
        trustCount: 1,
        paths: 1,
      }),
    ).toBe('Trusted by you')
    expect(
      formatTrustScore({
        ...base,
        resolution: 'distrusted',
        tone: 'misleading',
        direct: -1,
        degree: 0,
        distrustCount: 1,
        paths: 1,
      }),
    ).toBe('Distrusted by you')
  })

  it('keeps hop labels for network-only evidence', () => {
    expect(
      formatTrustScore({
        ...base,
        resolution: 'trusted',
        tone: 'trust',
        degree: 1,
        trustCount: 1,
        paths: 1,
      }),
    ).toBe('Trusted · 1°')
  })
})
