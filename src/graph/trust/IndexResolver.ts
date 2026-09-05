/**
 * Vendored from DigitalTrustProtocol/Trust (IndexResolver.ts).
 * AttentionX: returns Score[] (no ApiEnvelope); default followTrustThreshold = 1.
 */

import { IEdge, isValidAt, trustEdgeValue } from './Edge'
import type { Graph } from './Graph'
import type { IResolveStrategy, IResolveStrategyOptions } from './IResolveStrategy'
import { IndexScoreMap, type IScore, type ITrustScore, type Score } from './Score'

import { TRUST_STATEMENT_KIND } from '../../lib/nostr/kind-32009'
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

    const [authorTrustScore] = this.initAuthorScore(
      scoreMap,
      authorIndex,
      0,
      scoreKind,
    )
    if (authorId === subjectId) {
      authorTrustScore.connected = true
      authorTrustScore.subject = authorId
      return [authorTrustScore]
    }

    const maxDepth = Math.min(options.maxDepth ?? MAX_DEPTH, MAX_DEPTH)
    const followTrustThreshold = options.followTrustThreshold ?? 1
    const context = options.context ?? ''
    const hopContextIndexes = uniqueContextIndexes(
      graph.getContextIndexes(context, 'p', TRUST_STATEMENT_KIND),
      graph.getContextIndexes(context, 'i', TRUST_STATEMENT_KIND),
    )

    const subjectScore = scoreMap.ensure(subjectIndex, 0, scoreKind)
    subjectScore.subject = subjectId

    const evidenceType = options.subjectType ?? subjectNode.type
    const subjectIncomingEdges = this.buildIncomingEdges(
      subjectNode,
      graph,
      context,
      scoreKind,
      time,
      evidenceType,
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

        for (const outgoing of node.getOut(hopContextIndexes)) {
          this.processTrusts(
            graph,
            nodeIndex,
            degree,
            outgoing,
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
    const format = options.format ?? 'default'
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
    outgoing: Map<number, number>,
    scoreMap: IndexScoreMap,
    subjectScore: IScore,
    queue: number[],
    time: number,
    scoreKind: number,
  ): void {
    for (const [nodeIndex, edgeIndex] of outgoing.entries()) {
      if (nodeIndex === subjectScore.subjectIndex) continue

      const edge = graph.edgesList[edgeIndex]
      if (!edge) continue
      if (edge.kind !== TRUST_STATEMENT_KIND && edge.kind !== scoreKind) {
        continue
      }
      if (!isValidAt(edge, time)) continue

      const node = graph.nodesList[nodeIndex]
      if (!node || node.type !== 'p') continue

      const nodeScore = scoreMap.ensure(nodeIndex, degree, edge.kind)
      if (nodeScore.authorIndex === authorIndex) continue

      nodeScore.authorIndex = authorIndex
      nodeScore.add(edge, degree)

      if (edge.kind !== TRUST_STATEMENT_KIND) continue
      if (trustEdgeValue(edge) !== 1) continue

      if (!nodeScore.visited && subjectScore.count === 0) {
        queue.push(nodeIndex)
        nodeScore.visited = true
      }
    }
  }

  private initAuthorScore(
    scoreMap: IndexScoreMap,
    nodeIndex: number,
    degree: number,
    scoreKind: number = TRUST_STATEMENT_KIND,
  ): [ITrustScore, IScore] {
    const trustScore = scoreMap.ensure(
      nodeIndex,
      degree,
      TRUST_STATEMENT_KIND,
    ) as ITrustScore
    trustScore.visited = true
    trustScore.count = 1
    trustScore.trustValue = 1

    const optionalScore = scoreMap.ensure(nodeIndex, degree, scoreKind)
    return [trustScore, optionalScore]
  }

  private buildIncomingEdges(
    subjectNode: Node,
    graph: Graph,
    context: string,
    scoreKind: number,
    time: number,
    evidenceType: 'p' | 'e' | 'i',
  ): Map<number, IEdge> {
    const subjectIncomingEdges = new Map<number, IEdge>()
    for (const subjectType of evidenceSubjectTypes(evidenceType)) {
      for (const ctxIdx of graph.getContextIndexes(
        context,
        subjectType,
        scoreKind,
      )) {
        const inMap = subjectNode.inbound.get(ctxIdx)
        if (!inMap) continue
        for (const [aIndex, edgeIndex] of inMap.entries()) {
          if (subjectIncomingEdges.has(aIndex)) continue
          const edge = graph.edgesList[edgeIndex]
          if (!edge || edge.kind !== scoreKind || !isValidAt(edge, time)) {
            continue
          }
          subjectIncomingEdges.set(aIndex, edge)
        }
      }
    }
    return subjectIncomingEdges
  }
}

const indexResolver = new IndexResolver()
export default indexResolver
