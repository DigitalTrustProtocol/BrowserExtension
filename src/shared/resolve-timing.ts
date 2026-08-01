import {
  RESOLVE_TIMING_STORAGE_KEY,
  WOT_MAX_DEGREE_HARD_CAP,
  WOT_MAX_DEGREE_MIN,
} from './wot-max-degree'

export interface ResolveTimingBucket {
  avgMs: number
  samples: number
}

export interface ResolveTimingSnapshot {
  byDegree: Record<1 | 2 | 3 | 4 | 5, ResolveTimingBucket>
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

function emptySnapshot(): ResolveTimingSnapshot {
  return {
    byDegree: {
      1: { avgMs: 0, samples: 0 },
      2: { avgMs: 0, samples: 0 },
      3: { avgMs: 0, samples: 0 },
      4: { avgMs: 0, samples: 0 },
      5: { avgMs: 0, samples: 0 },
    },
    noMatch: { avgMs: 0, samples: 0 },
  }
}

/**
 * O(1) running averages for cold trust resolves, bucketed by hitting degree
 * or no-match. Persists a tiny blob to chrome.storage.local.
 */
export class ResolveTimingTracker {
  readonly #byDegree: Record<1 | 2 | 3 | 4 | 5, MutableBucket> = {
    1: emptyBucket(),
    2: emptyBucket(),
    3: emptyBucket(),
    4: emptyBucket(),
    5: emptyBucket(),
  }
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
      for (let d = WOT_MAX_DEGREE_MIN; d <= WOT_MAX_DEGREE_HARD_CAP; d++) {
        const key = String(d) as '1' | '2' | '3' | '4' | '5'
        const bucket = data.byDegree?.[key]
        if (
          bucket &&
          typeof bucket.sumMs === 'number' &&
          typeof bucket.samples === 'number' &&
          Number.isFinite(bucket.sumMs) &&
          Number.isSafeInteger(bucket.samples) &&
          bucket.samples >= 0
        ) {
          this.#byDegree[d as 1 | 2 | 3 | 4 | 5] = {
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
      if (
        !Number.isSafeInteger(degree) ||
        degree < WOT_MAX_DEGREE_MIN ||
        degree > WOT_MAX_DEGREE_HARD_CAP
      ) {
        return
      }
      const bucket = this.#byDegree[degree as 1 | 2 | 3 | 4 | 5]
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
      byDegree: {
        1: toPublic(this.#byDegree[1]),
        2: toPublic(this.#byDegree[2]),
        3: toPublic(this.#byDegree[3]),
        4: toPublic(this.#byDegree[4]),
        5: toPublic(this.#byDegree[5]),
      },
      noMatch: toPublic(this.#noMatch),
    }
  }

  /** Soft-hint helper: max avg across sampled degree buckets. */
  heaviestDegreeAvgMs(): { degree: number; avgMs: number; samples: number } | null {
    let best: { degree: number; avgMs: number; samples: number } | null = null
    for (let d = WOT_MAX_DEGREE_MIN; d <= WOT_MAX_DEGREE_HARD_CAP; d++) {
      const bucket = this.#byDegree[d as 1 | 2 | 3 | 4 | 5]
      if (bucket.samples === 0) continue
      const avgMs = bucket.sumMs / bucket.samples
      if (!best || avgMs > best.avgMs) {
        best = { degree: d, avgMs, samples: bucket.samples }
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
      const payload = {
        byDegree: {
          1: this.#byDegree[1],
          2: this.#byDegree[2],
          3: this.#byDegree[3],
          4: this.#byDegree[4],
          5: this.#byDegree[5],
        },
        noMatch: this.#noMatch,
      }
      await chrome.storage.local.set({ [RESOLVE_TIMING_STORAGE_KEY]: payload })
    } catch {
      /* ignore */
    }
  }
}

export { emptySnapshot as emptyResolveTimingSnapshot }
