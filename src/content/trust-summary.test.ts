import { describe, expect, it } from 'vitest'
import type { TrustQueryResult } from '../graph'
import {
  chipToneForSummary,
  emptyTrustSummary,
  summarizeTrust,
} from './trust-summary'

function result(overrides: Partial<TrustQueryResult> = {}): TrustQueryResult {
  return {
    subject: { type: 'i', value: 'user:id:11348282' },
    context: '',
    resolution: 'none',
    trust: 0,
    distrust: 0,
    trustValue: 0,
    degree: 0,
    connected: false,
    statements: [],
    paths: [],
    sourceEventIds: [],
    truncated: false,
    computedAt: 1_700_000_000,
    graphVersion: 1,
    ...overrides,
  }
}

describe('summarizeTrust', () => {
  it('reports a neutral summary when there is no evidence', () => {
    expect(summarizeTrust(result())).toEqual(emptyTrustSummary())
  })

  it('uses score counts and degree from IndexResolver result', () => {
    const summary = summarizeTrust(
      result({
        resolution: 'mixed',
        connected: true,
        trust: 2,
        distrust: 1,
        trustValue: 1,
        degree: 1,
        truncated: true,
      }),
    )

    expect(summary.tone).toBe('question')
    expect(summary.trustCount).toBe(2)
    expect(summary.distrustCount).toBe(1)
    expect(summary.degree).toBe(1)
    expect(summary.paths).toBe(0)
    expect(summary.truncated).toBe(true)
    expect(summary.directContext).toBeUndefined()
  })

  it('maps percent thresholds onto tones', () => {
    expect(
      summarizeTrust(
        result({
          connected: true,
          trust: 8,
          distrust: 2,
          resolution: 'trusted',
        }),
      ).tone,
    ).toBe('trust')
    expect(
      summarizeTrust(
        result({
          connected: true,
          trust: 0,
          distrust: 2,
          resolution: 'distrusted',
        }),
      ).tone,
    ).toBe('misleading')
  })

  it('colors chips only for direct operator statements', () => {
    expect(
      chipToneForSummary(
        summarizeTrust(
          result({
            resolution: 'trusted',
            connected: true,
            trust: 1,
            direct: {
              eventId: 'e',
              author: 'root',
              subject: { type: 'i', value: 'user:id:1' },
              context: '',
              requestedContext: '',
              contextMatch: 'exact',
              value: 1,
              createdAt: 1,
              distance: 0,
            },
          }),
        ),
      ),
    ).toBe('trust')
    expect(
      chipToneForSummary(
        summarizeTrust(
          result({
            resolution: 'trusted',
            connected: true,
            trust: 1,
          }),
        ),
      ),
    ).toBe('neutral')
  })

  it('records the winning slot context for retraction', () => {
    expect(
      summarizeTrust(
        result({
          resolution: 'trusted',
          connected: true,
          trust: 1,
          direct: {
            eventId: 'e',
            author: 'root',
            subject: { type: 'i', value: 'user:id:1' },
            context: '',
            requestedContext: 'identity',
            contextMatch: 'general',
            value: 1,
            createdAt: 1,
            distance: 0,
          },
        }),
      ).directContext,
    ).toBe('')
    expect(
      summarizeTrust(
        result({
          resolution: 'trusted',
          connected: true,
          trust: 1,
          direct: {
            eventId: 'e',
            author: 'root',
            subject: { type: 'i', value: 'user:id:1' },
            context: 'identity',
            requestedContext: 'identity',
            contextMatch: 'exact',
            value: 1,
            createdAt: 1,
            distance: 0,
          },
        }),
      ).directContext,
    ).toBe('identity')
  })
})
