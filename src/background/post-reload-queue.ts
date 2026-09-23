/**
 * Reloads pruned posts when they are seen on X again. A sighting (a rating
 * query for a `prunedAt` post) requests the post id; ids are debounced into
 * small batches that run one at a time:
 *
 * 1. `begin`: lift the pruned mark in RAM only, so the ingest check lets the
 *    post's events in while IndexedDB still says pruned,
 * 2. fetch the post's 32009 / 32014 events from relays,
 * 3. on a complete fetch `commit` (clear `prunedAt` durably); otherwise
 *    `rollback` (restore the RAM mark) and back off before retrying.
 *
 * `prunedAt` in IndexedDB is the retry marker: a failed, truncated, or
 * interrupted reload (including a worker restart) leaves it set, so the post
 * reloads again the next time it is on screen.
 */

export interface PostReloadLimits {
  /** Wait after the first request so a scroll burst lands in one batch. */
  debounceMs: number
  /** One relay `#i` filter's worth, so the per-relay event cap is per batch. */
  batchSize: number
  /** Minimum gap between batches. */
  spacingMs: number
  /** Abort a batch's relay fetch after this long. */
  timeoutMs: number
  /** Do not retry a post whose reload failed for this long. */
  retryBackoffMs: number
}

export const POST_RELOAD_LIMITS: PostReloadLimits = {
  debounceMs: 1_500,
  batchSize: 20,
  spacingMs: 2_000,
  timeoutMs: 15_000,
  retryBackoffMs: 10 * 60 * 1_000,
}

/** Bound on remembered failures; expired entries are dropped first. */
const MAX_BACKOFF_ENTRIES = 1_000

export interface PostReloadPorts {
  now(): number
  begin(postIds: readonly string[]): Promise<void>
  /** Resolves true only when every post's events were fetched completely. */
  fetch(postIds: readonly string[], signal: AbortSignal): Promise<boolean>
  commit(postIds: readonly string[]): Promise<void>
  rollback(postIds: readonly string[]): Promise<void>
  onDone(postIds: readonly string[]): void
  limits?: Partial<PostReloadLimits>
}

export class PostReloadQueue {
  readonly #ports: PostReloadPorts
  readonly #limits: PostReloadLimits
  readonly #pending = new Set<string>()
  readonly #inflight = new Set<string>()
  readonly #retryAfter = new Map<string, number>()
  #timer: ReturnType<typeof setTimeout> | undefined
  #running = false

  constructor(ports: PostReloadPorts) {
    this.#ports = ports
    this.#limits = { ...POST_RELOAD_LIMITS, ...ports.limits }
  }

  /** Pending or in flight (the post's rating result is incomplete). */
  has(postId: string): boolean {
    return this.#pending.has(postId) || this.#inflight.has(postId)
  }

  /** Queue a reload unless one is queued or a recent one failed. */
  request(postId: string): void {
    if (this.has(postId)) return
    const retryAfter = this.#retryAfter.get(postId)
    if (retryAfter !== undefined && retryAfter > this.#ports.now()) return
    this.#retryAfter.delete(postId)
    this.#pending.add(postId)
    this.#schedule(this.#limits.debounceMs)
  }

  #schedule(delayMs: number): void {
    if (this.#timer !== undefined || this.#running) return
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      void this.#runBatch()
    }, delayMs)
  }

  async #runBatch(): Promise<void> {
    const batch = [...this.#pending].slice(0, this.#limits.batchSize)
    if (batch.length === 0) return
    this.#running = true
    for (const postId of batch) {
      this.#pending.delete(postId)
      this.#inflight.add(postId)
    }
    const controller = new AbortController()
    const abort = setTimeout(() => controller.abort(), this.#limits.timeoutMs)
    let complete = false
    try {
      await this.#ports.begin(batch)
      complete = await this.#ports.fetch(batch, controller.signal)
    } catch (error) {
      console.info('Attention pruned post reload failed', error)
    } finally {
      clearTimeout(abort)
    }
    try {
      if (complete) {
        await this.#ports.commit(batch)
      } else {
        await this.#ports.rollback(batch)
        this.#backOff(batch)
      }
    } catch (error) {
      console.info('Attention pruned post reload bookkeeping failed', error)
    } finally {
      for (const postId of batch) this.#inflight.delete(postId)
      this.#running = false
      this.#ports.onDone(batch)
      if (this.#pending.size > 0) this.#schedule(this.#limits.spacingMs)
    }
  }

  #backOff(postIds: readonly string[]): void {
    const now = this.#ports.now()
    if (this.#retryAfter.size >= MAX_BACKOFF_ENTRIES) {
      for (const [postId, until] of this.#retryAfter) {
        if (until <= now) this.#retryAfter.delete(postId)
      }
    }
    for (const postId of postIds) {
      if (this.#retryAfter.size >= MAX_BACKOFF_ENTRIES) break
      this.#retryAfter.set(postId, now + this.#limits.retryBackoffMs)
    }
  }
}
