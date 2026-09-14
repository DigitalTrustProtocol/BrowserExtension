/**
 * Artifact ratings (kind 32014): map IndexResolver RatingScore onto
 * AttentionX DTOs. Never a traversal edge.
 */

import { graphSubjectId, heapIndexId, ratingScoreToEdgeValue } from '../adapter'
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
import type { IResolveStrategy } from '../trust/IResolveStrategy'
import { RatingScore } from '../trust/Score'
import type {
  GraphPathView,
  GraphPathViewEdge,
  GraphVisId,
  RatingClaimEvidence,
  RatingQuery,
  RatingQueryResult,
  ResolveBounds,
} from '../types'
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

export function executeRatingQuery(
  graph: Graph,
  resolver: IResolveStrategy,
  query: RatingQuery,
  graphVersion: number,
  defaultBounds: Readonly<ResolveBounds>,
): RatingQueryResult {
  const context = query.context ?? ''
  const now = query.now ?? Math.floor(Date.now() / 1_000)
  const bounds = normalizeResolveBounds({
    ...defaultBounds,
    ...query.bounds,
  })
  const maxDepth = Math.min(bounds.maxDepth, WOT_MAX_DEGREE_HARD_CAP)
  const root = query.rootPubkey.toLowerCase()
  const subjectId = graphSubjectId(query.subject)
  const format = query.format ?? 'default'
  const labels = query.labels?.filter((label) => label.length > 0) ?? []
  const followTrustThreshold = clampFollowTrustThreshold(
    query.followTrustThreshold,
  )
  const followTrustRed = clampFollowTrustRed(
    query.followTrustRed,
    followTrustThreshold,
  )

  const scores = resolver.resolve(root, subjectId, {
    graph,
    context,
    maxDepth,
    format,
    followTrustThreshold: 1,
    now,
    subjectType: query.subject.type,
    scoreKind: RATING_STATEMENT_KIND,
    ...(labels.length > 0 ? { labels } : {}),
  })

  const subjectScore =
    scores.find((score) => score instanceof RatingScore && score.subject === subjectId) ??
    scores.find((score) => score instanceof RatingScore)

  if (
    !subjectScore ||
    !(subjectScore instanceof RatingScore) ||
    !subjectScore.connected ||
    !subjectScore.edges ||
    subjectScore.edges.length === 0
  ) {
    return emptyRatingResult(
      query,
      context,
      now,
      graphVersion,
      followTrustThreshold,
      followTrustRed,
    )
  }

  const distance = Math.max(0, subjectScore.degree - 1)
  const evidence: RatingClaimEvidence[] = []
  for (const edgeIndex of subjectScore.edges) {
    const claim = claimFromEdge(graph, edgeIndex, distance)
    if (!claim) continue
    evidence.push(claim)
  }
  evidence.sort(
    (left, right) =>
      left.distance - right.distance ||
      right.createdAt - left.createdAt ||
      left.eventId.localeCompare(right.eventId),
  )

  const averageScore = averageRatingScore(evidence.map((claim) => claim.score))
  const own = evidence.find((claim) => claim.author === root)
  const degree = subjectScore.degree

  let pathView: GraphPathView = EMPTY_PATH_VIEW
  const ratingEdges: GraphPathViewEdge[] = []
  if (format === 'path' && evidence.length > 0) {
    pathView = scoresToPathView(graph, scores)
    const postIndex = graph.nodesIndex.get(subjectId)
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
    subject: { ...query.subject },
    context,
    claims: evidence,
    averageScore,
    claimCount: evidence.length,
    degree,
    ...(own !== undefined ? { own } : {}),
    sourceEventIds: evidence.map((claim) => claim.eventId).sort(),
    paths: [],
    pathView,
    ratingEdges,
    computedAt: now,
    graphVersion,
    followTrustThreshold,
    followTrustRed,
  }
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
}

export const artifactRatingResolver = new ArtifactRatingResolver()
