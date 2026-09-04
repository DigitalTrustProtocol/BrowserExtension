/**
 * One-pass Dexie → heap load. Kind 32009 hops; kind 32014 stored, never hops.
 */

import { normalizeResolveBounds } from '../graph/bounds'
import {
  neighborhoodFromHeap,
  type NeighborhoodOptions,
  type NeighborhoodResult,
} from '../graph/graph'
import identityIndexResolver from '../graph/identity-index-resolver'
import { executeTrustQuery } from '../graph/query'
import { artifactRatingResolver } from '../graph/ratings/ArtifactRatingResolver'
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
import { RATING_STATEMENT_KIND } from '../lib/nostr/kind-32014'
import { TRUST_STATEMENT_KIND } from '../lib/nostr/kind-32009'
import { WOT_MAX_DEGREE_DEFAULT } from '../shared/wot-max-degree'
import { DEMO_EVENT_STATE } from '../storage'
import type { EventRecord } from '../storage/types'
import type { RuntimeContext } from './runtimeContext'

const ESTIMATED_BYTES_PER_EVENT = 4096

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
    this.graphVersion += 1
    this.#loaded = true
  }

  async ensureLoaded(): Promise<boolean> {
    if (this.#loaded) return false
    await this.load()
    return true
  }


  async loadAllXIdentities(): Promise<void> {
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
  }

  async checkMemoryBudget(): Promise<void> {
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
  }


  async load(): Promise<void> {
    await this.loadAllXIdentities()

    //await this.checkMemoryBudget()
    const demo = this.#ctx.appMode === 'demo'

    const checkState = (record: EventRecord): boolean => {
      if (demo) {
        return record.state === DEMO_EVENT_STATE
      } else {
        return record.state !== DEMO_EVENT_STATE
      }
    }

    const visit = (record: EventRecord): void => {
      if (this.#ctx.abortController.signal.aborted) {
        throw new DOMException('Graph load aborted', 'AbortError')
      }
      if (!checkState(record)) return
      stripHeapRecord(record)
      this.#ctx.graph.applyTrustEvent(record)
    }

    await this.#ctx.repository.iterateEventsByKinds([TRUST_STATEMENT_KIND, RATING_STATEMENT_KIND], visit)

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
    if (
      record.kind !== TRUST_STATEMENT_KIND &&
      record.kind !== RATING_STATEMENT_KIND
    ) {
      return false
    }
    stripHeapRecord(record)
    return this.#ctx.graph.applyTrustEvent(record)
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
    return this.#ctx.graph.removeTrustEvent(record)
  }

  query(query: TrustQuery): TrustQueryResult {
    return executeTrustQuery(
      this.#ctx.graph,
      identityIndexResolver,
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
      identityIndexResolver,
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
}
