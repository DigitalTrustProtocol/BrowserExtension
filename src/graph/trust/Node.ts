/**
 * Vendored from DigitalTrustProtocol/Trust (src/lib/trust/graph/Node.ts).
 * AttentionX: `out`/`in` renamed to outbound/inbound (reserved-word safe for Oxc).
 */

import type { Graph } from './Graph'
import type { Identity, SubjectType } from './types'

export class Node {
  index: number = 0
  id: string = ''
  type: SubjectType = 'p'
  identity?: Identity

  /** Outgoing adjacency: contextIndex → peerNodeIndex → edgeIndex */
  outbound: Map<number, Map<number, number>> = new Map()
  /** Incoming adjacency: contextIndex → peerNodeIndex → edgeIndex */
  inbound: Map<number, Map<number, number>> = new Map()

  edges: Set<number> = new Set()

  constructor(id: string, type: SubjectType) {
    this.id = id
    this.type = type
  }

  /** Trust Graph API alias */
  get out(): Map<number, Map<number, number>> {
    return this.outbound
  }

  /** Trust Graph API alias */
  get in(): Map<number, Map<number, number>> {
    return this.inbound
  }

  *getOut(
    contextIndexes: number[],
  ): IterableIterator<Map<number, number>> {
    for (const contextIndex of contextIndexes) {
      const outMap = this.outbound.get(contextIndex)
      if (!outMap) continue
      yield outMap
    }
  }

  getIn(contextIndexes: number[]): Map<number, number> {
    const result = new Map<number, number>()
    for (const contextIndex of contextIndexes) {
      const inMap = this.inbound.get(contextIndex)
      if (!inMap) continue
      for (const [subjectIndex, edgeIndex] of inMap.entries()) {
        if (!result.has(subjectIndex)) {
          result.set(subjectIndex, edgeIndex)
        }
      }
    }
    return result
  }

  addOut(contextIndex: number, subjectIndex: number, edgeIndex: number): void {
    let outMap = this.outbound.get(contextIndex)
    if (!outMap) {
      outMap = new Map()
      this.outbound.set(contextIndex, outMap)
    }
    outMap.set(subjectIndex, edgeIndex)
  }

  addIn(contextIndex: number, subjectIndex: number, edgeIndex: number): void {
    let inMap = this.inbound.get(contextIndex)
    if (!inMap) {
      inMap = new Map()
      this.inbound.set(contextIndex, inMap)
    }
    inMap.set(subjectIndex, edgeIndex)
  }

  removeOut(
    graph: Graph,
    contextIndex: number,
    subjectIndex: number,
    createdAt: number,
  ): void {
    const contextMap = this.outbound.get(contextIndex)
    if (!contextMap) return

    const edgeIndex = contextMap.get(subjectIndex)
    if (edgeIndex === undefined) return
    const edge = graph.edgesList[edgeIndex]
    if (!edge) return
    if (edge.created_at > createdAt) return

    contextMap.delete(subjectIndex)
    if (contextMap.size === 0) {
      this.outbound.delete(contextIndex)
    }
  }

  removeIn(
    graph: Graph,
    contextIndex: number,
    subjectIndex: number,
    createdAt: number,
  ): void {
    const inMap = this.inbound.get(contextIndex)
    if (!inMap) return

    const edgeIndex = inMap.get(subjectIndex)
    if (edgeIndex === undefined) return
    const edge = graph.edgesList[edgeIndex]
    if (!edge) return
    if (edge.created_at > createdAt) return

    inMap.delete(subjectIndex)
    if (inMap.size === 0) {
      this.inbound.delete(contextIndex)
    }
  }
}
