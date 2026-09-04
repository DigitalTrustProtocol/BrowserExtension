/**
 * Maps IndexResolver Score[] → AttentionX TrustQueryResult.
 */

import { graphSubjectId } from './adapter'
import { WOT_MAX_DEGREE_HARD_CAP } from '../shared/wot-max-degree'
import { cloneLabelHints } from '../lib/nostr/kind-32009'
import { trustEdgeValue } from './trust/Edge'
import {
  DEFAULT_RESOLVE_BOUNDS,
  normalizeResolveBounds,
} from './bounds'
import { EMPTY_PATH_VIEW, scoresToPathView, viewNodeFromHeap } from './path-view'
import { trustScoreCounts } from './score-read'
import type { Graph } from './trust/Graph'
import type { IResolveStrategy } from './trust/IResolveStrategy'
import type { Score } from './trust/Score'
import {
  resolutionFromCounts,
  type GraphPathView,
  type ResolvedStatement,
  type TrustQuery,
  type TrustQueryResult,
} from './types'

export {
  DEFAULT_GRAPH_BOUNDS,
  DEFAULT_RESOLVE_BOUNDS,
  normalizeBounds,
  normalizeResolveBounds,
} from './bounds'

function emptyResult(
  query: TrustQuery,
  graphVersion: number,
  now: number,
): TrustQueryResult {
  return {
    subject: { ...query.subject },
    context: query.context ?? '',
    resolution: 'none',
    trust: 0,
    distrust: 0,
    trustValue: 0,
    degree: 0,
    connected: false,
    statements: [],
    paths: [],
    pathView: EMPTY_PATH_VIEW,
    sourceEventIds: [],
    computedAt: now,
    graphVersion,
    truncated: false,
  }
}

function statementDistance(
  graph: Graph,
  scores: readonly Score[],
  author: string,
  root: string,
  subjectDegree: number,
): number {
  if (author.toLowerCase() === root) return 0
  const authorIndex = graph.nodesIndex.get(author.toLowerCase())
  if (authorIndex !== undefined) {
    const hop = scores.find((score) => score.subjectIndex === authorIndex)
    if (hop) return hop.degree
  }
  return Math.max(0, subjectDegree - 1)
}

function statementFromEdge(
  graph: Graph,
  scores: readonly Score[],
  edgeIndex: number,
  subject: TrustQuery['subject'],
  requestedContext: string,
  root: string,
  subjectDegree: number,
): ResolvedStatement | undefined {
  const edge = graph.edgesList[edgeIndex]
  if (!edge) return undefined
  const value = trustEdgeValue(edge)
  if (value === undefined) return undefined
  const labelHints = cloneLabelHints(edge.labelHints)
  const distance = statementDistance(
    graph,
    scores,
    edge.pubkey,
    root,
    subjectDegree,
  )
  return {
    eventId: edge.id,
    connectionKey: edge.addressKey,
    author: edge.pubkey,
    subject: { ...subject },
    context: edge.c_tag ?? '',
    requestedContext,
    contextMatch:
      (edge.c_tag ?? '') === requestedContext
        ? 'exact'
        : (edge.c_tag ?? '') === ''
          ? 'general'
          : 'parent',
    value,
    createdAt: edge.created_at,
    ...(edge.activate !== undefined ? { activeFrom: edge.activate } : {}),
    ...(edge.expire !== undefined ? { activeUntil: edge.expire } : {}),
    ...(edge.content !== undefined && edge.content !== ''
      ? { content: edge.content }
      : {}),
    ...(edge.labels !== undefined && edge.labels.length > 0
      ? { labels: [...edge.labels] }
      : {}),
    ...(labelHints !== undefined ? { labelHints } : {}),
    distance,
  }
}

function selfPathView(graph: Graph, root: string): GraphPathView {
  const node = graph.getNode(root)
  if (!node) return EMPTY_PATH_VIEW
  return { nodes: [viewNodeFromHeap(node, 0)], edges: [] }
}

/**
 * Runs the injected IResolveStrategy (default IndexResolver) and maps to TrustQueryResult.
 */
export function executeTrustQuery(
  graph: Graph,
  resolver: IResolveStrategy,
  query: TrustQuery,
  graphVersion: number,
): TrustQueryResult {
  const context = query.context ?? ''
  const now = query.now ?? Math.floor(Date.now() / 1_000)
  if (!Number.isFinite(now)) {
    throw new RangeError('now must be finite')
  }

  const bounds = normalizeResolveBounds({
    ...DEFAULT_RESOLVE_BOUNDS,
    ...query.bounds,
  })

  const subjectId = graphSubjectId(query.subject)
  const root = query.rootPubkey.toLowerCase()
  const format = query.format ?? 'default'

  if (root === subjectId && query.subject.type === 'p') {
    return {
      subject: { ...query.subject },
      context,
      resolution: 'trusted',
      trust: 1,
      distrust: 0,
      trustValue: 1,
      degree: 0,
      connected: true,
      statements: [],
      paths: [],
      pathView: format === 'path' ? selfPathView(graph, root) : EMPTY_PATH_VIEW,
      sourceEventIds: [],
      computedAt: now,
      graphVersion,
      truncated: false,
    }
  }

  const scores = resolver.resolve(root, subjectId, {
    graph,
    context,
    maxDepth: Math.min(bounds.maxDepth, WOT_MAX_DEGREE_HARD_CAP),
    format,
    followTrustThreshold: 1,
    now,
    // IndexResolver maps subjectType === 'p' to kind 32009. QUERY_TRUST is
    // always 32009; evidence still unions p/i buckets from that choice.
    subjectType: 'p',
  })

  if (scores.length === 0) {
    return emptyResult(query, graphVersion, now)
  }

  const subjectScore =
    scores.find((s) => s.subject === subjectId) ?? scores[0]!

  const { trust, distrust, trustValue } = trustScoreCounts(subjectScore)
  const degree = subjectScore.degree
  const connected = subjectScore.connected || subjectScore.count > 0

  const statements: ResolvedStatement[] = []
  const sourceEventIds: string[] = []

  if (subjectScore.edges) {
    for (const edgeIndex of subjectScore.edges) {
      const resolved = statementFromEdge(
        graph,
        scores,
        edgeIndex,
        query.subject,
        context,
        root,
        degree,
      )
      if (!resolved) continue
      statements.push(resolved)
      sourceEventIds.push(resolved.eventId)
    }
  }

  let direct: ResolvedStatement | undefined
  const own = statements.find((s) => s.author.toLowerCase() === root)
  if (own) {
    direct = { ...own, distance: 0 }
  }

  const pathView =
    format === 'path' ? scoresToPathView(graph, scores) : EMPTY_PATH_VIEW

  return {
    subject: { ...query.subject },
    context,
    resolution: resolutionFromCounts(trust, distrust, connected),
    trust,
    distrust,
    trustValue,
    degree,
    connected,
    ...(direct !== undefined ? { direct } : {}),
    statements,
    paths: [],
    pathView,
    sourceEventIds: [...new Set(sourceEventIds)].sort(),
    computedAt: now,
    graphVersion,
    truncated: false,
  }
}
