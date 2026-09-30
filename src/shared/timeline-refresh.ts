/** How often x.com trust labels refresh while events are arriving. */
export const TIMELINE_REFRESH_DEFAULT_SECONDS = 5

export const TIMELINE_REFRESH_MIN_SECONDS = 1

export const TIMELINE_REFRESH_MAX_SECONDS = 120

export function normalizeTimelineRefreshSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return TIMELINE_REFRESH_DEFAULT_SECONDS
  }
  return Math.min(
    TIMELINE_REFRESH_MAX_SECONDS,
    Math.max(TIMELINE_REFRESH_MIN_SECONDS, Math.round(value)),
  )
}
