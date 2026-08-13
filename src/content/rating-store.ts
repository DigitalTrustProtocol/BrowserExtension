import type { RatingQueryResult } from '../graph'
import {
  BACKGROUND_API_VERSION,
  MAX_RATING_BATCH_ITEMS,
  type QueryRatingBatchResult,
} from '../shared/contracts'
import { sendMessage } from './trust-store'
import type { TrustDescriptor } from './types'

export type RatingStoreListener = (
  result: RatingQueryResult | undefined,
  error?: string,
) => void

export type RatingStoreResolvedHook = (
  descriptor: TrustDescriptor,
  result: RatingQueryResult,
) => void

const COALESCE_MS = 40

let resolvedHook: RatingStoreResolvedHook | undefined

export function setRatingStoreResolvedHook(
  hook: RatingStoreResolvedHook | undefined,
): void {
  resolvedHook = hook
}

/**
 * Coalesces per-artifact rating lookups into batched background queries.
 */
export class RatingStore {
  readonly #cache = new Map<string, RatingQueryResult>()
  readonly #errors = new Map<string, string>()
  readonly #pending = new Map<string, TrustDescriptor>()
  readonly #inflight = new Set<string>()
  readonly #listeners = new Map<string, Set<RatingStoreListener>>()
  readonly #descriptors = new Map<string, TrustDescriptor>()
  #flushTimer: ReturnType<typeof setTimeout> | undefined
  #flushing = false
  #graphVersion = 0

  get graphVersion(): number {
    return this.#graphVersion
  }

  get(key: string): RatingQueryResult | undefined {
    return this.#cache.get(key)
  }

  getError(key: string): string | undefined {
    return this.#errors.get(key)
  }

  isLoading(key: string): boolean {
    if (this.#cache.has(key) || this.#errors.has(key)) return false
    return this.#pending.has(key) || this.#inflight.has(key)
  }

  subscribe(key: string, listener: RatingStoreListener): () => void {
    const listeners = this.#listeners.get(key) ?? new Set<RatingStoreListener>()
    listeners.add(listener)
    this.#listeners.set(key, listeners)
    if (this.#cache.has(key) || this.#errors.has(key) || this.isLoading(key)) {
      listener(this.#cache.get(key), this.#errors.get(key))
    }
    return () => {
      const current = this.#listeners.get(key)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) this.#listeners.delete(key)
    }
  }

  request(key: string, descriptor: TrustDescriptor): void {
    this.#descriptors.set(key, descriptor)
    if (this.#cache.has(key)) {
      const result = this.#cache.get(key)
      if (result) {
        try {
          resolvedHook?.(descriptor, result)
        } catch {
          /* ignore chrome hook errors */
        }
      }
      this.#notify(key)
      return
    }
    const wasLoading = this.isLoading(key)
    this.#pending.set(key, descriptor)
    if (!wasLoading) this.#notify(key)
    this.#scheduleFlush()
  }

  invalidate(keys: Iterable<string>): void {
    for (const key of keys) {
      this.#cache.delete(key)
      this.#errors.delete(key)
      const descriptor = this.#descriptors.get(key)
      if (descriptor) this.#pending.set(key, descriptor)
      this.#notify(key)
    }
    if (this.#pending.size > 0) this.#scheduleFlush()
  }

  invalidateAll(): void {
    this.#cache.clear()
    this.#errors.clear()
    for (const key of this.#listeners.keys()) {
      const descriptor = this.#descriptors.get(key)
      if (descriptor) this.#pending.set(key, descriptor)
      this.#notify(key)
    }
    if (this.#pending.size > 0) this.#scheduleFlush()
  }

  seed(
    entries: Iterable<{
      key: string
      descriptor: TrustDescriptor
      result: RatingQueryResult
    }>,
  ): void {
    for (const entry of entries) {
      this.#descriptors.set(entry.key, entry.descriptor)
      this.#cache.set(entry.key, entry.result)
      this.#errors.delete(entry.key)
      this.#pending.delete(entry.key)
      this.#inflight.delete(entry.key)
      try {
        resolvedHook?.(entry.descriptor, entry.result)
      } catch {
        /* ignore chrome hook errors */
      }
      this.#notify(entry.key)
    }
  }

  prune(): void {
    for (const key of [...this.#descriptors.keys()]) {
      if (
        this.#listeners.has(key) ||
        this.#pending.has(key) ||
        this.#inflight.has(key)
      ) {
        continue
      }
      this.#descriptors.delete(key)
      this.#cache.delete(key)
      this.#errors.delete(key)
    }
  }

  async flushNow(): Promise<void> {
    if (this.#flushTimer !== undefined) {
      clearTimeout(this.#flushTimer)
      this.#flushTimer = undefined
    }
    await this.#flush()
  }

  #scheduleFlush(): void {
    if (this.#flushTimer !== undefined) return
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = undefined
      void this.#flush()
    }, COALESCE_MS)
  }

  async #flush(): Promise<void> {
    if (this.#flushing) {
      this.#scheduleFlush()
      return
    }
    if (this.#pending.size === 0) return

    this.#flushing = true
    try {
      while (this.#pending.size > 0) {
        const batch = [...this.#pending.entries()].slice(
          0,
          MAX_RATING_BATCH_ITEMS,
        )
        for (const [key] of batch) {
          this.#pending.delete(key)
          this.#inflight.add(key)
        }
        await this.#runBatch(batch)
      }
    } finally {
      this.#flushing = false
    }
  }

  async #runBatch(batch: Array<[string, TrustDescriptor]>): Promise<void> {
    try {
      const response = await sendMessage<QueryRatingBatchResult>({
        type: 'QUERY_RATING_BATCH',
        version: BACKGROUND_API_VERSION,
        items: batch.map(([key, descriptor]) => ({
          key,
          subject: descriptor.subject,
          context: descriptor.context,
        })),
      })
      this.#graphVersion = response.graphVersion
      for (const [key, descriptor] of batch) {
        const result = response.results[key]
        const error = response.errors?.[key]
        this.#inflight.delete(key)
        if (result) {
          this.#cache.set(key, result)
          this.#errors.delete(key)
          try {
            resolvedHook?.(descriptor, result)
          } catch {
            /* ignore chrome hook errors */
          }
        } else if (error) {
          this.#errors.set(key, error)
        }
        this.#notify(key)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      for (const [key] of batch) {
        this.#inflight.delete(key)
        this.#errors.set(key, message)
        this.#notify(key)
      }
    }
  }

  #notify(key: string): void {
    const listeners = this.#listeners.get(key)
    if (!listeners) return
    const result = this.#cache.get(key)
    const error = this.#errors.get(key)
    for (const listener of listeners) listener(result, error)
  }
}

export const ratingStore = new RatingStore()
