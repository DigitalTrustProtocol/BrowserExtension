/**
 * Vendored from DigitalTrustProtocol/Trust (pathStrategyJson.ts).
 * AttentionX: walk predecessor via edge.author node index (fixed traverse).
 */

import type { Graph } from './Graph'
import type { Score } from './Score'

class PathStrategyJson {
  resolve(
    authorIndex: number,
    subjectIndex: number,
    scores: Map<number, Score>,
    graph: Graph,
  ): Score[] {
    const result: Score[] = []
    const visited = new Set<number>()

    const traverse = (nodeIndex: number): void => {
      if (visited.has(nodeIndex)) return
      visited.add(nodeIndex)

      const score = scores.get(nodeIndex)
      if (!score) return // score not found, should not happen, safe guard

      result.push(score)
      if (nodeIndex === authorIndex) return // stop if we've reached the author
      if (!score.edges || score.edges.length === 0) return // stop if no edges

      for (const edgeIndex of score.edges) {
        const edge = graph.edgesList[edgeIndex]
        if (!edge) continue // edge not found, should not happen, safe guard

        const authorNodeIndex = graph.nodesIndex.get(edge.pubkey.toLowerCase())
        if (authorNodeIndex === undefined) continue // author node not found, should not happen, safe guard
        traverse(authorNodeIndex)
      }
    }

    traverse(subjectIndex)
    return result
  }
}

const pathStrategyJson = new PathStrategyJson()
export default pathStrategyJson
