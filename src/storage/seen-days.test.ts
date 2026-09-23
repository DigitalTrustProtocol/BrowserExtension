import { describe, expect, it } from 'vitest'
import { DAY_MS, nextSeenDays } from './seen-days'

describe('nextSeenDays', () => {
  it('starts at one for a first sighting', () => {
    expect(nextSeenDays(undefined, undefined, 5 * DAY_MS)).toBe(1)
  })

  it('does not count repeated sightings on the same UTC day', () => {
    expect(nextSeenDays(5 * DAY_MS, 3, 5 * DAY_MS + DAY_MS - 1)).toBe(3)
  })

  it('adds one when the sighting falls on a later UTC day', () => {
    expect(nextSeenDays(5 * DAY_MS + DAY_MS - 1, 3, 6 * DAY_MS)).toBe(4)
  })

  it('treats rows written before seenDays existed as seen once', () => {
    expect(nextSeenDays(5 * DAY_MS, undefined, 9 * DAY_MS)).toBe(2)
  })

  it('ignores observations older than lastSeen', () => {
    expect(nextSeenDays(9 * DAY_MS, 2, 5 * DAY_MS)).toBe(2)
  })
})
