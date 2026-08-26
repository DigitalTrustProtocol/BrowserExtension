/**
 * Vendored from DigitalTrustProtocol/Trust (IndexResolver.ts).
 * AttentionX: returns Score[] (no ApiEnvelope); default followTrustThreshold = 1.
 */

import type { Graph } from './Graph'
import type {
  IResolveStrategy,
  IResolveStrategyOptions,
} from './IResolveStrategy'
import { IndexScoreMap, type Score } from './Score'

import { WOT_MAX_DEGREE_HARD_CAP } from '../../shared/wot-max-degree'

const MAX_DEPTH = WOT_MAX_DEGREE_HARD_CAP

function authorHopDegree(
  graph: Graph,
  scores: IndexScoreMap,
  author: string,
): number | undefined {
  const authorIndex = graph.nodesIndex.get(author.toLowerCase())
  if (authorIndex === undefined) return undefined
  return scores.get(authorIndex)?.degree
}

/**
 * Path / query evidence is last-degree only. Neutral recorded while walking
 * nearer hops is dropped so it does not appear before the hitting degree.
 * Neutral-only subjects keep the nearest Neutral degree.
 */
function keepLastDegreeEdges(
  graph: Graph,
  scores: IndexScoreMap,
  subjectScore: Score,
): void {
  if (!subjectScore.edges || subjectScore.edges.length === 0) return

  const hopDegree = (edgeIndex: number): number | undefined => {
    const edge = graph.edgesList[edgeIndex]
    if (!edge) return undefined
    return authorHopDegree(graph, scores, edge.author)
  }

  if (subjectScore.count > 0) {
    const lastAuthorDegree = Math.max(0, subjectScore.degree - 1)
    subjectScore.edges = subjectScore.edges.filter(
      (edgeIndex) => hopDegree(edgeIndex) === lastAuthorDegree,
    )
    return
  }

  let nearest = Infinity
  for (const edgeIndex of subjectScore.edges) {
    const degree = hopDegree(edgeIndex)
    if (degree === undefined) continue
    if (degree < nearest) nearest = degree
  }
  if (nearest === Infinity) {
    subjectScore.edges = []
    return
  }
  subjectScore.edges = subjectScore.edges.filter(
    (edgeIndex) => hopDegree(edgeIndex) === nearest,
  )
  subjectScore.degree = nearest + 1
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

    const authorIndex = graph.nodesIndex.get(authorId)
    if (authorIndex === undefined) return []

    const subjectIndex = graph.nodesIndex.get(subjectId)
    if (subjectIndex === undefined) return []

    const scores = new IndexScoreMap()
    const authorScore = scores.getSubject(authorIndex, 0)
    authorScore.visited = true
    authorScore.trustValue = 1
    authorScore.count = 1
    authorScore.degree = 0

    if (authorId === subjectId) {
      authorScore.connected = true
      authorScore.subject = authorId
      return [authorScore]
    }

    const maxDepth = Math.min(options.maxDepth ?? MAX_DEPTH, MAX_DEPTH)
    const followTrustThreshold = options.followTrustThreshold ?? 1
    const context = options.context ?? ''

    const subjectScore = scores.getSubject(subjectIndex, 0)
    subjectScore.subject = subjectId
    const subjectNode = graph.getNode(subjectId)
    if (!subjectNode) return []

    const subjectIncoming = new Map<number, number>()
    for (const ctxIdx of graph.getContextIndexes(
      context,
      subjectNode.type,
    )) {
      const inMap = subjectNode.inbound.get(ctxIdx)
      if (!inMap) continue
      for (const [aIndex, edgeIndex] of inMap.entries()) {
        if (subjectIncoming.has(aIndex)) continue
        const edge = graph.edgesList[edgeIndex]
        if (!edge || !edge.isValidAt(time)) continue
        subjectIncoming.set(aIndex, edgeIndex)
      }
    }
    if (subjectIncoming.size === 0) return [subjectScore]

    const contextIndexes = graph.getContextIndexes(context, 'p')

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

        const hopScore = scores.get(aIndex)
        if (!hopScore) continue
        if (hopScore.trustValue < followTrustThreshold) continue

        const edge = graph.edgesList[edgeIndex]
        if (!edge) continue
        if (!edge.isValidAt(time)) continue

        subjectScore.addTrust(edge, degree)
      }
      if (subjectScore.count > 0) continue

      while (nodeCounter < degreeLength) {
        const nodeIndex = queue[nodeCounter++]!
        const score = scores.get(nodeIndex)
        if (!score) continue
        if (score.trustValue < followTrustThreshold) continue

        const node = graph.nodesList[nodeIndex]
        if (!node) continue

        for (const outgoing of node.getOut(contextIndexes)) {
          this.processTrusts(
            graph,
            nodeIndex,
            degree,
            outgoing,
            scores,
            subjectScore,
            queue,
            time,
          )
        }
      }
    }

    subjectScore.connected = subjectScore.count > 0
    keepLastDegreeEdges(graph, scores, subjectScore)
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
  ): void {
    for (const [nodeIndex, edgeIndex] of outgoing.entries()) {
      const nodeScore = scores.getSubject(nodeIndex, degree)
      if (nodeScore.authorIndex === authorIndex) continue

      const edge = graph.edgesList[edgeIndex]
      if (!edge) continue
      if (!edge.isValidAt(time)) continue
      if (edge.value !== 1) continue

      nodeScore.authorIndex = authorIndex
      nodeScore.addTrust(edge, degree)

      if (!nodeScore.visited && subjectScore.count === 0) {
        queue.push(nodeIndex)
        nodeScore.visited = true
      }
    }
  }
}

const indexResolver = new IndexResolver()
export default indexResolver
