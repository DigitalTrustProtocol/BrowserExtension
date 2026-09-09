/**
 * Vendored from DigitalTrustProtocol/Trust (IndexResolver.ts).
 * AttentionX: returns Score[] (no ApiEnvelope); default followTrustThreshold = 1.
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
    authorId: string,
    subjectId: string,
    options: IResolveStrategyOptions = {},
  ): Score[] {
    const graph = options.graph as Graph | undefined
    if (!graph) return []

    const time = options.now ?? Math.floor(Date.now() / 1000)
    authorId = authorId.toLowerCase().trim()
    subjectId = subjectId.toLowerCase().trim()

    const authorNode = graph.getNode(authorId)
    if (!authorNode) return []
    const authorIndex = authorNode.index

    const subjectNode = graph.getNode(subjectId)
    if (!subjectNode) return []
    const subjectIndex = subjectNode.index

    const scoreMap = new IndexScoreMap()
    const scoreKind = options.scoreKind ?? TRUST_STATEMENT_KIND
    const format = options.format ?? 'default'
    const authorTrustScore = this.initAuthorScore(scoreMap, authorIndex, 0)
    if (authorId === subjectId) {
      authorTrustScore.connected = true
      authorTrustScore.subject = authorId
      if (format === 'path') {
        return pathStrategyJson.resolve(
          authorIndex,
          subjectIndex,
          scoreMap,
          graph,
          TRUST_STATEMENT_KIND,
        )
      }
      return [authorTrustScore]
    }

    const maxDepth = Math.min(options.maxDepth ?? MAX_DEPTH, MAX_DEPTH)
    const followTrustThreshold = options.followTrustThreshold ?? 1
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
    if (subjectIncomingEdges.size === 0) return [subjectScore]

    const queue: number[] = [authorIndex]
    let degree = 0
    let nodeCounter = 0

    while (
      queue.length > nodeCounter &&
      degree < maxDepth &&
      subjectScore.count === 0
    ) {
      const degreeLength = queue.length
      degree++

      for (let i = nodeCounter; i < degreeLength; i++) {
        const aIndex = queue[i]!

        const edge = subjectIncomingEdges.get(aIndex)
        if (!edge) continue

        const hopScore = scoreMap.getTrust(aIndex)
        if (!hopScore) continue
        if (hopScore.trustValue < followTrustThreshold) continue

        subjectScore.add(edge, degree)
      }

      if (subjectScore.count > 0) continue

      while (nodeCounter < degreeLength) {
        const nodeIndex = queue[nodeCounter++]
        const score = scoreMap.getTrust(nodeIndex)
        if (!score) continue
        if (score.trustValue < followTrustThreshold) continue

        const node = graph.nodesList[nodeIndex]
        if (!node) continue

        for (const [peerIndex, edgeIndex] of node.getOut(hopContextIndexes)) {
          this.processTrusts(
            graph,
            nodeIndex,
            degree,
            peerIndex,
            edgeIndex,
            scoreMap,
            subjectScore,
            queue,
            time,
            scoreKind,
          )
        }
      }
    }

    subjectScore.connected = subjectScore.count > 0
    if (subjectScore.connected && format === 'path') {
      return pathStrategyJson.resolve(
        authorIndex,
        subjectIndex,
        scoreMap,
        graph,
        scoreKind,
      )
    }
    return [subjectScore]
  }

  private processTrusts(
    graph: Graph,
    authorIndex: number,
    degree: number,
    nodeIndex: number,
    edgeIndex: number,
    scoreMap: IndexScoreMap,
    subjectScore: IScore,
    queue: number[],
    time: number,
    scoreKind: number,
  ): void {
    if (nodeIndex === subjectScore.subjectIndex) return

    const edge = graph.edgesList[edgeIndex]
    if (!edge) return // If the edge is not found, return, this should never happen
    if (edge.kind !== TRUST_STATEMENT_KIND && edge.kind !== scoreKind) return // If the edge is not a trust statement or the score kind, return
    
    if (!isValidAt(edge, time)) return

    const node = graph.nodesList[nodeIndex]
    if (!node || node.type !== 'p') return // If the node is not found or the type is not 'p', return this should never happen

    const nodeScore = scoreMap.ensure(nodeIndex, degree, edge.kind)
    if (nodeScore.authorIndex === authorIndex) return

    if(!nodeScore.add(edge, degree)) return // If the edge is not added for different reasons, return
    nodeScore.authorIndex = authorIndex

    if (edge.kind !== TRUST_STATEMENT_KIND) return // If the edge is not a trust statement, return
    if (trustEdgeValue(edge) !== 1) return // If the edge value is not 1, return

    if (!nodeScore.visited && subjectScore.count === 0) {
      queue.push(nodeIndex)
      nodeScore.visited = true
    }
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
