/**
 * LocalTrustGraph facade over vendored Trust heap Graph + IResolveStrategy.
 */

import {
  classifyTrustSubject,
  parseWireCenterId,
  ratingClaimSlotId,
  ratingScoreToEdgeValue,
  slotAddressableId,
  statementToTrustEvent,
} from './adapter'
import { normalizeResolveBounds } from './bounds'
import { executeTrustQuery } from './query'
import {
  artifactRatingResolver,
  isRatingClaimActive,
} from './ratings/ArtifactRatingResolver'
import { Graph } from './trust/Graph'
import indexResolver from './trust/IndexResolver'
import type { IResolveStrategy } from './trust/IResolveStrategy'
import type {
  GraphUpdateResult,
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

export type GraphNodeKind = 'pubkey' | 'twitter_id' | 'post' | 'other'

export interface GraphViewNode {
  id: string
  kind: GraphNodeKind
  depth: number
  label: string
}

export interface GraphViewEdge {
  from: string
  to: string
  value: 1 | -1
  context: string
  eventId: string
  depth: number
}

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
  value: 1 | -1,
  filter: NeighborhoodValueFilter,
): boolean {
  if (filter === 'both') return true
  if (filter === 'trust') return value === 1
  return value === -1
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
    const nodes = new Map<string, GraphViewNode>()
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
        if (conn.edge.value !== 1 && conn.edge.value !== -1) continue
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
          from: `p:${current.pubkey}`,
          to: target.id,
          value: conn.edge.value === -1 ? -1 : 1,
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
      (a, b) => a.depth - b.depth || a.id.localeCompare(b.id),
    )
    return {
      graphVersion: this.graphVersion,
      rootPubkey: root,
      nodeCount: nodeList.length,
      edgeCount: edges.length,
      truncated,
      nodes: nodeList,
      edges,
    }
  }

  /**
   * One-hop neighborhood via Graph.out / Graph.in (Trust viz expand model).
   */
  neighborhood(
    centerId: string,
    options: {
      direction?: NeighborhoodDirection
      valueFilter?: NeighborhoodValueFilter
      context?: string
      now?: number
      limit?: number
      /** Walk Graph.out for these hex keys while keeping `centerId` as the from-id. */
      outboundPubkeys?: readonly string[]
    } = {},
  ): {
    graphVersion: number
    centerId: string
    truncated: boolean
    nodes: GraphViewNode[]
    edges: GraphViewEdge[]
  } {
    const direction = options.direction ?? 'both'
    const valueFilter = options.valueFilter ?? 'both'
    const now = options.now ?? Math.floor(Date.now() / 1_000)
    const limit = Math.max(1, Math.min(options.limit ?? 200, 500))
    const parsed = parseWireCenterId(centerId)
    if (!parsed) {
      return {
        graphVersion: this.graphVersion,
        centerId,
        truncated: false,
        nodes: [],
        edges: [],
      }
    }

    const nodes = new Map<string, GraphViewNode>()
    const edges: GraphViewEdge[] = []
    const edgeKeys = new Set<string>()
    let truncated = false

    nodes.set(parsed.wireId, {
      id: parsed.wireId,
      kind: parsed.kind,
      depth: 0,
      label: parsed.label,
    })

    const pushEdge = (
      fromWire: string,
      fromMeta: { id: string; kind: GraphNodeKind; label: string },
      toMeta: { id: string; kind: GraphNodeKind; label: string },
      value: 1 | -1,
      context: string,
      eventId: string,
    ): void => {
      const edgeKey = `${eventId}:${fromWire}:${toMeta.id}`
      if (edgeKeys.has(edgeKey)) return
      if (edges.length >= limit) {
        truncated = true
        return
      }
      if (!nodes.has(fromWire)) {
        nodes.set(fromWire, {
          id: fromMeta.id,
          kind: fromMeta.kind,
          depth: fromWire === parsed.wireId ? 0 : 1,
          label: fromMeta.label,
        })
      }
      if (!nodes.has(toMeta.id)) {
        nodes.set(toMeta.id, {
          id: toMeta.id,
          kind: toMeta.kind,
          depth: toMeta.id === parsed.wireId ? 0 : 1,
          label: toMeta.label,
        })
      }
      edges.push({
        from: fromWire,
        to: toMeta.id,
        value,
        context,
        eventId,
        depth: 1,
      })
      edgeKeys.add(edgeKey)
    }

    const wantOut = direction === 'out' || direction === 'both'
    const wantIn = direction === 'in' || direction === 'both'
    const connOpts = {
      context: options.context,
      now,
      includeInactive: false,
    }

    const outbound = [
      ...new Set(
        [
          ...(options.outboundPubkeys ?? []).map((pk) => pk.toLowerCase()),
          ...(parsed.authorPubkey ? [parsed.authorPubkey] : []),
        ].filter((pk) => pk.length > 0),
      ),
    ]
    if (wantOut) {
      outer: for (const pubkey of outbound) {
        for (const conn of this.#graph.out(pubkey, connOpts)) {
          if (conn.edge.value !== 1 && conn.edge.value !== -1) continue
          if (!valueMatches(conn.edge.value, valueFilter)) continue
          const toMeta = classifyTrustSubject({
            type: conn.subjectType,
            value: conn.subject,
          })
          pushEdge(
            parsed.wireId,
            { id: parsed.wireId, kind: parsed.kind, label: parsed.label },
            toMeta,
            conn.edge.value,
            conn.edge.context,
            conn.edge.eventId ?? conn.edge.dTag,
          )
          if (truncated) break outer
        }
      }
    }

    if (wantIn && parsed.subject) {
      for (const conn of this.#graph.in(parsed.graphId, connOpts)) {
        if (conn.edge.value !== 1 && conn.edge.value !== -1) continue
        if (!valueMatches(conn.edge.value, valueFilter)) continue
        const fromMeta = classifyTrustSubject({
          type: 'p',
          value: conn.author,
        })
        pushEdge(
          fromMeta.id,
          fromMeta,
          { id: parsed.wireId, kind: parsed.kind, label: parsed.label },
          conn.edge.value,
          conn.edge.context,
          conn.edge.eventId ?? conn.edge.dTag,
        )
        if (truncated) break
      }
    }

    // Kind 32014 is never a hop, but a post center still shows incoming
    // rating arrows from users who have rated it.
    if (
      wantIn &&
      parsed.subject &&
      parsed.kind === 'post' &&
      !truncated
    ) {
      const context = options.context ?? ''
      const seenAuthors = new Set(
        edges.filter((edge) => edge.to === parsed.wireId).map((edge) => edge.from),
      )
      for (const claim of this.#claims.values()) {
        if (claim.subject.type !== parsed.subject.type) continue
        if (claim.subject.value.toLowerCase() !== parsed.graphId) continue
        if (claim.context !== context) continue
        if (!isRatingClaimActive(claim, now)) continue
        const value = ratingScoreToEdgeValue(claim.score)
        if (!valueMatches(value, valueFilter)) continue
        const fromMeta = classifyTrustSubject({
          type: 'p',
          value: claim.author,
        })
        if (seenAuthors.has(fromMeta.id)) continue
        seenAuthors.add(fromMeta.id)
        pushEdge(
          fromMeta.id,
          fromMeta,
          { id: parsed.wireId, kind: parsed.kind, label: parsed.label },
          value,
          claim.context,
          claim.eventId,
        )
        if (truncated) break
      }
    }

    const nodeList = [...nodes.values()].sort(
      (a, b) => a.depth - b.depth || a.id.localeCompare(b.id),
    )
    return {
      graphVersion: this.graphVersion,
      centerId: parsed.wireId,
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
