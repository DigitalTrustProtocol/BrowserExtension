/**
 * Sync decorate channel: collapse targets + demoted-ad post ids.
 * Written by page-world before XHR response is read; content applies on insert.
 */

export const TIMELINE_DECORATE_DATASET_KEY = 'attentionxTimelineDecorate'

export type TimelineCollapseTarget = {
  postId: string
  userId?: string
  displayName?: string
  handle?: string
  resolution: 'trusted' | 'mixed' | 'distrusted' | 'none'
  basis: 'author' | 'post'
}

export type TimelineDecorateState = {
  /** postId → collapse metadata */
  collapse: Record<string, TimelineCollapseTarget>
  /** Post ids that were promoted but demoted for render (need Ad marker). */
  demotedAds: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function emptyTimelineDecorateState(): TimelineDecorateState {
  return { collapse: {}, demotedAds: [] }
}

export function parseTimelineDecorateState(
  value: unknown,
): TimelineDecorateState {
  if (!isRecord(value)) return emptyTimelineDecorateState()
  const collapse: Record<string, TimelineCollapseTarget> = {}
  if (isRecord(value.collapse)) {
    for (const [key, raw] of Object.entries(value.collapse)) {
      if (!/^\d{1,24}$/.test(key) || !isRecord(raw)) continue
      if (typeof raw.postId !== 'string' || !/^\d{1,24}$/.test(raw.postId)) {
        continue
      }
      const resolution = raw.resolution
      if (
        resolution !== 'trusted' &&
        resolution !== 'mixed' &&
        resolution !== 'distrusted' &&
        resolution !== 'none'
      ) {
        continue
      }
      const basis = raw.basis === 'post' ? 'post' : 'author'
      collapse[key] = {
        postId: raw.postId,
        resolution,
        basis,
        ...(typeof raw.userId === 'string' ? { userId: raw.userId } : {}),
        ...(typeof raw.displayName === 'string'
          ? { displayName: raw.displayName }
          : {}),
        ...(typeof raw.handle === 'string' ? { handle: raw.handle } : {}),
      }
    }
  }
  const demotedAds: string[] = []
  if (Array.isArray(value.demotedAds)) {
    for (const id of value.demotedAds) {
      if (typeof id === 'string' && /^\d{1,24}$/.test(id)) demotedAds.push(id)
    }
  }
  return { collapse, demotedAds: [...new Set(demotedAds)] }
}

export function mergeTimelineDecorateState(
  base: TimelineDecorateState,
  patch: TimelineDecorateState,
): TimelineDecorateState {
  return {
    collapse: { ...base.collapse, ...patch.collapse },
    demotedAds: [...new Set([...base.demotedAds, ...patch.demotedAds])],
  }
}

export function readTimelineDecorateDataset(
  doc: Document,
): TimelineDecorateState {
  const raw = doc.documentElement.dataset[TIMELINE_DECORATE_DATASET_KEY]
  if (!raw) return emptyTimelineDecorateState()
  try {
    return parseTimelineDecorateState(JSON.parse(raw) as unknown)
  } catch {
    return emptyTimelineDecorateState()
  }
}

/** Merge patch into the dataset (accumulates across timeline pages). */
export function writeTimelineDecorateDataset(
  doc: Document,
  patch: TimelineDecorateState,
): TimelineDecorateState {
  const merged = mergeTimelineDecorateState(
    readTimelineDecorateDataset(doc),
    patch,
  )
  doc.documentElement.dataset[TIMELINE_DECORATE_DATASET_KEY] =
    JSON.stringify(merged)
  return merged
}

export function clearTimelineDecorateDataset(doc: Document): void {
  delete doc.documentElement.dataset[TIMELINE_DECORATE_DATASET_KEY]
}
