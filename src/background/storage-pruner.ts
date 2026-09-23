/**
 * Throttled storage pruning. Runs one small slice per alarm tick, only while
 * local usage is above the soft budget and a prune toggle is on:
 *
 * 1. Events authored outside the web of trust of every local key (positive
 *    trust within Max degree) that have been held at least 30 days. Such an
 *    author cannot affect any score for those roots.
 * 2. Events on posts not seen on X for `postIdleDays`. The `xPosts` row stays
 *    as a skeleton (`prunedAt`).
 *
 * `xIdentities` rows are never touched. Own statements are never removed.
 */

import { DEMO_EVENT_STATE } from '../storage/demo-event-state'
import { DAY_MS } from '../storage/seen-days'
import type { EventRecord, XPostRecord } from '../storage/types'
import type { AttentionXRepository } from '../storage/repository'
import type {
  StoragePruneSkipReason,
  StoragePruneStatus,
} from '../shared/contracts'
import {
  isStoragePruningEnabled,
  storageBudgetStatus,
  USER_EVENT_PRUNE_MIN_HELD_DAYS,
  type StorageRetentionSettings,
} from '../shared/storage-retention'
import type { GraphManager } from './graphManager'

export interface StoragePruneLimits {
  /** Heap edges examined between yields. */
  scanChunk: number
  /** Idle posts examined per repository read. */
  postBatch: number
  /** Wall-clock scan budget per tick. */
  tickBudgetMs: number
  /** Hard cap on events removed per tick. */
  maxDeletesPerTick: number
}

export const STORAGE_PRUNE_LIMITS: StoragePruneLimits = {
  scanChunk: 250,
  postBatch: 25,
  tickBudgetMs: 40,
  maxDeletesPerTick: 500,
}

export interface StoragePrunerPorts {
  now(): number
  /** Monotonic ms for the per-tick time budget. */
  clockMs(): number
  settings(): StorageRetentionSettings
  wotMaxDegree(): number
  isDemoMode(): boolean
  isBatchSyncRunning(): boolean
  usageBytes(): Promise<number | undefined>
  /** Every local account key (vault, local mirror, X bindings). */
  rootPubkeys(): Promise<string[]>
  ensureGraphReady(): Promise<void>
  graph: Pick<
    GraphManager,
    'reachableAuthors' | 'storedRecordsFrom' | 'incomingRecords' | 'removeRecord'
  >
  repository: Pick<
    AttentionXRepository,
    | 'deleteEvents'
    | 'deleteSyncCursorsForAuthors'
    | 'scanIdleXPosts'
    | 'markXPostsPruned'
  >
  /** Put skeleton chrome (with `prunedAt`) back on the Graph. */
  onPostsPruned(rows: XPostRecord[]): void
  /** Clear memos and notify UI once per tick that removed events. */
  onEventsRemoved(): void
  yieldToEventLoop?(): Promise<void>
  limits?: Partial<StoragePruneLimits>
}

/** Held-long-enough event by an author outside the reachable set. */
export function isOutsideWotPrunable(
  record: EventRecord,
  reachable: ReadonlySet<string>,
  heldBefore: number,
): boolean {
  if (record.state === DEMO_EVENT_STATE) return false
  if (reachable.has(record.pubkey.toLowerCase())) return false
  return record.firstSeenAt < heldBefore
}

interface TickBudget {
  deadline: number
  remaining: number
}

function defaultYield(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export class StoragePruner {
  readonly #ports: StoragePrunerPorts
  readonly #limits: StoragePruneLimits
  #edgeCursor = 0
  #running = false
  #status: StoragePruneStatus = { lastDeleted: 0, totalDeleted: 0 }

  constructor(ports: StoragePrunerPorts) {
    this.#ports = ports
    this.#limits = { ...STORAGE_PRUNE_LIMITS, ...ports.limits }
  }

  status(): StoragePruneStatus {
    return { ...this.#status }
  }

  async tick(): Promise<StoragePruneStatus> {
    const skip = await this.#skipReason()
    if (skip) {
      this.#status = { ...this.#status, lastSkipped: skip }
      return this.status()
    }
    this.#running = true
    try {
      await this.#ports.ensureGraphReady()
      const settings = this.#ports.settings()
      const budget: TickBudget = {
        deadline: this.#ports.clockMs() + this.#limits.tickBudgetMs,
        remaining: this.#limits.maxDeletesPerTick,
      }
      let deleted = 0
      if (settings.pruneUserEvents) {
        deleted += await this.#pruneOutsideWot(budget)
      }
      if (settings.prunePostEvents && this.#hasBudget(budget)) {
        deleted += await this.#pruneIdlePosts(budget, settings)
      }
      if (deleted > 0) this.#ports.onEventsRemoved()
      this.#status = {
        lastRunAt: this.#ports.now(),
        lastDeleted: deleted,
        totalDeleted: this.#status.totalDeleted + deleted,
      }
      return this.status()
    } finally {
      this.#running = false
    }
  }

  async #skipReason(): Promise<StoragePruneSkipReason | undefined> {
    if (this.#running) return 'running'
    const settings = this.#ports.settings()
    if (!isStoragePruningEnabled(settings)) return 'disabled'
    if (this.#ports.isDemoMode()) return 'demo'
    if (this.#ports.isBatchSyncRunning()) return 'syncRunning'
    const usage = await this.#ports.usageBytes()
    if (usage === undefined) return 'withinBudget'
    return storageBudgetStatus(usage, settings) === 'ok'
      ? 'withinBudget'
      : undefined
  }

  #hasBudget(budget: TickBudget): boolean {
    return budget.remaining > 0 && this.#ports.clockMs() < budget.deadline
  }

  async #pruneOutsideWot(budget: TickBudget): Promise<number> {
    const roots = await this.#ports.rootPubkeys()
    if (roots.length === 0) return 0
    const now = this.#ports.now()
    const reachable = this.#ports.graph.reachableAuthors(
      roots,
      this.#ports.wotMaxDegree(),
      Math.floor(now / 1_000),
    )
    const heldBefore = now - USER_EVENT_PRUNE_MIN_HELD_DAYS * DAY_MS
    const candidates: EventRecord[] = []
    while (candidates.length < budget.remaining && this.#hasBudget(budget)) {
      const slice = this.#ports.graph.storedRecordsFrom(
        this.#edgeCursor,
        this.#limits.scanChunk,
      )
      this.#edgeCursor = slice.done ? 0 : slice.next
      for (const record of slice.records) {
        if (isOutsideWotPrunable(record, reachable, heldBefore)) {
          candidates.push(record)
        }
      }
      if (slice.done) break
      await this.#yield()
    }
    const chosen = candidates.slice(0, budget.remaining)
    const deleted = await this.#remove(chosen)
    budget.remaining -= deleted
    await this.#ports.repository.deleteSyncCursorsForAuthors(
      new Set(chosen.map((record) => record.pubkey.toLowerCase())),
    )
    return deleted
  }

  async #pruneIdlePosts(
    budget: TickBudget,
    settings: StorageRetentionSettings,
  ): Promise<number> {
    const now = this.#ports.now()
    const own = new Set(
      (await this.#ports.rootPubkeys()).map((key) => key.toLowerCase()),
    )
    let deleted = 0
    while (this.#hasBudget(budget)) {
      const scan = await this.#ports.repository.scanIdleXPosts(
        now - settings.postIdleDays * DAY_MS,
        this.#limits.postBatch,
      )
      if (scan.ids.length === 0) break
      const prunedIds: string[] = []
      const records: EventRecord[] = []
      for (const postId of scan.ids) {
        const postRecords = this.#ports.graph
          .incomingRecords([`post:id:${postId}`])
          .filter(
            (record) =>
              record.state !== DEMO_EVENT_STATE &&
              !own.has(record.pubkey.toLowerCase()),
          )
        const fits = records.length + postRecords.length <= budget.remaining
        if (!fits && prunedIds.length > 0) break
        records.push(...postRecords)
        prunedIds.push(postId)
      }
      const removed = await this.#remove(records)
      budget.remaining -= removed
      deleted += removed
      this.#ports.onPostsPruned(
        await this.#ports.repository.markXPostsPruned(prunedIds, now),
      )
      await this.#yield()
    }
    return deleted
  }

  async #remove(records: readonly EventRecord[]): Promise<number> {
    if (records.length === 0) return 0
    const deleted = await this.#ports.repository.deleteEvents(
      records.map((record) => record.id),
    )
    for (const record of records) this.#ports.graph.removeRecord(record)
    return deleted.length
  }

  #yield(): Promise<void> {
    return (this.#ports.yieldToEventLoop ?? defaultYield)()
  }
}
