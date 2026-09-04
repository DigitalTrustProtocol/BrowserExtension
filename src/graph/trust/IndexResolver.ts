/**
 * Vendored from DigitalTrustProtocol/Trust (IndexResolver.ts).
 * AttentionX: returns Score[] (no ApiEnvelope); default followTrustThreshold = 1.
 */

import { isValidAt, trustEdgeValue } from './Edge'
import type { Graph } from './Graph'
import type { IResolveStrategy, IResolveStrategyOptions } from './IResolveStrategy'
import { IndexScoreMap, IRatingScore, ITrustScore, type Score } from './Score'

import { TRUST_STATEMENT_KIND } from '../../shared/kind-32009'
import { WOT_MAX_DEGREE_HARD_CAP } from '../../shared/wot-max-degree'
import pathStrategyJson from './pathStrategyJson'
import { RATING_STATEMENT_KIND } from '@shared/kind-32014'

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
      return ['i', 'p']
    case 'p':
      return ['p', 'i']
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
    const subjectKind = options.subjectType === 'p' ? TRUST_STATEMENT_KIND : RATING_STATEMENT_KIND;

    const scores = new IndexScoreMap()
    const authorScore = scores.getSubject(authorIndex, 0, subjectKind)

    authorScore.visited = true
    authorScore.degree = 0

    if (subjectKind === TRUST_STATEMENT_KIND) {
      (authorScore as ITrustScore).trustValue = 1
      authorScore.count = 1
    }

    if (authorId === subjectId) {
      authorScore.connected = true
      authorScore.subject = authorId
      return [authorScore]
    }

    const maxDepth = Math.min(options.maxDepth ?? MAX_DEPTH, MAX_DEPTH)
    const followTrustThreshold = options.followTrustThreshold ?? 1
    const context = options.context ?? ''

    const subjectScore = scores.getSubject(subjectIndex, 0, subjectKind)
    subjectScore.subject = subjectId

    const evidenceType = options.subjectType ?? subjectNode.type
    const subjectIncoming = new Map<number, number>()
    for (const subjectType of evidenceSubjectTypes(evidenceType)) {
      for (const ctxIdx of graph.getContextIndexes(context, subjectType)) {
        const inMap = subjectNode.inbound.get(ctxIdx)
        if (!inMap) continue
        for (const [aIndex, edgeIndex] of inMap.entries()) {
          if (subjectIncoming.has(aIndex)) continue
          const edge = graph.edgesList[edgeIndex]
          if (!edge || !isValidAt(edge, time)) {
            continue
          }
          subjectIncoming.set(aIndex, edgeIndex)
        }
      }
    }
    if (subjectIncoming.size === 0) return [subjectScore]

    const hopContextIndexes = uniqueContextIndexes(
      graph.getContextIndexes(context, 'p'),
      graph.getContextIndexes(context, 'i'),
    )

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
        const edgeIndex = subjectIncoming.get(aIndex)
        if (edgeIndex === undefined) continue

        const hopScore = scores.get(aIndex) as ITrustScore;
        if (!hopScore || hopScore.kind !== TRUST_STATEMENT_KIND) continue
        if (hopScore.trustValue < followTrustThreshold) continue

        const edge = graph.edgesList[edgeIndex]
        if (!edge || !isValidAt(edge, time)) continue

        subjectScore.addTrust(edge, degree)
      }
      if (subjectScore.count > 0) continue

      while (nodeCounter < degreeLength) {
        const nodeIndex = queue[nodeCounter++]!
        const score = scores.get(nodeIndex) as ITrustScore;
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
            scores,
            subjectScore,
            queue,
            time,
            subjectKind
          )
        }
      }
    }

    subjectScore.connected = subjectScore.count > 0
    const format = options.format ?? "default"
    if (subjectScore.connected && format == "path") {
      return pathStrategyJson.resolve(
        authorIndex,
        subjectIndex,
        scores,
        graph,
      )
    }
    return [subjectScore]
  }

  private processTrusts(
    graph: Graph,
    authorIndex: number,
    degree: number,
    outgoing: Map<number, number>,
    scores: IndexScoreMap,
    subjectScore: Score,
    queue: number[],
    time: number,
    subjectKind: number,
  ): void {
    for (const [nodeIndex, edgeIndex] of outgoing.entries()) {
      if (nodeIndex === subjectScore.subjectIndex) continue
      const peer = graph.nodesList[nodeIndex]
      if (!peer || peer.type !== 'p') continue

      const nodeScore = scores.getSubject(nodeIndex, degree, subjectKind)
      if (nodeScore.authorIndex === authorIndex) continue

      const edge = graph.edgesList[edgeIndex]
      if (!edge) continue
      if (!isValidAt(edge, time)) continue

      nodeScore.authorIndex = authorIndex
      nodeScore.addTrust(edge, degree)

      if (subjectKind !== TRUST_STATEMENT_KIND) continue
      if (trustEdgeValue(edge) !== 1) continue

      if (!nodeScore.visited && subjectScore.count === 0) {
        queue.push(nodeIndex)
        nodeScore.visited = true
      }
    }
  }
}

const indexResolver = new IndexResolver()
export default indexResolver
