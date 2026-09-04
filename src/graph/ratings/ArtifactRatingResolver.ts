/**
 * Artifact ratings (kind 32014): active claims from identities already
 * trusted via kind 32009 positive `p` hops, aggregated at the nearest
 * hitting degree (same stop rule as IndexResolver). Never a traversal edge.
 */

import { heapIndexId, ratingSubjectKey, ratingScoreToEdgeValue } from '../adapter'
import { normalizeResolveBounds } from '../bounds'
import { cloneLabelHints } from '../../shared/kind-32009'
import { eventRecordSubject } from '../../nip32009/nip32009'
import type { EventRecord } from '../../storage/types'
import {
  EMPTY_PATH_VIEW,
  scoresToPathView,
  unionPathViews,
  viewNodeFromHeap,
} from '../path-view'
import type { Graph } from '../trust/Graph'
import type { IResolveStrategy } from '../trust/IResolveStrategy'
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

export function isRatingClaimActive(
  claim: Pick<EventRecord, 'activate' | 'expire'>,
  now: number,
): boolean {
  if (claim.activate !== undefined && now < claim.activate) return false
  if (claim.expire !== undefined && now > claim.expire) return false
  return true
}

/**
 * Root plus pubkeys reachable on active positive `p` edges.
 * Issuer hop distance is strictly less than maxDepth so hitting degree
 * (`distance + 1`) matches IndexResolver's maxDepth cap.
 */
export function collectTrustedIssuers(
  graph: Graph,
  rootPubkey: string,
  options: { maxDepth: number; now: number },
): Map<string, number> {
  const root = rootPubkey.toLowerCase()
  const distance = new Map<string, number>([[root, 0]])
  const queue: Array<{ pubkey: string; depth: number }> = [
    { pubkey: root, depth: 0 },
  ]

  while (queue.length > 0) {
    const current = queue.shift()!
    const outbound = graph.out(current.pubkey, {
      now: options.now,
      includeInactive: false,
    })
    for (const conn of outbound) {
      if (conn.edge.value !== 1 || conn.subjectType !== 'p') continue
      const peer = conn.subject.toLowerCase()
      if (distance.has(peer)) continue
      if (
        outbound.some(
          (other) =>
            other.subject.toLowerCase() === peer && other.edge.value === -1,
        )
      ) {
        continue
      }
      const nextDepth = current.depth + 1
      if (nextDepth >= options.maxDepth) continue
      distance.set(peer, nextDepth)
      queue.push({ pubkey: peer, depth: nextDepth })
    }
  }

  return distance
}

export function executeRatingQuery(
  graph: Graph,
  resolver: IResolveStrategy,
  claims: readonly EventRecord[],
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
  const issuers = collectTrustedIssuers(graph, root, { maxDepth, now })
  const subjectKey = ratingSubjectKey(query.subject, context)
  const labelFilter = query.labels?.filter((label) => label.length > 0) ?? []

  const evidence: RatingClaimEvidence[] = []
  for (const claim of claims) {
    const subject = eventRecordSubject(claim)
    if (!subject || claim.nValue === undefined) continue
    if (ratingSubjectKey(subject, claim.c_tag ?? '') !== subjectKey) continue
    if (!isRatingClaimActive(claim, now)) continue
    const distance = issuers.get(claim.pubkey.toLowerCase())
    if (distance === undefined) continue
    const labels = claim.labels ?? []
    if (
      labelFilter.length > 0 &&
      !labelFilter.some((label) => labels.includes(label))
    ) {
      continue
    }
    const labelHints = cloneLabelHints(claim.labelHints)
    evidence.push({
      eventId: claim.id,
      author: claim.pubkey.toLowerCase(),
      subject: { ...subject },
      context: claim.c_tag ?? '',
      score: claim.nValue,
      labels: [...labels],
      ...(labelHints !== undefined ? { labelHints } : {}),
      content: claim.content,
      createdAt: claim.created_at,
      ...(claim.activate !== undefined ? { activeFrom: claim.activate } : {}),
      ...(claim.expire !== undefined ? { activeUntil: claim.expire } : {}),
      distance,
    })
  }

  evidence.sort(
    (left, right) =>
      left.distance - right.distance ||
      right.createdAt - left.createdAt ||
      left.eventId.localeCompare(right.eventId),
  )

  const hittingDistance =
    evidence.length === 0
      ? undefined
      : evidence.reduce(
          (min, claim) => Math.min(min, claim.distance),
          evidence[0]!.distance,
        )
  const hitting =
    hittingDistance === undefined
      ? []
      : evidence.filter((claim) => claim.distance === hittingDistance)
  const scores = hitting.map((claim) => claim.score)
  const averageScore =
    scores.length === 0
      ? null
      : scores.reduce((sum, score) => sum + score, 0) / scores.length
  const own = hitting.find((claim) => claim.author === root)
  const degree =
    hittingDistance === undefined ? 0 : hittingDistance + 1

  let pathView: GraphPathView = EMPTY_PATH_VIEW
  const ratingEdges: GraphPathViewEdge[] = []
  if ((query.format ?? 'default') === 'path' && hitting.length > 0) {
    const issuerKeys = [...new Set(hitting.map((claim) => claim.author))]
    const views: GraphPathView[] = []
    for (const issuer of issuerKeys) {
      const hopScores = resolver.resolve(root, issuer, {
        graph,
        maxDepth,
        format: 'path',
        followTrustThreshold: 1,
        now,
        subjectType: 'p',
      })
      views.push(scoresToPathView(graph, hopScores))
    }

    const postIndex = graph.nodesIndex.get(query.subject.value.toLowerCase())
    const postNode =
      postIndex !== undefined ? graph.nodesList[postIndex] : undefined
    if (postNode && postIndex !== undefined) {
      views.push({
        nodes: [viewNodeFromHeap(postNode, degree)],
        edges: [],
      })
      const seenFrom = new Set<GraphVisId>()
      for (const claim of hitting) {
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
    pathView = unionPathViews(views)
  }

  return {
    subject: { ...query.subject },
    context,
    claims: hitting,
    averageScore,
    claimCount: hitting.length,
    degree,
    ...(own !== undefined ? { own } : {}),
    sourceEventIds: hitting.map((claim) => claim.eventId).sort(),
    paths: [],
    pathView,
    ratingEdges,
    computedAt: now,
    graphVersion,
  }
}

export class ArtifactRatingResolver {
  readonly name = 'artifact-rating'

  resolve(
    graph: Graph,
    resolver: IResolveStrategy,
    claims: readonly EventRecord[],
    query: RatingQuery,
    graphVersion: number,
    defaultBounds: Readonly<ResolveBounds>,
  ): RatingQueryResult {
    return executeRatingQuery(
      graph,
      resolver,
      claims,
      query,
      graphVersion,
      defaultBounds,
    )
  }
}

export const artifactRatingResolver = new ArtifactRatingResolver()
