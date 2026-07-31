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
      if (!score) return

      result.push(score)
      if (nodeIndex === authorIndex) return
      if (!score.edges || score.edges.length === 0) return

      for (const edgeIndex of score.edges) {
        const edge = graph.edgesList[edgeIndex]
        if (!edge) continue
        const authorNodeIndex = graph.nodesIndex.get(edge.author.toLowerCase())
        if (authorNodeIndex === undefined) continue
        traverse(authorNodeIndex)
      }
    }

    traverse(subjectIndex)
    return result
  }
}

const pathStrategyJson = new PathStrategyJson()
export default pathStrategyJson
