/**
 * Maps IndexResolver Score[] → AttentionX TrustQueryResult.
 */

import { graphSubjectId } from './adapter'
import { WOT_MAX_DEGREE_HARD_CAP } from '../shared/wot-max-degree'
import {
  DEFAULT_RESOLVE_BOUNDS,
  normalizeResolveBounds,
} from './bounds'
import type { Graph } from './trust/Graph'
import type { IResolveStrategy } from './trust/IResolveStrategy'
import type { Score } from './trust/Score'
import {
  resolutionFromCounts,
  type ResolvedStatement,
  type TrustPath,
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
    sourceEventIds: [],
    computedAt: now,
    graphVersion,
    truncated: false,
  }
}

function statementFromEdge(
  graph: Graph,
  edgeIndex: number,
  subject: TrustQuery['subject'],
  requestedContext: string,
  distance: number,
): ResolvedStatement | undefined {
  const edge = graph.edgesList[edgeIndex]
  if (!edge || edge.value === 0) return undefined
  return {
    eventId: edge.eventId,
    author: edge.author,
    subject: { ...subject },
    context: edge.context,
    requestedContext,
    contextMatch:
      edge.context === requestedContext
        ? 'exact'
        : edge.context === ''
          ? 'general'
          : 'parent',
    value: edge.value as 1 | -1,
    createdAt: edge.createdAt,
    ...(edge.activate !== undefined ? { activeFrom: edge.activate } : {}),
    ...(edge.expire !== undefined ? { activeUntil: edge.expire } : {}),
    distance,
  }
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
    format: query.format ?? 'default',
    followTrustThreshold: 1,
    now,
  })

  if (scores.length === 0) {
    return emptyResult(query, graphVersion, now)
  }

  const format = query.format ?? 'default'
  const subjectScore =
    scores.find((s) => s.subject === subjectId) ?? scores[scores.length - 1]!

  const trust = subjectScore.trust
  const distrust = subjectScore.distrust
  const trustValue = subjectScore.trustValue
  const degree = subjectScore.degree
  const connected = subjectScore.connected || subjectScore.count > 0

  const statements: ResolvedStatement[] = []
  const sourceEventIds: string[] = []
  const paths: TrustPath[] = []

  if (subjectScore.edges) {
    for (const edgeIndex of subjectScore.edges) {
      const resolved = statementFromEdge(
        graph,
        edgeIndex,
        query.subject,
        context,
        Math.max(0, degree - 1),
      )
      if (!resolved) continue
      statements.push(resolved)
      sourceEventIds.push(resolved.eventId)
    }
  }

  let direct: ResolvedStatement | undefined
  if (degree === 1) {
    const found = statements.find((s) => s.author.toLowerCase() === root)
    if (found) {
      direct = { ...found, distance: 0 }
    }
  }

  if (format === 'path') {
    if (statements.length > 0) {
      for (const st of statements) {
        const pathAuthors = [root]
        if (st.author.toLowerCase() !== root) {
          pathAuthors.push(st.author.toLowerCase())
        }
        paths.push({
          authors: pathAuthors,
          subject: { ...query.subject },
          sourceEventIds: [st.eventId],
        })
      }
    } else {
      buildPathsFromScores(scores, graph, root, query, paths)
    }
  }

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
    paths,
    sourceEventIds: [...new Set(sourceEventIds)].sort(),
    computedAt: now,
    graphVersion,
    truncated: false,
  }
}

function buildPathsFromScores(
  scores: Score[],
  graph: Graph,
  root: string,
  query: TrustQuery,
  paths: TrustPath[],
): void {
  const authors: string[] = [root]
  const pathEventIds: string[] = []
  for (const score of scores) {
    if (score.subjectIndex === undefined) continue
    const node = graph.nodesList[score.subjectIndex]
    if (node?.type === 'p' && node.id !== root && !authors.includes(node.id)) {
      authors.push(node.id)
    }
    if (score.edges) {
      for (const ei of score.edges) {
        const edge = graph.edgesList[ei]
        if (edge?.eventId) pathEventIds.push(edge.eventId)
      }
    }
  }
  if (authors.length > 1 || pathEventIds.length > 0) {
    paths.push({
      authors,
      subject: { ...query.subject },
      sourceEventIds: [...new Set(pathEventIds)],
    })
  }
}
