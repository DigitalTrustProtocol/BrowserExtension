/**
 * LocalTrustGraph facade over vendored Trust heap Graph + IResolveStrategy.
 */

import {
  classifyTrustSubject,
  heapIndexId,
  parseHeapIndexId,
  visIdRecordKey,
  ratingClaimSlotId,
  ratingScoreToEdgeValue,
  slotAddressableId,
  statementToTrustEvent,
} from './adapter'
import { normalizeResolveBounds } from './bounds'
import { executeTrustQuery } from './query'
import { viewNodeFromHeap } from './path-view'
import {
  artifactRatingResolver,
  isRatingClaimActive,
} from './ratings/ArtifactRatingResolver'
import { Graph } from './trust/Graph'
import indexResolver from './trust/IndexResolver'
import type { IResolveStrategy } from './trust/IResolveStrategy'
import type {
  GraphNodeKind,
  GraphPathViewEdge,
  GraphPathViewNode,
  GraphUpdateResult,
  GraphVisId,
  RatingQuery,
  RatingQueryResult,
  ReducedRatingClaim,
  ReducedTrustStatement,
  ResolveBounds,
  TrustQuery,
  TrustQueryResult,
  TrustSubject,
} from './types'
import { WOT_MAX_DEGREE_DEFAULT } from '../shared/wot-max-degree'
import { cloneLabelHints } from '../shared/kind-32009'

export type { GraphNodeKind } from './types'

export type GraphViewNode = GraphPathViewNode
export type GraphViewEdge = GraphPathViewEdge

export type NeighborhoodDirection = 'out' | 'in' | 'both'
export type NeighborhoodValueFilter = 'trust' | 'distrust' | 'both'

function cloneStatement(
  statement: ReducedTrustStatement,
): ReducedTrustStatement {
  const labelHints = cloneLabelHints(statement.labelHints)
  return {
    ...statement,
    subject: { ...statement.subject },
    ...(statement.labels !== undefined ? { labels: [...statement.labels] } : {}),
    ...(labelHints !== undefined ? { labelHints } : {}),
    ...(statement.derivedFrom
      ? {
          derivedFrom: {
            subject: { ...statement.derivedFrom.subject },
            twitterId: statement.derivedFrom.twitterId,
          },
        }
      : {}),
  }
}

function replaces(
  candidate: ReducedTrustStatement,
  current: ReducedTrustStatement,
): boolean {
  return (
    candidate.createdAt > current.createdAt ||
    (candidate.createdAt === current.createdAt &&
      candidate.eventId.localeCompare(current.eventId) < 0)
  )
}

function valueMatches(
  value: 1 | 0 | -1,
  filter: NeighborhoodValueFilter,
): boolean {
  if (filter === 'both') return true
  if (filter === 'trust') return value === 1
  if (filter === 'distrust') return value === -1
  return false
}

function cloneClaim(claim: ReducedRatingClaim): ReducedRatingClaim {
  const labelHints = cloneLabelHints(claim.labelHints)
  return {
    ...claim,
    subject: { ...claim.subject },
    labels: [...claim.labels],
    ...(labelHints !== undefined ? { labelHints } : {}),
  }
}

function claimReplaces(
  candidate: ReducedRatingClaim,
  current: ReducedRatingClaim,
): boolean {
  return (
    candidate.createdAt > current.createdAt ||
    (candidate.createdAt === current.createdAt &&
      candidate.eventId.localeCompare(current.eventId) < 0)
  )
}

/**
 * In-memory Trust Graph over replacement-reduced kind-32009 statements.
 * Kind 32014 ratings live in a sibling claim index — never as hops.
 * Resolve via pluggable IResolveStrategy (default IndexResolver).
 */
export class LocalTrustGraph {
  readonly #graph = new Graph()
  readonly #slots = new Map<string, ReducedTrustStatement>()
  readonly #claims = new Map<string, ReducedRatingClaim>()
  #resolver: IResolveStrategy = indexResolver

  graphVersion = 0
  readonly defaultBounds: Readonly<ResolveBounds>

  constructor(
    statements: Iterable<ReducedTrustStatement> = [],
    defaultBounds: Partial<ResolveBounds> = {},
    resolver: IResolveStrategy = indexResolver,
  ) {
    this.defaultBounds = normalizeResolveBounds({
      maxDepth: WOT_MAX_DEGREE_DEFAULT,
      ...defaultBounds,
    })
    this.#resolver = resolver
    this.rebuild(statements)
  }

  setResolver(resolver: IResolveStrategy): void {
    this.#resolver = resolver
  }

  get resolver(): IResolveStrategy {
    return this.#resolver
  }

  /** Underlying Trust heap graph (for tests / advanced callers). */
  get trustGraph(): Graph {
    return this.#graph
  }

  rebuild(statements: Iterable<ReducedTrustStatement>): GraphUpdateResult {
    this.#graph.clear()
    this.#slots.clear()

    let accepted = 0
    let ignored = 0
    for (const statement of statements) {
      if (this.applyStatement(statement)) {
        accepted += 1
      } else {
        ignored += 1
      }
    }

    this.graphVersion += 1
    return { accepted, ignored, graphVersion: this.graphVersion }
  }

  update(statements: Iterable<ReducedTrustStatement>): GraphUpdateResult {
    let accepted = 0
    let ignored = 0
    for (const statement of statements) {
      if (this.applyStatement(statement)) {
        accepted += 1
      } else {
        ignored += 1
      }
    }

    if (accepted > 0) {
      this.graphVersion += 1
    }
    return { accepted, ignored, graphVersion: this.graphVersion }
  }

  upsert(statement: ReducedTrustStatement): boolean {
    return this.update([statement]).accepted === 1
  }

  query(query: TrustQuery): TrustQueryResult {
    return executeTrustQuery(
      this.#graph,
      this.#resolver,
      {
        ...query,
        bounds: { ...this.defaultBounds, ...query.bounds },
      },
      this.graphVersion,
    )
  }

  rebuildClaims(claims: Iterable<ReducedRatingClaim>): GraphUpdateResult {
    this.#claims.clear()
    let accepted = 0
    let ignored = 0
    for (const claim of claims) {
      if (this.applyClaim(claim)) {
        accepted += 1
      } else {
        ignored += 1
      }
    }
    this.graphVersion += 1
    return { accepted, ignored, graphVersion: this.graphVersion }
  }

  updateClaims(claims: Iterable<ReducedRatingClaim>): GraphUpdateResult {
    let accepted = 0
    let ignored = 0
    for (const claim of claims) {
      if (this.applyClaim(claim)) {
        accepted += 1
      } else {
        ignored += 1
      }
    }
    if (accepted > 0) {
      this.graphVersion += 1
    }
    return { accepted, ignored, graphVersion: this.graphVersion }
  }

  queryRating(query: RatingQuery): RatingQueryResult {
    return artifactRatingResolver.resolve(
      this.#graph,
      this.#resolver,
      [...this.#claims.values()],
      query,
      this.graphVersion,
      this.defaultBounds,
    )
  }

  listClaims(): ReducedRatingClaim[] {
    return [...this.#claims.values()].map(cloneClaim)
  }

  listStatements(): ReducedTrustStatement[] {
    return [...this.#slots.values()].map(cloneStatement)
  }

  /**
   * Ego network from root: BFS trusted p edges + terminal i/e evidence.
   */
  egoSnapshot(
    rootPubkey: string,
    options: {
      maxDepth?: number
      context?: string
      now?: number
      maxNodes?: number
    } = {},
  ): {
    graphVersion: number
    rootPubkey: string
    rootIndex?: number
    nodeCount: number
    edgeCount: number
    truncated: boolean
    nodes: GraphViewNode[]
    edges: GraphViewEdge[]
  } {
    const maxDepth = Math.max(1, Math.min(options.maxDepth ?? 4, 6))
    const maxNodes = Math.max(10, Math.min(options.maxNodes ?? 400, 2_000))
    const context = options.context ?? ''
    const now = options.now ?? Math.floor(Date.now() / 1_000)
    const nodes = new Map<GraphVisId, GraphViewNode>()
    const edges: GraphViewEdge[] = []
    let truncated = false

    const ensureNode = (
      id: string,
      kind: GraphNodeKind,
      depth: number,
      label: string,
    ): boolean => {
      const existing = nodes.get(id)
      if (existing) {
        if (depth < existing.depth) existing.depth = depth
        return true
      }
      if (nodes.size >= maxNodes) {
        truncated = true
        return false
      }
      nodes.set(id, { id, kind, depth, label })
      return true
    }

    const root = rootPubkey.toLowerCase()
    const rootId = `p:${root}`
    ensureNode(rootId, 'pubkey', 0, 'You')

    const queue: Array<{ pubkey: string; depth: number }> = [
      { pubkey: root, depth: 0 },
    ]
    const visited = new Set<string>([root])

    while (queue.length > 0) {
      const current = queue.shift()!
      if (current.depth >= maxDepth) continue

      const outbound = this.#graph.out(current.pubkey, {
        context,
        now,
        includeInactive: false,
      })

      for (const conn of outbound) {
        const targetValue = conn.edge.value
        if (targetValue !== 1 && targetValue !== -1 && targetValue !== 0) {
          continue
        }
        const subject: TrustSubject = {
          type: conn.subjectType,
          value: conn.subject,
        }
        const target = classifyTrustSubject(subject)
        if (
          !ensureNode(target.id, target.kind, current.depth + 1, target.label)
        ) {
          continue
        }
        edges.push({
          id: conn.edge.eventId ?? conn.edge.dTag,
          from: `p:${current.pubkey}`,
          to: target.id,
          value: targetValue,
          context: conn.edge.context,
          eventId: conn.edge.eventId ?? conn.edge.dTag,
          depth: current.depth + 1,
        })
        if (
          conn.edge.value === 1 &&
          conn.subjectType === 'p' &&
          !visited.has(conn.subject)
        ) {
          visited.add(conn.subject)
          queue.push({ pubkey: conn.subject, depth: current.depth + 1 })
        }
      }
    }

    const nodeList = [...nodes.values()].sort(
      (a, b) =>
        a.depth - b.depth ||
        visIdRecordKey(a.id).localeCompare(visIdRecordKey(b.id)),
    )
    return {
      graphVersion: this.graphVersion,
      rootPubkey: root,
      ...(this.#graph.nodesIndex.get(root) !== undefined
        ? { rootIndex: this.#graph.nodesIndex.get(root) }
        : {}),
      nodeCount: nodeList.length,
      edgeCount: edges.length,
      truncated,
      nodes: nodeList,
      edges,
    }
  }

  /**
   * One-hop neighborhood via Graph.out / Graph.in (Trust viz expand model).
   * `centerId` is a heap node index (`12`).
   */
  neighborhood(
    centerId: GraphVisId,
    options: {
      direction?: NeighborhoodDirection
      valueFilter?: NeighborhoodValueFilter
      context?: string
      now?: number
      limit?: number
      /** Walk Graph.out for these hex keys as their own from-nodes. */
      outboundPubkeys?: readonly string[]
      /** Kind 32014 overlay context; independent of trust-walk `context`. */
      ratingContext?: string
    } = {},
  ): {
    graphVersion: number
    centerId: GraphVisId
    truncated: boolean
    nodes: GraphViewNode[]
    edges: GraphViewEdge[]
  } {
    const empty = {
      graphVersion: this.graphVersion,
      centerId,
      truncated: false,
      nodes: [] as GraphViewNode[],
      edges: [] as GraphViewEdge[],
    }
    const direction = options.direction ?? 'both'
    const valueFilter = options.valueFilter ?? 'both'
    const now = options.now ?? Math.floor(Date.now() / 1_000)
    const limit = Math.max(1, Math.min(options.limit ?? 200, 500))
    const centerIndex = parseHeapIndexId(centerId)
    if (centerIndex === undefined) return empty
    const centerNode = this.#graph.nodesList[centerIndex]
    if (!centerNode) return empty

    const centerView = viewNodeFromHeap(centerNode, 0)
    const nodes = new Map<GraphVisId, GraphViewNode>([[centerView.id, centerView]])
    const edges: GraphViewEdge[] = []
    const edgeKeys = new Set<GraphVisId>()
    let truncated = false

    const ensureHeapNode = (index: number, depth: number): GraphViewNode | undefined => {
      const node = this.#graph.nodesList[index]
      if (!node) return undefined
      const id = heapIndexId(index)
      const existing = nodes.get(id)
      if (existing) {
        if (depth < existing.depth) existing.depth = depth
        return existing
      }
      const created = viewNodeFromHeap(node, depth)
      nodes.set(id, created)
      return created
    }

    const pushTrustConnection = (
      fromIndex: number,
      toIndex: number,
      edgeIndex: number,
    ): void => {
      const edge = this.#graph.edgesList[edgeIndex]
      if (!edge) return
      if (
        edge.value !== 1 &&
        edge.value !== -1 &&
        edge.value !== 0
      ) {
        return
      }
      if (!valueMatches(edge.value, valueFilter)) return
      const id = heapIndexId(edgeIndex)
      if (edgeKeys.has(id)) return
      if (edges.length >= limit) {
        truncated = true
        return
      }
      if (!ensureHeapNode(fromIndex, fromIndex === centerIndex ? 0 : 1)) return
      if (!ensureHeapNode(toIndex, toIndex === centerIndex ? 0 : 1)) return
      edges.push({
        id,
        from: heapIndexId(fromIndex),
        to: heapIndexId(toIndex),
        value: edge.value,
        context: edge.context,
        eventId: edge.eventId ?? edge.addressableId,
        depth: 1,
      })
      edgeKeys.add(id)
    }

    const wantOut = direction === 'out' || direction === 'both'
    const wantIn = direction === 'in' || direction === 'both'
    const connOpts = {
      context: options.context,
      now,
      includeInactive: false,
    }

    const outboundAuthors = [
      ...new Set(
        [
          centerNode.type === 'p' ? centerNode.id : undefined,
          ...(options.outboundPubkeys ?? []).map((pk) => pk.toLowerCase()),
        ].filter((pk): pk is string => typeof pk === 'string' && pk.length > 0),
      ),
    ]

    if (wantOut) {
      outer: for (const author of outboundAuthors) {
        const fromIndex = this.#graph.nodesIndex.get(author)
        if (fromIndex === undefined) continue
        for (const conn of this.#graph.out(author, connOpts)) {
          const toIndex = this.#graph.nodesIndex.get(conn.subject.toLowerCase())
          const edgeIndex = this.#graph.edgesIndex.get(conn.edge.dTag)
          if (toIndex === undefined || edgeIndex === undefined) continue
          pushTrustConnection(fromIndex, toIndex, edgeIndex)
          if (truncated) break outer
        }
      }
    }

    if (wantIn) {
      for (const conn of this.#graph.in(centerNode.id, connOpts)) {
        const fromIndex = this.#graph.nodesIndex.get(conn.author.toLowerCase())
        const edgeIndex = this.#graph.edgesIndex.get(conn.edge.dTag)
        if (fromIndex === undefined || edgeIndex === undefined) continue
        pushTrustConnection(fromIndex, centerIndex, edgeIndex)
        if (truncated) break
      }
    }

    if (wantIn && centerNode.type !== 'p' && !truncated) {
      const centerSubject: TrustSubject = {
        type: centerNode.type,
        value: centerNode.id,
      }
      const meta = classifyTrustSubject(centerSubject)
      if (meta.kind === 'post') {
        const ratingContext = options.ratingContext ?? ''
        const seenFrom = new Set(
          edges.filter((edge) => edge.to === centerView.id).map((edge) => edge.from),
        )
        for (const claim of this.#claims.values()) {
          if (claim.subject.type !== centerSubject.type) continue
          if (claim.subject.value.toLowerCase() !== centerNode.id) continue
          if (claim.context !== ratingContext) continue
          if (!isRatingClaimActive(claim, now)) continue
          const value = ratingScoreToEdgeValue(claim.score)
          if (!valueMatches(value, valueFilter)) continue
          const fromIndex = this.#graph.nodesIndex.get(claim.author.toLowerCase())
          if (fromIndex === undefined) continue
          const fromId = heapIndexId(fromIndex)
          if (seenFrom.has(fromId)) continue
          if (edges.length >= limit) {
            truncated = true
            break
          }
          if (!ensureHeapNode(fromIndex, 1)) continue
          seenFrom.add(fromId)
          edges.push({
            id: claim.eventId,
            from: fromId,
            to: centerView.id,
            value,
            context: claim.context,
            eventId: claim.eventId,
            depth: 1,
          })
        }
      }
    }

    const nodeList = [...nodes.values()].sort(
      (a, b) =>
        a.depth - b.depth ||
        visIdRecordKey(a.id).localeCompare(visIdRecordKey(b.id)),
    )
    return {
      graphVersion: this.graphVersion,
      centerId: centerView.id,
      truncated,
      nodes: nodeList,
      edges,
    }
  }

  private applyStatement(statement: ReducedTrustStatement): boolean {
    const key = slotAddressableId(statement)
    const current = this.#slots.get(key)
    if (current && statement.derivedFrom && !current.derivedFrom) {
      return false
    }
    if (current && !replaces(statement, current)) {
      return false
    }

    const stored = cloneStatement(statement)
    this.#slots.set(key, stored)
    return this.#graph.applyTrustEvent(statementToTrustEvent(stored))
  }

  private applyClaim(claim: ReducedRatingClaim): boolean {
    if (
      !Number.isFinite(claim.score) ||
      claim.score < 0 ||
      claim.score > 100
    ) {
      return false
    }
    const key = ratingClaimSlotId(claim)
    const current = this.#claims.get(key)
    if (current && !claimReplaces(claim, current)) {
      return false
    }
    this.#claims.set(key, cloneClaim(claim))
    return true
  }
}
