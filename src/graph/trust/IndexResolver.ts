/**
 * Vendored from DigitalTrustProtocol/Trust (IndexResolver.ts).
 * AttentionX: returns Score[] (no ApiEnvelope); default followTrustThreshold = 75.
 */

import { IEdge, isValidAt, trustEdgeValue } from './Edge'
import type { Graph } from './Graph'
import type { IResolveStrategy, IResolveStrategyOptions } from './IResolveStrategy'
import {
  IndexScoreMap,
  TrustScore,
  type IScore,
  type ITrustScore,
  type Score,
} from './Score'

import { TRUST_STATEMENT_KIND } from '../../lib/nostr/kind-32009'
import { RATING_STATEMENT_KIND } from '../../lib/nostr/kind-32014'
import { meetsFollowTrustGreen } from '../../shared/trust-score'
import { FOLLOW_TRUST_GREEN_DEFAULT } from '../../shared/wot-follow-trust-threshold'
import { WOT_MAX_DEGREE_HARD_CAP } from '../../shared/wot-max-degree'
import pathStrategyJson from './pathStrategyJson'
import { Node } from './Node'

const MAX_DEPTH = WOT_MAX_DEGREE_HARD_CAP

function uniqueContextIndexes(...groups: readonly number[][]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const group of groups) {
    for (const index of group) {
      if (seen.has(index)) continue
      seen.add(index)
      out.push(index)
    }
  }
  return out
}

function evidenceSubjectTypes(
  preferred: 'p' | 'e' | 'i',
): Array<'p' | 'e' | 'i'> {
  switch (preferred) {
    case 'e':
      return ['e']
    case 'i':
    case 'p':
      return ['i', 'p']
    default: {
      const _exhaustive: never = preferred
      return _exhaustive
    }
  }
}

function matchesLabels(
  edge: IEdge,
  labels: readonly string[],
): boolean {
  if (labels.length === 0) return true
  const edgeLabels = edge.labels ?? []
  return labels.some((label) => edgeLabels.includes(label))
}

export class IndexResolver implements IResolveStrategy {
  readonly name = 'graph'

  resolve(
    observerId: string,
    subjectId: string,
    options: IResolveStrategyOptions = {},
  ): Score[] {
    const graph = options.graph as Graph | undefined
    if (!graph) return [] // If the graph is not found, return an empty array, should never happen

    const time = options.now ?? Math.floor(Date.now() / 1000)
    observerId = observerId.toLowerCase().trim()
    subjectId = subjectId.toLowerCase().trim()

    const observerNode = graph.getNode(observerId)
    if (!observerNode) return []

    const observerIndex = observerNode.index

    const subjectNode = graph.getNode(subjectId)
    if (!subjectNode) return []
    const subjectIndex = subjectNode.index

    const scoreMap = new IndexScoreMap()
    const scoreKind = options.scoreKind ?? TRUST_STATEMENT_KIND
    const format = options.format ?? 'default'
    const observerTrustScore = this.initAuthorScore(scoreMap, observerIndex, 0)
    if (observerId === subjectId) {
      observerTrustScore.connected = true
      observerTrustScore.subject = observerId
      if (format === 'path') {
        return pathStrategyJson.resolve(
          observerIndex,
          subjectIndex,
          scoreMap,
          graph,
          TRUST_STATEMENT_KIND,
        )
      }
      return [observerTrustScore]
    }

    const maxDepth = Math.min(options.maxDepth ?? MAX_DEPTH, MAX_DEPTH)
    const context = options.context ?? ''

    const hopContextIndexes = uniqueContextIndexes(
      graph.getContextIndexes(context, 'p'),
      graph.getContextIndexes(context, 'i'),
    )

    const subjectScore = scoreMap.ensure(subjectIndex, 0, scoreKind)
    subjectScore.subject = subjectId

    const evidenceType = options.subjectType ?? subjectNode.type
    const labelFilter =
      scoreKind === RATING_STATEMENT_KIND
        ? (options.labels?.filter((label) => label.length > 0) ?? [])
        : []

    const subjectIncomingEdges = this.buildIncomingEdges(
      subjectNode,
      graph,
      context,
      scoreKind,
      time,
      evidenceType,
      labelFilter,
    )
    if (subjectIncomingEdges.size === 0) return [subjectScore] // If there are no incoming edges, return the subject score

    const queue: number[] = [observerIndex]
    let degree = 0
    let nodeCounter = 0

    while (
      queue.length > nodeCounter &&
      degree < maxDepth &&
      subjectScore.count === 0
    ) {
      const degreeLength = queue.length
      degree++

      // Check all the incoming edges of the subject against nodes in the queue
      for (let i = nodeCounter; i < degreeLength; i++) {
        const queueNodeIndex = queue[i]!

        const edge = subjectIncomingEdges.get(queueNodeIndex)
        if (!edge) continue // If the edge is not found connecting the current node to the subject, continue

        const queueNodeScore = scoreMap.getTrust(queueNodeIndex) // Get the trust score of the current node in the queue
        if (!queueNodeScore) continue // If the trust score is not found, continue, should never happen
        if (!this.meetsThreshold(queueNodeScore, options)) continue

        subjectScore.add(edge, degree) // Connection found, add the edge to the subject score
      }

      if (subjectScore.count > 0) break // If the subject score has been connected, break out of the loop, no need to continue

      // Breadth-first search
      while (nodeCounter < degreeLength) {
        const nodeIndex = queue[nodeCounter++]
        const score = scoreMap.getTrust(nodeIndex)
        if (!score) continue // If the trust score is not found, continue, should never happen
        if (!this.meetsThreshold(score, options)) continue

        const node = graph.nodesList[nodeIndex]
        if (!node) continue // If the node is not found, continue, should never happen

        // Check all the outgoing edges of the node against the subject
        for (const [peerIndex, edgeIndex] of node.getOut(hopContextIndexes)) {

          if (peerIndex === subjectIndex) continue // If the peer is the subject, continue, wrong type of edge found

          const edge = graph.edgesList[edgeIndex]
          if (!edge) continue // If the edge is not found, continue, this should never happen
          if (edge.kind !== TRUST_STATEMENT_KIND && edge.kind !== scoreKind) continue // If the edge is not a trust statement or the score kind, continue
          if (!isValidAt(edge, time)) continue // If the edge is not valid at the given time, continue
      
          const peerNode = graph.nodesList[peerIndex]
          if (!peerNode || peerNode.type !== 'p') continue // If the peer node is not found or the type is not 'p', continue
      
          const peerScore = scoreMap.ensure(peerIndex, degree, edge.kind)
          if (peerScore.authorIndex === nodeIndex) continue // Prevent double counting, self-loops are not allowed
      
          if(!peerScore.add(edge, degree)) continue  // If the edge is not added for different reasons, continue
          peerScore.authorIndex = nodeIndex
      
          if (edge.kind !== TRUST_STATEMENT_KIND) continue // If the edge is not a trust statement, continue
          if (trustEdgeValue(edge) !== 1) continue // If the edge value is not 1, continue
      
          if (!peerScore.visited && subjectScore.count === 0) {
            queue.push(peerIndex)
            peerScore.visited = true
          }

        }
      }
    }

    subjectScore.connected = subjectScore.count > 0
    if (subjectScore.connected && format === 'path') {
      return pathStrategyJson.resolve(
        observerIndex,
        subjectIndex,
        scoreMap,
        graph,
        scoreKind,
      )
    }
    return [subjectScore]
  }

  private meetsThreshold(score: ITrustScore, options: IResolveStrategyOptions): boolean {
    const threshold = options.followTrustThreshold ?? FOLLOW_TRUST_GREEN_DEFAULT
    return meetsFollowTrustGreen(score.trust, score.distrust, threshold)
  }

  
  private initAuthorScore(
    scoreMap: IndexScoreMap,
    nodeIndex: number,
    degree: number,
  ): ITrustScore {
    const trustScore = scoreMap.ensure(
      nodeIndex,
      degree,
      TRUST_STATEMENT_KIND,
    )
    if (!(trustScore instanceof TrustScore)) {
      throw new Error('author hop score must be TrustScore')
    }
    trustScore.visited = true
    trustScore.count = 1
    trustScore.trustValue = 1
    trustScore.trust = 1
    return trustScore
  }

  private buildIncomingEdges(
    subjectNode: Node,
    graph: Graph,
    context: string,
    scoreKind: number,
    time: number,
    evidenceType: 'p' | 'e' | 'i',
    labels: readonly string[],
  ): Map<number, IEdge> {
    const subjectIncomingEdges = new Map<number, IEdge>()
    for (const subjectType of evidenceSubjectTypes(evidenceType)) {
      for (const ctxIdx of graph.getContextIndexes(context, subjectType)) {
        const inMap = subjectNode.inbound.get(ctxIdx)
        if (!inMap) continue
        for (const [aIndex, edgeIndexes] of inMap.entries()) {
          if (subjectIncomingEdges.has(aIndex)) continue
          for (const edgeIndex of edgeIndexes) {
            const edge = graph.edgesList[edgeIndex]
            if (!edge || edge.kind !== scoreKind || !isValidAt(edge, time)) {
              continue
            }
            if (!matchesLabels(edge, labels)) continue
            subjectIncomingEdges.set(aIndex, edge)
            break
          }
        }
      }
    }
    return subjectIncomingEdges
  }
}

const indexResolver = new IndexResolver()
export default indexResolver
