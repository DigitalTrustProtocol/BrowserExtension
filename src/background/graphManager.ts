/**
 * One-pass Dexie → heap load. Kind 32009 hops; kind 32014 stored, never hops.
 * Chrome maps and i↔p binds live on the Graph instance.
 */

import { parseHeapIndexId } from '../graph/adapter'
import { normalizeResolveBounds } from '../graph/bounds'
import {
  chromeForNeighborhoodNodes,
  graphIdentities,
  graphPosts,
  putIdentityChrome,
  putPostChrome,
  pubkeyForTwitterId as pubkeyForTwitterIdOnGraph,
  resetGraphChrome,
  twitterIdForPubkey as twitterIdForPubkeyOnGraph,
} from '../graph/chrome'
import {
  neighborhoodFromHeap,
  type NeighborhoodOptions,
  type NeighborhoodResult,
} from '../graph/graph'
import { executeTrustQuery } from '../graph/query'
import { indexResolver } from '../graph/trust'
import {
  heapEdgeKey,
  type GraphTrustConnectionPayload,
} from '../graph/trust/Graph'
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
import {
  demoActorPubkey,
  isDemoActorPubkey,
} from '../shared/demo-actor-key.ts'
import { RATING_STATEMENT_KIND } from '../lib/nostr/kind-32014'
import { TRUST_STATEMENT_KIND } from '../lib/nostr/kind-32009'
import type { AppMode } from '../shared/app-mode'
import type { XIdentityDisplay, XPostDisplay } from '../shared/contracts'
import { IDENTITY_TRUST_CONTEXT } from '../shared/trust-context'
import { WOT_MAX_DEGREE_DEFAULT } from '../shared/wot-max-degree'
import { DEMO_EVENT_STATE } from '../storage'
import type { EventRecord, XIdentityRecord, XPostRecord } from '../storage/types'
import type { RuntimeContext } from './runtimeContext'

const PUBKEY_HEX = /^[0-9a-f]{64}$/

function identitySubject(twitterId: string): string {
  return `user:id:${twitterId}`
}

function stripHeapRecord(record: EventRecord): void {
  record.sig = ''
}

/** Hex to bind for this xIdentities row, or undefined (hold user:id as i). */
export function identityBindPubkey(
  row: XIdentityRecord,
  appMode: AppMode,
): string | undefined {
  if (appMode === 'demo') {
    return demoActorPubkey(row.twitterId)
  }
  if (row.state !== 'verified') return undefined
  const hex = pubkeyFromNpub(primaryNpubFromRow(row))
  if (hex && isDemoActorPubkey(row.twitterId, hex)) return undefined
  return hex
}

export type NeighborhoodPayload = NeighborhoodResult & {
  identities: Record<string, XIdentityDisplay>
  posts: Record<string, XPostDisplay>
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
    resetGraphChrome(this.#ctx.graph)
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
    this.#ctx.graph.clear()
    resetGraphChrome(this.#ctx.graph)
    for (const identity of identities) {
      putIdentityChrome(this.#ctx.graph, identity)
      const pubkey = identityBindPubkey(identity, this.#ctx.appMode)
      if (!pubkey) continue
      this.bindTwitterIdentity(identity.twitterId, pubkey)
    }
  }

  /**
   * Alias `user:id` onto a person hex at one heap index (`Graph.bindIdentity`).
   * Call when a verified npub appears so Node.id rewrites in place.
   */
  bindTwitterIdentity(twitterId: string, hex: string): void {
    const pubkey = hex.toLowerCase()
    if (!PUBKEY_HEX.test(pubkey)) return
    this.#ctx.graph.bindIdentity(identitySubject(twitterId), pubkey)
  }

  async load(): Promise<void> {
    await this.loadAllXIdentities()
    const posts = await this.#ctx.repository.getAllXPosts()
    for (const post of posts) putPostChrome(this.#ctx.graph, post)

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

    await this.#ctx.repository.iterateEventsByKinds(
      [TRUST_STATEMENT_KIND, RATING_STATEMENT_KIND],
      visit,
    )

    this.graphVersion += 1
    this.#loaded = true
  }

  putIdentityChrome(row: XIdentityRecord): void {
    putIdentityChrome(this.#ctx.graph, row)
    if (!this.#loaded) return
    const pubkey = identityBindPubkey(row, this.#ctx.appMode)
    if (!pubkey) return
    this.bindTwitterIdentity(row.twitterId, pubkey)
  }

  putPostChrome(row: XPostRecord): void {
    putPostChrome(this.#ctx.graph, row)
  }

  identityDisplay(twitterId: string): XIdentityDisplay | undefined {
    return graphIdentities(this.#ctx.graph).get(twitterId)
  }

  postDisplay(postId: string): XPostDisplay | undefined {
    return graphPosts(this.#ctx.graph).get(postId)
  }

  twitterIdForPubkey(hex: string): string | undefined {
    return twitterIdForPubkeyOnGraph(this.#ctx.graph, hex)
  }

  pubkeyForTwitterId(twitterId: string): string | undefined {
    return pubkeyForTwitterIdOnGraph(this.#ctx.graph, twitterId)
  }

  incomingUserRecords(keys: {
    twitterId?: string
    pubkeyHexes: ReadonlySet<string>
  }): EventRecord[] {
    const ids = new Set<string>()
    if (keys.twitterId) {
      ids.add(identitySubject(keys.twitterId))
      const bound = this.pubkeyForTwitterId(keys.twitterId)
      if (bound) ids.add(bound)
    }
    for (const hex of keys.pubkeyHexes) ids.add(hex.toLowerCase())
    return this.#trustRecordsFrom(ids, 'in')
  }

  outgoingUserRecords(authorPubkeys: ReadonlySet<string>): EventRecord[] {
    const ids = new Set<string>()
    for (const hex of authorPubkeys) ids.add(hex.toLowerCase())
    return this.#trustRecordsFrom(ids, 'out')
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
      query,
      this.graphVersion,
      this.defaultBounds,
    )
  }

  neighborhood(
    centerId: NeighborhoodResult['centerId'],
    options: NeighborhoodOptions = {},
  ): NeighborhoodPayload {
    const outboundPubkeys = [...(options.outboundPubkeys ?? [])]
    const centerIndex =
      typeof centerId === 'number' ? centerId : parseHeapIndexId(centerId)
    if (centerIndex !== undefined) {
      const centerNode = this.#ctx.graph.nodesList[centerIndex]
      if (centerNode?.type === 'i') {
        const bound = this.#ctx.graph.iToP.get(centerNode.id)
        if (bound) outboundPubkeys.push(bound)
      }
    }
    const result = neighborhoodFromHeap(
      this.#ctx.graph,
      this.graphVersion,
      centerId,
      outboundPubkeys.length > 0
        ? { ...options, outboundPubkeys }
        : options,
    )
    const chrome = chromeForNeighborhoodNodes(this.#ctx.graph, result.nodes)
    return {
      ...result,
      identities: chrome.identities,
      posts: chrome.posts,
    }
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

  #recordForConnection(
    conn: GraphTrustConnectionPayload,
  ): EventRecord | undefined {
    const index = this.#ctx.graph.edgesIndex.get(
      heapEdgeKey(conn.edge.kind, conn.edge.dTag),
    )
    if (index === undefined) return undefined
    return this.#ctx.graph.edgesList[index] ?? undefined
  }

  /**
   * Positive, active, heap-resolved pubkey hops from these authors, including
   * verified `user:id` aliases bound onto a pubkey node.
   */
  positiveChildren(
    authors: readonly string[],
    nowSeconds: number,
  ): string[] {
    const out = new Set<string>()
    const opts = {
      context: IDENTITY_TRUST_CONTEXT,
      value: 1 as const,
      includeInactive: false,
      now: nowSeconds,
    }
    for (const author of authors) {
      const hex = author.trim().toLowerCase()
      if (!PUBKEY_HEX.test(hex)) continue
      for (const conn of this.#ctx.graph.out(hex, opts)) {
        if (conn.subjectType === 'p' && PUBKEY_HEX.test(conn.subject)) {
          out.add(conn.subject.toLowerCase())
          continue
        }
        if (conn.subjectType !== 'i') continue
        const bound = this.#ctx.graph.iToP.get(conn.subject.toLowerCase())
        if (bound && PUBKEY_HEX.test(bound)) out.add(bound)
      }
    }
    return [...out].sort()
  }

  authorsFromRoots(
    roots: readonly string[],
    nowSeconds: number,
    limits: {
      maxDepth: number
      maxAuthorsPerLevel: number
      maxTotalAuthors: number
    },
  ): { authors: string[]; reasons: string[] } {
    return this.positiveAuthorFrontier(roots, limits, nowSeconds)
  }

  positiveAuthorFrontier(
    roots: readonly string[],
    limits: {
      maxDepth: number
      maxAuthorsPerLevel: number
      maxTotalAuthors: number
    },
    nowSeconds = Math.floor(Date.now() / 1_000),
  ): { authors: string[]; reasons: string[] } {
    const reasons = new Set<string>()
    let current = [
      ...new Set(
        roots
          .map((root) => root.trim().toLowerCase())
          .filter((root) => PUBKEY_HEX.test(root)),
      ),
    ].sort()
    if (current.length > limits.maxAuthorsPerLevel) {
      current = current.slice(0, limits.maxAuthorsPerLevel)
      reasons.add('maxAuthorsPerLevel')
    }
    if (current.length > limits.maxTotalAuthors) {
      current = current.slice(0, limits.maxTotalAuthors)
      reasons.add('maxTotalAuthors')
    }
    const discovered = new Set(current)
    for (let depth = 0; depth <= limits.maxDepth; depth += 1) {
      const children = this.positiveChildren(current, nowSeconds).filter(
        (pubkey) => !discovered.has(pubkey),
      )
      if (depth === limits.maxDepth) {
        if (children.length > 0) reasons.add('maxDepth')
        break
      }
      let next = children
      if (next.length > limits.maxAuthorsPerLevel) {
        next = next.slice(0, limits.maxAuthorsPerLevel)
        reasons.add('maxAuthorsPerLevel')
      }
      const remaining = limits.maxTotalAuthors - discovered.size
      if (next.length > remaining) {
        next = next.slice(0, Math.max(0, remaining))
        reasons.add('maxTotalAuthors')
      }
      for (const pubkey of next) discovered.add(pubkey)
      current = next
      if (current.length === 0) break
    }
    return { authors: [...discovered], reasons: [...reasons] }
  }

  referencedTwitterIds(): string[] {
    const ids = new Set<string>()
    for (const iKey of this.#ctx.graph.iToP.keys()) {
      const match = /^user:id:(\d+)$/.exec(iKey)
      if (match?.[1]) ids.add(match[1])
    }
    for (const twitterId of graphIdentities(this.#ctx.graph).keys()) {
      if (/^\d+$/.test(twitterId)) ids.add(twitterId)
    }
    return [...ids]
  }

  #trustRecordsFrom(
    ids: ReadonlySet<string>,
    direction: 'in' | 'out',
  ): EventRecord[] {
    const seen = new Set<string>()
    const records: EventRecord[] = []
    const opts = { context: IDENTITY_TRUST_CONTEXT }
    for (const id of ids) {
      const connections =
        direction === 'in'
          ? this.#ctx.graph.in(id, opts)
          : this.#ctx.graph.out(id, opts)
      for (const conn of connections) {
        const record = this.#recordForConnection(conn)
        if (!record || seen.has(record.id)) continue
        seen.add(record.id)
        records.push(record)
      }
    }
    return records
  }
}
