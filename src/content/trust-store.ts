import type { TrustQueryResult } from '../graph'
import {
  BACKGROUND_API_VERSION,
  MAX_TRUST_BATCH_ITEMS,
  type ExtensionRequest,
  type ExtensionResponse,
  type QueryTrustBatchResult,
} from '../shared/contracts'
import type { TrustDescriptor } from './types'

export type TrustStoreListener = (
  result: TrustQueryResult | undefined,
  error?: string,
) => void

/** Optional hook after a subject is resolved (used for trust-gated xPosts chrome). */
export type TrustStoreResolvedHook = (
  descriptor: TrustDescriptor,
  result: TrustQueryResult,
) => void

const COALESCE_MS = 40

let resolvedHook: TrustStoreResolvedHook | undefined

export function setTrustStoreResolvedHook(
  hook: TrustStoreResolvedHook | undefined,
): void {
  resolvedHook = hook
}

export async function sendMessage<T>(message: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    message,
  )) as ExtensionResponse<T>
  if (response.version !== BACKGROUND_API_VERSION) {
    throw new Error('Unsupported Attention background API version')
  }
  if (!response.ok) {
    throw new Error(response.error || 'Attention background request failed')
  }
  return response.data
}

export function descriptorKey(descriptor: TrustDescriptor): string {
  return `${descriptor.subject.type}:${descriptor.subject.value}|${descriptor.context ?? ''}`
}

/**
 * Coalesces per-subject trust lookups into batched background queries and
 * fans results back out to every renderer showing the same subject.
 */
export class TrustStore {
  readonly #cache = new Map<string, TrustQueryResult>()
  readonly #errors = new Map<string, string>()
  readonly #pending = new Map<string, TrustDescriptor>()
  readonly #inflight = new Set<string>()
  readonly #listeners = new Map<string, Set<TrustStoreListener>>()
  readonly #descriptors = new Map<string, TrustDescriptor>()
  readonly #mutations = new Set<string>()
  #flushTimer: ReturnType<typeof setTimeout> | undefined
  #flushing = false
  #graphVersion = 0

  get graphVersion(): number {
    return this.#graphVersion
  }

  get(key: string): TrustQueryResult | undefined {
    return this.#cache.get(key)
  }

  getError(key: string): string | undefined {
    return this.#errors.get(key)
  }

  /**
   * True while a publish is in flight or a background trust query is queued /
   * in flight for this key.
   */
  isLoading(key: string): boolean {
    if (this.#mutations.has(key)) return true
    if (this.#cache.has(key) || this.#errors.has(key)) return false
    return this.#pending.has(key) || this.#inflight.has(key)
  }

  /** Chip spinner stays on while a statement is publishing, even with cache. */
  beginMutation(key: string): void {
    if (this.#mutations.has(key)) return
    this.#mutations.add(key)
    this.#notify(key)
  }

  endMutation(key: string): void {
    if (!this.#mutations.delete(key)) return
    this.#notify(key)
  }

  subscribe(key: string, listener: TrustStoreListener): () => void {
    const listeners = this.#listeners.get(key) ?? new Set<TrustStoreListener>()
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

  /** Drops cached results for the given keys and re-requests them. */
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

  /** Drops every cached result and re-requests all subscribed subjects. */
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

  /**
   * Insert full batch results without a network round-trip (e.g. JSON filter
   * resolve). Existing listeners are notified; pending fetches for those keys
   * are cancelled. Invalidation still clears these entries.
   */
  seed(
    entries: Iterable<{
      key: string
      descriptor: TrustDescriptor
      result: TrustQueryResult
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

  /** Forgets subjects that no renderer is watching any more. */
  prune(): void {
    for (const key of [...this.#descriptors.keys()]) {
      if (
        this.#listeners.has(key) ||
        this.#pending.has(key) ||
        this.#inflight.has(key) ||
        this.#mutations.has(key)
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
          MAX_TRUST_BATCH_ITEMS,
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
      const response = await sendMessage<QueryTrustBatchResult>({
        type: 'QUERY_TRUST_BATCH',
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

export const trustStore = new TrustStore()
