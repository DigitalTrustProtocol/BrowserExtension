import { describe, expect, it } from 'vitest'
import type { TrustQueryResult } from '../graph'
import {
  chipToneForSummary,
  emptyTrustSummary,
  summarizeTrust,
} from './trust-summary'

function result(overrides: Partial<TrustQueryResult> = {}): TrustQueryResult {
  return {
    subject: { type: 'i', value: 'ext:twitter_id:11348282' },
    context: 'identity',
    resolution: 'none',
    statements: [],
    paths: [],
    truncated: false,
    computedAt: 1_700_000_000,
    ...overrides,
  } as TrustQueryResult
}

describe('summarizeTrust', () => {
  it('reports a neutral summary when there is no evidence', () => {
    expect(summarizeTrust(result())).toEqual(emptyTrustSummary())
  })

  it('counts trust and distrust and keeps the closest degree', () => {
    const summary = summarizeTrust(
      result({
        resolution: 'mixed',
        statements: [
          { distance: 2, value: 1 },
          { distance: 1, value: -1 },
          { distance: 3, value: 1 },
        ],
        paths: [{}, {}],
        truncated: true,
      } as Partial<TrustQueryResult>),
    )

    expect(summary.tone).toBe('question')
    expect(summary.trustCount).toBe(2)
    expect(summary.distrustCount).toBe(1)
    expect(summary.degree).toBe(1)
    expect(summary.paths).toBe(2)
    expect(summary.truncated).toBe(true)
  })

  it('maps resolutions onto tones and surfaces the operator statement', () => {
    expect(
      summarizeTrust(result({ resolution: 'trusted' })).tone,
    ).toBe('trust')
    expect(
      summarizeTrust(result({ resolution: 'distrusted' })).tone,
    ).toBe('misleading')
    expect(
      summarizeTrust(
        result({
          resolution: 'distrusted',
          direct: { value: -1 },
        } as Partial<TrustQueryResult>),
      ).direct,
    ).toBe(-1)
  })

  it('colors chips only for direct operator statements', () => {
    expect(
      chipToneForSummary(
        summarizeTrust(
          result({
            resolution: 'trusted',
            statements: [{ distance: 1, value: 1 }],
            direct: { value: 1 },
          } as Partial<TrustQueryResult>),
        ),
      ),
    ).toBe('trust')
    expect(
      chipToneForSummary(
        summarizeTrust(
          result({
            resolution: 'trusted',
            statements: [{ distance: 1, value: 1 }],
          } as Partial<TrustQueryResult>),
        ),
      ),
    ).toBe('neutral')
    expect(
      chipToneForSummary(
        summarizeTrust(
          result({
            resolution: 'distrusted',
            statements: [{ distance: 2, value: -1 }],
            direct: { value: -1 },
          } as Partial<TrustQueryResult>),
        ),
      ),
    ).toBe('misleading')
  })
})
