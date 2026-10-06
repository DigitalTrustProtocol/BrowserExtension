/**
 * Artifact ratings (kind 32014): map IndexResolver RatingScore onto
 * Attention DTOs. Never a traversal edge.
 */

import { graphSubjectId, heapIndexId, ratingScoreToEdgeValue } from '../adapter'
import { alignSubjectScores } from '../query'
import { normalizeResolveBounds } from '../bounds'
import { cloneLabelHints } from '../../lib/nostr/kind-32009'
import { RATING_STATEMENT_KIND } from '../../lib/nostr/kind-32014'
import { eventRecordSubject } from '../../lib/nostr/nip32009'
import {
  EMPTY_PATH_VIEW,
  scoresToPathView,
  viewNodeFromHeap,
} from '../path-view'
import type { Graph } from '../trust/Graph'
import type {
  IResolveStrategy,
  IResolveStrategyOptions,
} from '../trust/IResolveStrategy'
import { RatingScore, type Score } from '../trust/Score'
import type {
  GraphPathView,
  GraphPathViewEdge,
  GraphVisId,
  RatingClaimEvidence,
  RatingQuery,
  RatingQueryResult,
  ResolveBounds,
  TrustQueryFormat,
} from '../types'
import { IDENTITY_TRUST_CONTEXT } from '../../shared/trust-context'
import { WOT_MAX_DEGREE_HARD_CAP } from '../../shared/wot-max-degree'
import {
  clampFollowTrustRed,
  clampFollowTrustThreshold,
} from '../../shared/wot-follow-trust-threshold'
import { averageRatingScore } from '../../shared/rating-score'

function emptyRatingResult(
  query: RatingQuery,
  context: string,
  now: number,
  graphVersion: number,
  followTrustThreshold: number,
  followTrustRed: number,
): RatingQueryResult {
  return {
    subject: { ...query.subject },
    context,
    claims: [],
    averageScore: null,
    claimCount: 0,
    degree: 0,
    sourceEventIds: [],
    paths: [],
    pathView: EMPTY_PATH_VIEW,
    ratingEdges: [],
    computedAt: now,
    graphVersion,
    followTrustThreshold,
    followTrustRed,
  }
}

function claimFromEdge(
  graph: Graph,
  edgeIndex: number,
  distance: number,
): RatingClaimEvidence | undefined {
  const edge = graph.edgesList[edgeIndex]
  if (!edge || edge.nValue === undefined) return undefined
  const subject = eventRecordSubject(edge)
  if (!subject) return undefined
  const labels = edge.labels ?? []
  const labelHints = cloneLabelHints(edge.labelHints)
  return {
    eventId: edge.id,
    author: edge.pubkey.toLowerCase(),
    subject: { ...subject },
    context: edge.c_tag ?? '',
    score: edge.nValue,
    labels: [...labels],
    ...(labelHints !== undefined ? { labelHints } : {}),
    content: edge.content,
    createdAt: edge.created_at,
    ...(edge.activate !== undefined ? { activeFrom: edge.activate } : {}),
    ...(edge.expire !== undefined ? { activeUntil: edge.expire } : {}),
    distance,
  }
}

interface PreparedRatingQuery {
  query: RatingQuery
  context: string
  now: number
  maxDepth: number
  root: string
  subjectId: string
  format: TrustQueryFormat
  labels: string[]
  followTrustThreshold: number
  followTrustRed: number
}

function prepareRatingQuery(
  query: RatingQuery,
  defaultBounds: Readonly<ResolveBounds>,
  nowFallback: number,
): PreparedRatingQuery {
  const bounds = normalizeResolveBounds({
    ...defaultBounds,
    ...query.bounds,
  })
  const followTrustThreshold = clampFollowTrustThreshold(
    query.followTrustThreshold,
  )
  return {
    query,
    context: query.context ?? '',
    now: query.now ?? nowFallback,
    maxDepth: Math.min(bounds.maxDepth, WOT_MAX_DEGREE_HARD_CAP),
    root: query.rootPubkey.toLowerCase(),
    subjectId: graphSubjectId(query.subject),
    format: query.format ?? 'default',
    labels: query.labels?.filter((label) => label.length > 0) ?? [],
    followTrustThreshold,
    followTrustRed: clampFollowTrustRed(
      query.followTrustRed,
      followTrustThreshold,
    ),
  }
}

function ratingWalkKey(prepared: PreparedRatingQuery): string {
  return [prepared.root, prepared.context, prepared.maxDepth, prepared.now].join('|')
}

function ratingResolveOptions(
  graph: Graph,
  prepared: PreparedRatingQuery,
  format: 'path' | 'statements',
): IResolveStrategyOptions {
  return {
    graph,
    trustContext: IDENTITY_TRUST_CONTEXT,
    scoreContext: prepared.context,
    maxDepth: prepared.maxDepth,
    format,
    followTrustThreshold: 1,
    now: prepared.now,
    kind: RATING_STATEMENT_KIND as 32014,
  }
}

function ratingResultFromScores(
  graph: Graph,
  prepared: PreparedRatingQuery,
  scores: readonly Score[],
  graphVersion: number,
): RatingQueryResult {
  const subjectScore =
    scores.find(
      (score) =>
        score instanceof RatingScore && score.subject === prepared.subjectId,
    ) ?? scores.find((score) => score instanceof RatingScore)

  if (
    !subjectScore ||
    !(subjectScore instanceof RatingScore) ||
    !subjectScore.connected ||
    !subjectScore.edges ||
    subjectScore.edges.length === 0
  ) {
    return emptyRatingResult(
      prepared.query,
      prepared.context,
      prepared.now,
      graphVersion,
      prepared.followTrustThreshold,
      prepared.followTrustRed,
    )
  }

  const distance = Math.max(0, subjectScore.degree - 1)
  const evidence: RatingClaimEvidence[] = []
  for (const edgeIndex of subjectScore.edges) {
    const claim = claimFromEdge(graph, edgeIndex, distance)
    if (!claim) continue
    if (
      prepared.labels.length > 0 &&
      !prepared.labels.some((label) => claim.labels.includes(label))
    ) {
      continue
    }
    evidence.push(claim)
  }
  if (evidence.length === 0) {
    return emptyRatingResult(
      prepared.query,
      prepared.context,
      prepared.now,
      graphVersion,
      prepared.followTrustThreshold,
      prepared.followTrustRed,
    )
  }
  evidence.sort(
    (left, right) =>
      left.distance - right.distance ||
      right.createdAt - left.createdAt ||
      left.eventId.localeCompare(right.eventId),
  )

  const averageScore = averageRatingScore(evidence.map((claim) => claim.score))
  const own = evidence.find((claim) => claim.author === prepared.root)
  const degree = subjectScore.degree

  let pathView: GraphPathView = EMPTY_PATH_VIEW
  const ratingEdges: GraphPathViewEdge[] = []
  if (prepared.format === 'path' && evidence.length > 0) {
    pathView = scoresToPathView(graph, scores)
    const postIndex = graph.nodesIndex.get(prepared.subjectId)
    const postNode =
      postIndex !== undefined ? graph.nodesList[postIndex] : undefined
    if (postNode && postIndex !== undefined) {
      pathView = {
        nodes: [
          ...pathView.nodes,
          ...(!pathView.nodes.some(
            (node) => node.id === heapIndexId(postIndex),
          )
            ? [viewNodeFromHeap(postNode, degree)]
            : []),
        ],
        edges: pathView.edges,
      }
      const seenFrom = new Set<GraphVisId>()
      for (const claim of evidence) {
        const issuerIndex = graph.nodesIndex.get(claim.author)
        if (issuerIndex === undefined) continue
        const from = heapIndexId(issuerIndex)
        if (seenFrom.has(from)) continue
        seenFrom.add(from)
        ratingEdges.push({
          id: claim.eventId,
          from,
          to: heapIndexId(postIndex),
          value: ratingScoreToEdgeValue(claim.score),
          context: claim.context,
          eventId: claim.eventId,
          depth: degree,
        })
      }
    }
  }

  return {
    subject: { ...prepared.query.subject },
    context: prepared.context,
    claims: evidence,
    averageScore,
    claimCount: evidence.length,
    degree,
    ...(own !== undefined ? { own } : {}),
    sourceEventIds: evidence.map((claim) => claim.eventId).sort(),
    paths: [],
    pathView,
    ratingEdges,
    computedAt: prepared.now,
    graphVersion,
    followTrustThreshold: prepared.followTrustThreshold,
    followTrustRed: prepared.followTrustRed,
  }
}

function resolveOneRatingQuery(
  graph: Graph,
  resolver: IResolveStrategy,
  prepared: PreparedRatingQuery,
  graphVersion: number,
): RatingQueryResult {
  const scores = resolver.resolve(
    prepared.root,
    prepared.subjectId,
    ratingResolveOptions(
      graph,
      prepared,
      prepared.format === 'path' ? 'path' : 'statements',
    ),
  )
  return ratingResultFromScores(graph, prepared, scores, graphVersion)
}

export function executeRatingQuery(
  graph: Graph,
  resolver: IResolveStrategy,
  query: RatingQuery,
  graphVersion: number,
  defaultBounds: Readonly<ResolveBounds>,
): RatingQueryResult {
  return resolveOneRatingQuery(
    graph,
    resolver,
    prepareRatingQuery(query, defaultBounds, Math.floor(Date.now() / 1_000)),
    graphVersion,
  )
}

/**
 * One shared walk for ratings that use the same root, depth, and time.
 * Labels are applied after the walk. Path stays on resolve.
 */
export function executeRatingQueryBatch(
  graph: Graph,
  resolver: IResolveStrategy,
  queries: readonly RatingQuery[],
  graphVersion: number,
  defaultBounds: Readonly<ResolveBounds>,
): RatingQueryResult[] {
  if (queries.length === 0) return []
  const nowFallback = Math.floor(Date.now() / 1_000)
  const prepared = queries.map((query) =>
    prepareRatingQuery(query, defaultBounds, nowFallback),
  )
  const results = new Array<RatingQueryResult>(queries.length)
  const groups = new Map<string, number[]>()

  for (let index = 0; index < prepared.length; index++) {
    const item = prepared[index]!
    if (item.format === 'path') {
      results[index] = resolveOneRatingQuery(graph, resolver, item, graphVersion)
      continue
    }
    const key = ratingWalkKey(item)
    const group = groups.get(key)
    if (group) group.push(index)
    else groups.set(key, [index])
  }

  for (const indexes of groups.values()) {
    if (indexes.length < 2) {
      const index = indexes[0]!
      results[index] = resolveOneRatingQuery(
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
      ratingResolveOptions(graph, first, 'statements'),
    )
    const aligned = alignSubjectScores(subjectIds, scores)
    if (!aligned) {
      for (const index of indexes) {
        results[index] = resolveOneRatingQuery(
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
      results[index] = ratingResultFromScores(
        graph,
        prepared[index]!,
        score ? [score] : [],
        graphVersion,
      )
    }
  }

  return results
}

export class ArtifactRatingResolver {
  readonly name = 'artifact-rating'

  resolve(
    graph: Graph,
    resolver: IResolveStrategy,
    query: RatingQuery,
    graphVersion: number,
    defaultBounds: Readonly<ResolveBounds>,
  ): RatingQueryResult {
    return executeRatingQuery(
      graph,
      resolver,
      query,
      graphVersion,
      defaultBounds,
    )
  }

  resolveMany(
    graph: Graph,
    resolver: IResolveStrategy,
    queries: readonly RatingQuery[],
    graphVersion: number,
    defaultBounds: Readonly<ResolveBounds>,
  ): RatingQueryResult[] {
    return executeRatingQueryBatch(
      graph,
      resolver,
      queries,
      graphVersion,
      defaultBounds,
    )
  }
}

export const artifactRatingResolver = new ArtifactRatingResolver()
