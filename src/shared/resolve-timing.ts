import {
  RESOLVE_TIMING_STORAGE_KEY,
  WOT_DEGREES,
  type WotDegree,
} from './wot-max-degree'

export interface ResolveTimingBucket {
  avgMs: number
  samples: number
}

export interface ResolveTimingSnapshot {
  byDegree: Record<WotDegree, ResolveTimingBucket>
  noMatch: ResolveTimingBucket
}

interface MutableBucket {
  sumMs: number
  samples: number
}

function emptyBucket(): MutableBucket {
  return { sumMs: 0, samples: 0 }
}

function toPublic(bucket: MutableBucket): ResolveTimingBucket {
  return {
    avgMs: bucket.samples === 0 ? 0 : bucket.sumMs / bucket.samples,
    samples: bucket.samples,
  }
}

function emptyMutableByDegree(): Record<WotDegree, MutableBucket> {
  const byDegree = {} as Record<WotDegree, MutableBucket>
  for (const degree of WOT_DEGREES) {
    byDegree[degree] = emptyBucket()
  }
  return byDegree
}

function publicByDegree(
  byDegree: Record<WotDegree, MutableBucket>,
): Record<WotDegree, ResolveTimingBucket> {
  const out = {} as Record<WotDegree, ResolveTimingBucket>
  for (const degree of WOT_DEGREES) {
    out[degree] = toPublic(byDegree[degree])
  }
  return out
}

function emptySnapshot(): ResolveTimingSnapshot {
  const byDegree = {} as Record<WotDegree, ResolveTimingBucket>
  for (const degree of WOT_DEGREES) {
    byDegree[degree] = { avgMs: 0, samples: 0 }
  }
  return {
    byDegree,
    noMatch: { avgMs: 0, samples: 0 },
  }
}

function isWotDegree(value: number): value is WotDegree {
  return (WOT_DEGREES as readonly number[]).includes(value)
}

/**
 * O(1) running averages for cold trust resolves, bucketed by hitting degree
 * or no-match. Persists a tiny blob to chrome.storage.local.
 */
export class ResolveTimingTracker {
  readonly #byDegree: Record<WotDegree, MutableBucket> = emptyMutableByDegree()
  #noMatch: MutableBucket = emptyBucket()
  #persistTimer: ReturnType<typeof setTimeout> | undefined
  #persistMs: number

  constructor(options?: { persistDebounceMs?: number }) {
    this.#persistMs = options?.persistDebounceMs ?? 2_000
  }

  async load(): Promise<void> {
    try {
      const stored = (await chrome.storage.local.get(
        RESOLVE_TIMING_STORAGE_KEY,
      )) as Record<string, unknown>
      const raw = stored[RESOLVE_TIMING_STORAGE_KEY]
      if (!raw || typeof raw !== 'object') return
      const data = raw as {
        byDegree?: Record<string, { sumMs?: unknown; samples?: unknown }>
        noMatch?: { sumMs?: unknown; samples?: unknown }
      }
      for (const degree of WOT_DEGREES) {
        const bucket = data.byDegree?.[String(degree)]
        if (
          bucket &&
          typeof bucket.sumMs === 'number' &&
          typeof bucket.samples === 'number' &&
          Number.isFinite(bucket.sumMs) &&
          Number.isSafeInteger(bucket.samples) &&
          bucket.samples >= 0
        ) {
          this.#byDegree[degree] = {
            sumMs: Math.max(0, bucket.sumMs),
            samples: bucket.samples,
          }
        }
      }
      if (
        data.noMatch &&
        typeof data.noMatch.sumMs === 'number' &&
        typeof data.noMatch.samples === 'number' &&
        Number.isFinite(data.noMatch.sumMs) &&
        Number.isSafeInteger(data.noMatch.samples) &&
        data.noMatch.samples >= 0
      ) {
        this.#noMatch = {
          sumMs: Math.max(0, data.noMatch.sumMs),
          samples: data.noMatch.samples,
        }
      }
    } catch {
      /* storage unavailable in some tests */
    }
  }

  /**
   * Record a cold resolve. Skips degree 0 (self). Connected hits go to
   * byDegree[degree]; misses go to noMatch.
   */
  record(elapsedMs: number, result: { connected: boolean; degree: number }): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return
    if (result.connected) {
      const degree = result.degree
      if (!Number.isSafeInteger(degree) || !isWotDegree(degree)) return
      const bucket = this.#byDegree[degree]
      bucket.sumMs += elapsedMs
      bucket.samples += 1
    } else {
      this.#noMatch.sumMs += elapsedMs
      this.#noMatch.samples += 1
    }
    this.#schedulePersist()
  }

  snapshot(): ResolveTimingSnapshot {
    return {
      byDegree: publicByDegree(this.#byDegree),
      noMatch: toPublic(this.#noMatch),
    }
  }

  /** Soft-hint helper: max avg across sampled degree buckets. */
  heaviestDegreeAvgMs(): { degree: number; avgMs: number; samples: number } | null {
    let best: { degree: number; avgMs: number; samples: number } | null = null
    for (const degree of WOT_DEGREES) {
      const bucket = this.#byDegree[degree]
      if (bucket.samples === 0) continue
      const avgMs = bucket.sumMs / bucket.samples
      if (!best || avgMs > best.avgMs) {
        best = { degree, avgMs, samples: bucket.samples }
      }
    }
    return best
  }

  #schedulePersist(): void {
    if (this.#persistTimer !== undefined) return
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = undefined
      void this.#persist()
    }, this.#persistMs)
  }

  async #persist(): Promise<void> {
    try {
      const byDegree = {} as Record<WotDegree, MutableBucket>
      for (const degree of WOT_DEGREES) {
        byDegree[degree] = this.#byDegree[degree]
      }
      await chrome.storage.local.set({
        [RESOLVE_TIMING_STORAGE_KEY]: {
          byDegree,
          noMatch: this.#noMatch,
        },
      })
    } catch {
      /* ignore */
    }
  }
}

export { emptySnapshot as emptyResolveTimingSnapshot }
