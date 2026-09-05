/**
 * Vendored from DigitalTrustProtocol/Trust (IndexResolver.ts).
 * AttentionX: returns Score[] (no ApiEnvelope); default followTrustThreshold = 1.
 */

import { isValidAt, trustEdgeValue } from './Edge'
import type { Graph } from './Graph'
import type { IResolveStrategy, IResolveStrategyOptions } from './IResolveStrategy'
import { IndexScoreMap, IRatingScore, ITrustScore, type Score } from './Score'

import { TRUST_STATEMENT_KIND } from '../../lib/nostr/kind-32009'
import { WOT_MAX_DEGREE_HARD_CAP } from '../../shared/wot-max-degree'
import pathStrategyJson from './pathStrategyJson'
import { RATING_STATEMENT_KIND } from '../../lib/nostr/kind-32014'

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
    //const subjectKind = options.subjectType === 'p' ? TRUST_STATEMENT_KIND : RATING_STATEMENT_KIND;

    const scores = new IndexScoreMap()
    const authorScore = scores.getSubject(authorIndex, 0, TRUST_STATEMENT_KIND) as ITrustScore // Author score is always a trust score

    authorScore.visited = true
    authorScore.degree = 0
    authorScore.trustValue = 1
    authorScore.count = 1

    if (authorId === subjectId) { // If the author is the subject, return the author score and exit early
      authorScore.connected = true
      authorScore.subject = authorId
      return [authorScore]
    }

    const maxDepth = Math.min(options.maxDepth ?? MAX_DEPTH, MAX_DEPTH)
    const followTrustThreshold = options.followTrustThreshold ?? 1
    const context = options.context ?? ''

    const scoreKind = options.scoreKind ?? TRUST_STATEMENT_KIND
    const subjectScore = scores.getSubject(subjectIndex, 0, scoreKind)
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

    // Main loop until the subject score has been updated or the max depth has been reached or we run out of nodes to test
    while (
      queue.length > nodeCounter &&
      degree < maxDepth &&
      subjectScore.count === 0
    ) {
      const degreeLength = queue.length // Save the length of the queue for later use
      degree++ // Increment the degree

      // Test if the nodes are within 1 degree of the subject
      // This algo is to speed up the process by only testing nodes that are within 1 degree of the subject
      for (let i = nodeCounter; i < degreeLength; i++) {
        const aIndex = queue[i]!
        const edgeIndex = subjectIncoming.get(aIndex) // Is the node within 1 degree of the subject?
        if (edgeIndex === undefined) continue // If not, skip

        const hopScore = scores.get(aIndex) as ITrustScore; // Get the score of the parent node
        if (!hopScore || hopScore.kind !== TRUST_STATEMENT_KIND) continue // If the parent node is not a trust score, skip
        if (hopScore.trustValue < followTrustThreshold) continue // If the parent node has a trust value less than the follow trust threshold, skip (we don't want to follow nodes that we don't trust)

        const edge = graph.edgesList[edgeIndex] // Get the edge between the parent node and the subject
        if (!edge || !isValidAt(edge, time)) continue // If the edge is not valid, skip

        subjectScore.addTrust(edge, degree) // Add the trust value to the subject score
      }
      if (subjectScore.count > 0) continue // If the subject score has been updated, skip the rest of the loop

      while (nodeCounter < degreeLength) { // Test if there is more nodes to test
        const nodeIndex = queue[nodeCounter++]!
        const score = scores.get(nodeIndex) as ITrustScore; // Get the score of the node
        if (!score) continue // If the node is not a trust score, skip (shouldn't happen)
        if (score.trustValue < followTrustThreshold) continue // If the node has a trust value less than the follow trust threshold, skip (we don't want to follow nodes that we don't trust)

        const node = graph.nodesList[nodeIndex] // Get the node
        if (!node) continue // If the node is not found, skip (shouldn't happen) 

        // Build up the next degree of nodes to test
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
            scoreKind
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
    scoreKind: number,
  ): void {
    for (const [nodeIndex, edgeIndex] of outgoing.entries()) {
      if (nodeIndex === subjectScore.subjectIndex) continue
      const peer = graph.nodesList[nodeIndex]
      if (!peer || peer.type !== 'p') continue

      const nodeScore = scores.getSubject(nodeIndex, degree, TRUST_STATEMENT_KIND) // Score are TRUST Score by default, subject score have already been defined
      if (nodeScore.authorIndex === authorIndex) continue

      const edge = graph.edgesList[edgeIndex]
      if (!edge) continue
      if (!isValidAt(edge, time)) continue

      nodeScore.authorIndex = authorIndex
      nodeScore.addTrust(edge, degree)

      if (nodeScore.kind !== TRUST_STATEMENT_KIND) continue // Only the subject score can be a rating score
      if (trustEdgeValue(edge) !== 1) continue // Only trust edges are considered

      if (!nodeScore.visited && subjectScore.count === 0) {
        queue.push(nodeIndex)
        nodeScore.visited = true
      }
    }
  }
}

const indexResolver = new IndexResolver()
export default indexResolver
