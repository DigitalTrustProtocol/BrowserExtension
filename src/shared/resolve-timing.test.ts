import { describe, expect, it } from 'vitest'
import { ResolveTimingTracker } from './resolve-timing'
import {
  WOT_DEGREES,
  WOT_MAX_DEGREE_HARD_CAP,
  WOT_MAX_DEGREE_MIN,
  clampWotMaxDegree,
} from './wot-max-degree'

describe('clampWotMaxDegree', () => {
  it('defaults invalid values to 4', () => {
    expect(clampWotMaxDegree(undefined)).toBe(4)
    expect(clampWotMaxDegree('3')).toBe(4)
    expect(clampWotMaxDegree(NaN)).toBe(4)
  })

  it('clamps to 1..7', () => {
    expect(clampWotMaxDegree(0)).toBe(1)
    expect(clampWotMaxDegree(1)).toBe(1)
    expect(clampWotMaxDegree(4)).toBe(4)
    expect(clampWotMaxDegree(7)).toBe(7)
    expect(clampWotMaxDegree(9)).toBe(7)
  })

  it('lists every slider degree from min through the hard cap', () => {
    expect(WOT_DEGREES[0]).toBe(WOT_MAX_DEGREE_MIN)
    expect(WOT_DEGREES[WOT_DEGREES.length - 1]).toBe(WOT_MAX_DEGREE_HARD_CAP)
    expect(WOT_DEGREES).toHaveLength(
      WOT_MAX_DEGREE_HARD_CAP - WOT_MAX_DEGREE_MIN + 1,
    )
  })
})

describe('ResolveTimingTracker', () => {
  it('buckets connected hits by degree and misses separately', () => {
    const tracker = new ResolveTimingTracker({ persistDebounceMs: 60_000 })
    tracker.record(10, { connected: true, degree: 2 })
    tracker.record(30, { connected: true, degree: 2 })
    tracker.record(70, { connected: true, degree: 7 })
    tracker.record(40, { connected: false, degree: 0 })
    tracker.record(5, { connected: true, degree: 0 })

    const snap = tracker.snapshot()
    expect(snap.byDegree[2]).toEqual({ avgMs: 20, samples: 2 })
    expect(snap.byDegree[7]).toEqual({ avgMs: 70, samples: 1 })
    expect(snap.noMatch).toEqual({ avgMs: 40, samples: 1 })
    expect(snap.byDegree[1].samples).toBe(0)
    expect(tracker.heaviestDegreeAvgMs()).toEqual({
      degree: 7,
      avgMs: 70,
      samples: 1,
    })
    expect(tracker.stored().byDegree[2]).toEqual({ sumMs: 40, samples: 2 })
    expect(tracker.stored().byDegree[7]).toEqual({ sumMs: 70, samples: 1 })
    expect(tracker.stored().noMatch).toEqual({ sumMs: 40, samples: 1 })
  })
})
