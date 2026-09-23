export const DAY_MS = 24 * 60 * 60 * 1000

function utcDay(ms: number): number {
  return Math.floor(ms / DAY_MS)
}

/**
 * Distinct UTC days a subject was seen. Counts days, not sightings, so
 * repeated scrolls past the same post within one day do not inflate it.
 */
export function nextSeenDays(
  prevLastSeen: number | undefined,
  prevSeenDays: number | undefined,
  observedAt: number,
): number {
  if (prevLastSeen === undefined) return 1
  const previous = Math.max(1, prevSeenDays ?? 1)
  return utcDay(observedAt) > utcDay(prevLastSeen) ? previous + 1 : previous
}
