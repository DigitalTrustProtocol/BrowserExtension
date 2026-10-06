/**
 * Maps IndexResolver Score[] → Attention TrustQueryResult.
 */

import { graphSubjectId } from './adapter'
import { IDENTITY_TRUST_CONTEXT } from '../shared/trust-context'
import { WOT_MAX_DEGREE_HARD_CAP } from '../shared/wot-max-degree'
import { trustScoreResolution } from '../shared/trust-score'
import {
  clampFollowTrustRed,
  clampFollowTrustThreshold,
} from '../shared/wot-follow-trust-threshold'
import { cloneLabelHints, TRUST_STATEMENT_KIND } from '../lib/nostr/kind-32009'
import { trustEdgeValue } from './trust/Edge'
import {
  DEFAULT_RESOLVE_BOUNDS,
  normalizeResolveBounds,
} from './bounds'
import { EMPTY_PATH_VIEW, scoresToPathView } from './path-view'
import { trustScoreCounts } from './score-read'
import type { Graph } from './trust/Graph'
import type {
  IResolveStrategy,
  IResolveStrategyOptions,
} from './trust/IResolveStrategy'
import { TrustScore, type Score } from './trust/Score'
import type {
  ResolvedStatement,
  TrustQuery,
  TrustQueryFormat,
  TrustQueryResult,
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
  followTrustThreshold: number,
  followTrustRed: number,
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
    followTrustThreshold,
    followTrustRed,
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

interface PreparedTrustQuery {
  query: TrustQuery
  context: string
  now: number
  maxDepth: number
  root: string
  subjectId: string
  format: TrustQueryFormat
  followTrustThreshold: number
  followTrustRed: number
}

function prepareTrustQuery(
  query: TrustQuery,
  nowFallback: number,
): PreparedTrustQuery {
  const now = query.now ?? nowFallback
  if (!Number.isFinite(now)) {
    throw new RangeError('now must be finite')
  }
  const bounds = normalizeResolveBounds({
    ...DEFAULT_RESOLVE_BOUNDS,
    ...query.bounds,
  })
  const followTrustThreshold = clampFollowTrustThreshold(
    query.followTrustThreshold,
  )
  return {
    query,
    context: query.context ?? '',
    now,
    maxDepth: Math.min(bounds.maxDepth, WOT_MAX_DEGREE_HARD_CAP),
    root: query.rootPubkey.toLowerCase(),
    subjectId: graphSubjectId(query.subject),
    format: query.format ?? 'default',
    followTrustThreshold,
    followTrustRed: clampFollowTrustRed(
      query.followTrustRed,
      followTrustThreshold,
    ),
  }
}

function trustWalkKey(prepared: PreparedTrustQuery): string {
  return [
    prepared.root,
    prepared.context,
    prepared.maxDepth,
    prepared.followTrustThreshold,
    prepared.now,
  ].join('|')
}

function trustResolveOptions(
  graph: Graph,
  prepared: PreparedTrustQuery,
  format: 'path' | 'statements',
): IResolveStrategyOptions {
  return {
    graph,
    trustContext: IDENTITY_TRUST_CONTEXT,
    scoreContext: prepared.context,
    maxDepth: prepared.maxDepth,
    format,
    followTrustThreshold: prepared.followTrustThreshold,
    now: prepared.now,
    kind: TRUST_STATEMENT_KIND as 32009,
  }
}

function trustResultFromScores(
  graph: Graph,
  prepared: PreparedTrustQuery,
  scores: readonly Score[],
  graphVersion: number,
): TrustQueryResult {
  if (scores.length === 0) {
    return emptyResult(
      prepared.query,
      graphVersion,
      prepared.now,
      prepared.followTrustThreshold,
      prepared.followTrustRed,
    )
  }

  const subjectScore =
    scores.find(
      (score) =>
        score instanceof TrustScore && score.subject === prepared.subjectId,
    ) ??
    scores.find((score) => score instanceof TrustScore) ??
    scores[0]!

  const { trust, distrust, trustValue, neutral } = trustScoreCounts(subjectScore)
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
        prepared.query.subject,
        prepared.context,
        prepared.root,
        degree,
      )
      if (!resolved) continue
      statements.push(resolved)
      sourceEventIds.push(resolved.eventId)
    }
  }

  const own = statements.find(
    (statement) => statement.author.toLowerCase() === prepared.root,
  )
  const band = {
    red: prepared.followTrustRed,
    green: prepared.followTrustThreshold,
  }

  return {
    subject: { ...prepared.query.subject },
    context: prepared.context,
    resolution: trustScoreResolution(trust, distrust, connected, band),
    trust,
    distrust,
    ...(neutral > 0 ? { neutral } : {}),
    trustValue,
    degree,
    connected,
    ...(own !== undefined ? { direct: { ...own, distance: 0 } } : {}),
    statements,
    paths: [],
    pathView:
      prepared.format === 'path'
        ? scoresToPathView(graph, scores)
        : EMPTY_PATH_VIEW,
    sourceEventIds: [...new Set(sourceEventIds)].sort(),
    computedAt: prepared.now,
    graphVersion,
    truncated: false,
    followTrustThreshold: prepared.followTrustThreshold,
    followTrustRed: prepared.followTrustRed,
  }
}

function resolveOneTrustQuery(
  graph: Graph,
  resolver: IResolveStrategy,
  prepared: PreparedTrustQuery,
  graphVersion: number,
): TrustQueryResult {
  const scores = resolver.resolve(
    prepared.root,
    prepared.subjectId,
    trustResolveOptions(
      graph,
      prepared,
      prepared.format === 'path' ? 'path' : 'statements',
    ),
  )
  return trustResultFromScores(graph, prepared, scores, graphVersion)
}

/**
 * resolveMulti omits unknown subjects. Return one slot per requested id, or
 * undefined when the score list cannot be lined up with that order.
 */
export function alignSubjectScores(
  subjectIds: readonly string[],
  scores: readonly Score[],
): Array<Score | undefined> | undefined {
  const aligned: Array<Score | undefined> = []
  let cursor = 0
  for (const subjectId of subjectIds) {
    const score = scores[cursor]
    if (score?.subject === subjectId) {
      aligned.push(score)
      cursor += 1
    } else {
      aligned.push(undefined)
    }
  }
  return cursor === scores.length ? aligned : undefined
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
  return resolveOneTrustQuery(
    graph,
    resolver,
    prepareTrustQuery(query, Math.floor(Date.now() / 1_000)),
    graphVersion,
  )
}

/**
 * One shared walk for subjects that use the same root, depth, threshold, and
 * time. Path stays on resolve — resolveMulti does not build a path.
 */
export function executeTrustQueryBatch(
  graph: Graph,
  resolver: IResolveStrategy,
  queries: readonly TrustQuery[],
  graphVersion: number,
): TrustQueryResult[] {
  if (queries.length === 0) return []
  const nowFallback = Math.floor(Date.now() / 1_000)
  const prepared = queries.map((query) => prepareTrustQuery(query, nowFallback))
  const results = new Array<TrustQueryResult>(queries.length)
  const groups = new Map<string, number[]>()

  for (let index = 0; index < prepared.length; index++) {
    const item = prepared[index]!
    if (item.format === 'path') {
      results[index] = resolveOneTrustQuery(graph, resolver, item, graphVersion)
      continue
    }
    const key = trustWalkKey(item)
    const group = groups.get(key)
    if (group) group.push(index)
    else groups.set(key, [index])
  }

  for (const indexes of groups.values()) {
    if (indexes.length < 2) {
      const index = indexes[0]!
      results[index] = resolveOneTrustQuery(
        graph,
        resolver,
        prepared[index]!,
        graphVersion,
      )
      continue
    }
    const first = prepared[indexes[0]!]!
    const subjectIds = indexes.map((index) => prepared[index]!.subjectId)
    const scores = resolver.resolveMulti(
      first.root,
      subjectIds,
      trustResolveOptions(graph, first, 'statements'),
    )
    const aligned = alignSubjectScores(subjectIds, scores)
    if (!aligned) {
      for (const index of indexes) {
        results[index] = resolveOneTrustQuery(
          graph,
          resolver,
          prepared[index]!,
          graphVersion,
        )
      }
      continue
    }
    for (let slot = 0; slot < indexes.length; slot++) {
      const index = indexes[slot]!
      const score = aligned[slot]
      results[index] = trustResultFromScores(
        graph,
        prepared[index]!,
        score ? [score] : [],
        graphVersion,
      )
    }
  }

  return results
}
