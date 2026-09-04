/**
 * One-pass Dexie → heap load. Kind 32009 hops; kind 32014 stored, never hops.
 */

import { normalizeResolveBounds } from '../graph/bounds'
import {
  clearIdentityDistrust,
  isBlockedPubkeyHop,
  recordIdentityDistrust,
  updateIdentityDistrustBlock,
} from '../graph/derived-identity-hops'
import {
  neighborhoodFromHeap,
  type NeighborhoodOptions,
  type NeighborhoodResult,
} from '../graph/graph'
import { executeTrustQuery } from '../graph/query'
import { artifactRatingResolver } from '../graph/ratings/ArtifactRatingResolver'
import indexResolver from '../graph/trust/IndexResolver'
import { trustEdgeValue } from '../graph/trust/Edge'
import type {
  RatingQuery,
  RatingQueryResult,
  ResolveBounds,
  TrustQuery,
  TrustQueryResult,
} from '../graph/types'
import {
  primaryNpubFromRow,
  pubkeyFromNpub,
} from '../identity/x-identity-row'
import { RATING_STATEMENT_KIND } from '../shared/kind-32014'
import { TRUST_STATEMENT_KIND } from '../shared/kind-32009'
import { WOT_MAX_DEGREE_DEFAULT } from '../shared/wot-max-degree'
import { DEMO_EVENT_STATE } from '../storage'
import type { EventRecord } from '../storage/types'
import type { RuntimeContext } from './runtimeContext'

const YIELD_EVERY = 256
const ESTIMATED_BYTES_PER_EVENT = 4096
export const GRAPH_COLUMNS_BACKFILL_KEY = 'graphColumnsBackfilledAt'

function graphMemoryBudgetBytes(): number | undefined {
  const perf = performance as Performance & {
    memory?: { jsHeapSizeLimit: number; usedJSHeapSize: number }
  }
  if (perf.memory && perf.memory.jsHeapSizeLimit > 0) {
    return Math.max(
      0,
      (perf.memory.jsHeapSizeLimit - perf.memory.usedJSHeapSize) * 0.5,
    )
  }
  const nav = navigator as Navigator & { deviceMemory?: number }
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0) {
    return nav.deviceMemory * 1024 * 1024 * 1024 * 0.1
  }
  return undefined
}

function stripHeapRecord(record: EventRecord): void {
  record.sig = ''
}

function identitySubject(twitterId: string): string {
  return `user:id:${twitterId}`
}

export class GraphManager {
  readonly #ctx: RuntimeContext
  #blocked = new Map<string, Set<string>>()
  readonly defaultBounds: Readonly<ResolveBounds>
  graphVersion = 0
  #loaded = false

  constructor(ctx: RuntimeContext) {
    this.#ctx = ctx
    this.defaultBounds = normalizeResolveBounds({
      maxDepth: WOT_MAX_DEGREE_DEFAULT,
    })
  }

  invalidate(): void {
    this.#loaded = false
  }

  clear(): void {
    this.#ctx.graph.clear()
    this.#blocked.clear()
    this.graphVersion += 1
    this.#loaded = true
  }

  async ensureLoaded(): Promise<boolean> {
    if (this.#loaded) return false
    await this.load()
    return true
  }

  async load(): Promise<void> {
    await this.#backfillGraphColumnsOnce()

    const identities = await this.#ctx.repository.getAllXIdentities()
    this.#ctx.twitterIdToPubkey.clear()
    this.#ctx.graph.clear()
    for (const identity of identities) {
      if (identity.state !== 'verified') continue
      const pubkey = pubkeyFromNpub(primaryNpubFromRow(identity))
      if (!pubkey) continue
      const hex = pubkey.toLowerCase()
      this.#ctx.twitterIdToPubkey.set(identity.twitterId, hex)
      this.#ctx.graph.bindIdentity(identitySubject(identity.twitterId), hex)
    }

    const demo = this.#ctx.appMode === 'demo'
    const count = demo
      ? await this.#ctx.repository.countEventsByState(DEMO_EVENT_STATE)
      : await this.#ctx.repository.countEvents()
    const budget = graphMemoryBudgetBytes()
    if (budget !== undefined && count * ESTIMATED_BYTES_PER_EVENT > budget) {
      throw new Error(
        `Insufficient memory for graph load: estimated ${count * ESTIMATED_BYTES_PER_EVENT} bytes for ${count} events`,
      )
    }

    this.#blocked.clear()

    const blocked = new Map<string, Set<string>>()
    const deferredPTrust: EventRecord[] = []
    let visited = 0

    const visit = async (record: EventRecord): Promise<void> => {
      if (this.#ctx.abortController.signal.aborted) {
        throw new DOMException('Graph load aborted', 'AbortError')
      }
      visited += 1
      if (visited % YIELD_EVERY === 0) {
        await Promise.resolve()
      }
      if (demo) {
        if (record.state !== DEMO_EVENT_STATE) return
      } else if (record.state === DEMO_EVENT_STATE) {
        return
      }

      if (record.kind === RATING_STATEMENT_KIND) {
        stripHeapRecord(record)
        this.#ctx.graph.applyTrustEvent(record)
        return
      }
      if (record.kind !== TRUST_STATEMENT_KIND) return

      const value = trustEdgeValue(record)
      if (value === undefined) {
        this.#ctx.graph.applyTrustEvent(record)
        return
      }

      if (record.subjectType === 'p' && value === 1) {
        deferredPTrust.push(record)
        return
      }

      stripHeapRecord(record)
      this.#ctx.graph.applyTrustEvent(record)
      recordIdentityDistrust(record, this.#ctx.twitterIdToPubkey, blocked)
    }

    if (demo) {
      await this.#ctx.repository.iterateEventsByState(DEMO_EVENT_STATE, visit)
    } else {
      await this.#ctx.repository.iterateEventsByKinds(
        [TRUST_STATEMENT_KIND, RATING_STATEMENT_KIND],
        visit,
      )
    }

    for (const record of deferredPTrust) {
      if (
        record.subject &&
        isBlockedPubkeyHop(blocked, record.pubkey, record.subject)
      ) {
        continue
      }
      stripHeapRecord(record)
      this.#ctx.graph.applyTrustEvent(record)
    }

    this.#blocked = blocked
    this.graphVersion += 1
    this.#loaded = true
  }

  /**
   * Apply one stored 32009/32014 winner into the live heap. No Dexie rescan.
   * Tombstones (empty `v` / empty `score`) unapply the previous slot.
   */
  applyRecord(record: EventRecord): boolean {
    if (!this.#loaded) return false
    if (!this.#matchesMode(record)) return false
    const changed = this.#applyRecordNoBump(record)
    if (changed) this.graphVersion += 1
    return changed
  }

  /** Drop a stored winner from the live heap (outbox delete / wipe of one row). */
  removeRecord(record: EventRecord): boolean {
    if (!this.#loaded) return false
    const changed = this.#removeRecordNoBump(record)
    if (changed) this.graphVersion += 1
    return changed
  }

  #matchesMode(record: EventRecord): boolean {
    const demo = this.#ctx.appMode === 'demo'
    if (demo) return record.state === DEMO_EVENT_STATE
    return record.state !== DEMO_EVENT_STATE
  }

  #applyRecordNoBump(record: EventRecord): boolean {
    if (record.kind === RATING_STATEMENT_KIND) {
      stripHeapRecord(record)
      return this.#ctx.graph.applyTrustEvent(record)
    }
    if (record.kind !== TRUST_STATEMENT_KIND) return false
    const value = trustEdgeValue(record)
    if (value === undefined) {
      const changed = this.#ctx.graph.applyTrustEvent(record)
      clearIdentityDistrust(
        record,
        this.#ctx.twitterIdToPubkey,
        this.#blocked,
      )
      return changed
    }
    if (
      record.subjectType === 'p' &&
      value === 1 &&
      record.subject &&
      isBlockedPubkeyHop(this.#blocked, record.pubkey, record.subject)
    ) {
      return this.#removeTrustSlot(record)
    }
    stripHeapRecord(record)
    const changed = this.#ctx.graph.applyTrustEvent(record)
    updateIdentityDistrustBlock(
      record,
      this.#ctx.twitterIdToPubkey,
      this.#blocked,
    )
    if (
      value === -1 &&
      record.subjectType === 'i' &&
      record.subject
    ) {
      const pubkey = this.#ctx.graph.iToP.get(record.subject)
      if (pubkey) {
        this.#removeNativePTrust(record.pubkey, pubkey)
      }
    }
    return changed
  }

  #removeNativePTrust(author: string, pubkey: string): void {
    for (const edge of this.#ctx.graph.edgesList) {
      if (!edge || edge.kind !== TRUST_STATEMENT_KIND) continue
      if (edge.pubkey.toLowerCase() !== author.toLowerCase()) continue
      if (edge.subjectType !== 'p' || edge.subject !== pubkey) continue
      if (trustEdgeValue(edge) !== 1) continue
      this.#ctx.graph.removeTrustEvent(edge)
    }
  }

  #removeRecordNoBump(record: EventRecord): boolean {
    if (
      record.kind !== TRUST_STATEMENT_KIND &&
      record.kind !== RATING_STATEMENT_KIND
    ) {
      return false
    }
    return this.#removeTrustSlot(record)
  }

  #removeTrustSlot(record: EventRecord): boolean {
    if (!record.addressableId) return false
    clearIdentityDistrust(
      record,
      this.#ctx.twitterIdToPubkey,
      this.#blocked,
    )
    return this.#ctx.graph.removeTrustEvent(record)
  }

  query(query: TrustQuery): TrustQueryResult {
    return executeTrustQuery(
      this.#ctx.graph,
      indexResolver,
      {
        ...query,
        bounds: { ...this.defaultBounds, ...query.bounds },
      },
      this.graphVersion,
    )
  }

  queryRating(query: RatingQuery): RatingQueryResult {
    return artifactRatingResolver.resolve(
      this.#ctx.graph,
      indexResolver,
      this.listClaims(),
      query,
      this.graphVersion,
      this.defaultBounds,
    )
  }

  neighborhood(
    centerId: NeighborhoodResult['centerId'],
    options: NeighborhoodOptions = {},
  ): NeighborhoodResult {
    return neighborhoodFromHeap(
      this.#ctx.graph,
      this.listClaims(),
      this.graphVersion,
      centerId,
      options,
    )
  }

  /**
   * Live heap 32009 edges. Protocol `subject` is unchanged even when adjacency
   * sits on a pubkey node. Heap records may have `sig` stripped; scope checks
   * must use repository reads.
   */
  listStatements(): EventRecord[] {
    const out: EventRecord[] = []
    for (const edge of this.#ctx.graph.edgesList) {
      if (!edge || edge.kind !== TRUST_STATEMENT_KIND) continue
      out.push(edge)
    }
    return out
  }

  listClaims(): EventRecord[] {
    const out: EventRecord[] = []
    for (const edge of this.#ctx.graph.edgesList) {
      if (!edge || edge.kind !== RATING_STATEMENT_KIND) continue
      out.push(edge)
    }
    return out
  }

  async #backfillGraphColumnsOnce(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get(GRAPH_COLUMNS_BACKFILL_KEY)
      if (stored[GRAPH_COLUMNS_BACKFILL_KEY]) return
    } catch {
      /* tests without chrome still backfill */
    }
    await this.#ctx.repository.backfillGraphColumns()
    try {
      await chrome.storage.local.set({
        [GRAPH_COLUMNS_BACKFILL_KEY]: Date.now(),
      })
    } catch {
      /* ignore */
    }
  }
}
