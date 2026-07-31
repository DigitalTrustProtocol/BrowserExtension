/**
 * Vendored from DigitalTrustProtocol/Trust (src/lib/trust/graph/Graph.ts).
 * AttentionX: ITrustEvent carries subjects/value; eventId tie-break; e uses i context bucket.
 */

import { EdgeT1, type IEdge } from './Edge'
import { Node } from './Node'
import type {
  GraphTrustValue,
  ITrustEvent,
  SubjectType,
} from './types'

export type { GraphTrustValue }

export interface GraphTrustEdgePayload {
  dTag: string
  author: string
  kind: number
  value: GraphTrustValue
  context: string
  createdAt: number
  eventId?: string
  activate?: number
  expire?: number
  content?: string
}

export interface GraphTrustConnectionPayload {
  author: string
  subject: string
  subjectType: SubjectType
  edge: GraphTrustEdgePayload
}

export interface GraphTrustConnectionOptions {
  context?: string
  value?: GraphTrustValue
  subjectType?: SubjectType
  includeInactive?: boolean
  now?: number
}

export interface IGraph {
  applyTrustEvent(trust: ITrustEvent): boolean
  removeTrustEvent(trust: ITrustEvent): boolean
  getContextIndexes(context: string, subjectType: SubjectType): number[]
  out(
    authorId: string,
    options?: GraphTrustConnectionOptions,
  ): GraphTrustConnectionPayload[]
  in(
    subjectId: string,
    options?: GraphTrustConnectionOptions,
  ): GraphTrustConnectionPayload[]
  addNode(id: string, type: SubjectType): Node
  getNode(id: string): Node | null
  createNode(id: string, type: SubjectType): Node
  readonly nodesIndex: Map<string, number>
  readonly nodesList: Array<Node | null>
  readonly edgesList: Array<IEdge | null>
}

/** Context bucket type: p vs non-p (i/e share i:* keys, matching Trust). */
function contextBucketType(subjectType: SubjectType): 'p' | 'i' {
  return subjectType === 'p' ? 'p' : 'i'
}

function shouldReplaceEdge(
  existing: IEdge,
  incoming: ITrustEvent,
): 'keep' | 'replace' | 'ignore' {
  if (existing.createdAt > incoming.created_at) return 'ignore'
  if (existing.createdAt < incoming.created_at) return 'replace'
  // createdAt tie: lower eventId wins (AttentionX replacement rule)
  if (incoming.eventId.localeCompare(existing.eventId) < 0) return 'replace'
  if (incoming.eventId === existing.eventId) return 'replace'
  return 'ignore'
}

export class Graph implements IGraph {
  nodesIndex: Map<string, number> = new Map()
  nodesList: Array<Node | null> = []

  contextIndex: Map<string, number> = new Map()
  contextList: Array<string | null> = []

  edgesIndex: Map<string, number> = new Map()
  edgesList: Array<IEdge | null> = []

  eventAddedSinceLastSave = 0
  eventRemovedSinceLastSave = 0

  clear(): void {
    this.nodesIndex.clear()
    this.nodesList = []
    this.contextIndex.clear()
    this.contextList = []
    this.edgesIndex.clear()
    this.edgesList = []
    this.eventAddedSinceLastSave = 0
    this.eventRemovedSinceLastSave = 0
  }

  applyTrustEvent(trust: ITrustEvent): boolean {
    const edge = this.addEdge(trust)
    if (!edge) return false

    const authorId = trust.pubkey.toLowerCase()
    const authorNode = this.addNode(authorId, 'p')

    const pContextIndex = this.applyContext(trust.c_tag ?? '', 'p')
    const iContextIndex = this.applyContext(trust.c_tag ?? '', 'i')

    const subjects = trust.subjects
    if (subjects.length === 0) return false
    const value = edge.value
    const createdAt = edge.createdAt

    for (const subject of subjects) {
      const subjectId = subject.value.toLowerCase()
      const subjectType: SubjectType = subject.tag
      const subjectNode = this.addNode(subjectId, subjectType)

      const contextIndex =
        contextBucketType(subjectType) === 'p' ? pContextIndex : iContextIndex

      if (value !== 0) {
        authorNode.addOut(contextIndex, subjectNode.index, edge.index!)
        subjectNode.addIn(contextIndex, authorNode.index, edge.index!)
      } else {
        authorNode.removeOut(this, contextIndex, subjectNode.index, createdAt)
        subjectNode.removeIn(this, contextIndex, authorNode.index, createdAt)
      }
    }
    this.eventAddedSinceLastSave++
    return true
  }

  removeTrustEvent(trust: ITrustEvent): boolean {
    const edgeIndex = this.edgesIndex.get(trust.addressableId)
    if (edgeIndex === undefined) return false
    const edge = this.edgesList[edgeIndex]
    if (!edge) return false

    const authorId = trust.pubkey.toLowerCase()
    const authorNode = this.getNode(authorId)
    if (!authorNode) return false

    const pContextIndex = this.getContextIndex(trust.c_tag ?? '', 'p')
    const iContextIndex = this.getContextIndex(trust.c_tag ?? '', 'i')

    const subjects = trust.subjects
    if (subjects.length === 0) return false

    for (const subject of subjects) {
      const subjectId = subject.value.toLowerCase()
      const subjectNodeIndex = this.nodesIndex.get(subjectId)
      if (subjectNodeIndex === undefined) continue

      const subjectNode = this.nodesList[subjectNodeIndex]
      if (!subjectNode) continue

      const contextIndex =
        contextBucketType(subject.tag) === 'p' ? pContextIndex : iContextIndex
      if (contextIndex === undefined) continue

      authorNode.removeOut(this, contextIndex, subjectNode.index, edge.createdAt)
      subjectNode.removeIn(this, contextIndex, authorNode.index, edge.createdAt)
    }
    return true
  }

  getContextIndexes(context: string, subjectType: SubjectType): number[] {
    const bucket = contextBucketType(subjectType)
    const result: number[] = []
    const segments =
      context.length === 0 ? [bucket] : [bucket, ...context.split(':')]

    let key = ''
    for (const segment of segments) {
      key = key.length > 0 ? `${key}:${segment}` : segment
      const index = this.contextIndex.get(key)
      if (index !== undefined) result.push(index)
    }
    return result.reverse()
  }

  private edgePayload(edge: IEdge): GraphTrustEdgePayload {
    return {
      dTag: edge.addressableId,
      author: edge.author,
      kind: edge.kind,
      value: edge.value,
      context: edge.context,
      createdAt: edge.createdAt,
      eventId: edge.eventId,
      ...(edge.activate !== undefined ? { activate: edge.activate } : {}),
      ...(edge.expire !== undefined ? { expire: edge.expire } : {}),
      ...(edge.content !== undefined ? { content: edge.content } : {}),
    }
  }

  private connections(
    nodeId: string,
    direction: 'out' | 'in',
    options: GraphTrustConnectionOptions = {},
  ): GraphTrustConnectionPayload[] {
    const node = this.getNode(nodeId.toLowerCase())
    if (!node) return []

    const subjectTypes: SubjectType[] = options.subjectType
      ? [options.subjectType]
      : ['p', 'i', 'e']
    const now = options.now ?? Math.floor(Date.now() / 1000)
    const seen = new Set<string>()
    const result: GraphTrustConnectionPayload[] = []

    for (const subjectType of subjectTypes) {
      const contextIndexes = this.getContextIndexes(
        options.context ?? '',
        subjectType,
      )
      for (const contextIndex of contextIndexes) {
        const peerMap = node[direction === 'out' ? 'outbound' : 'inbound'].get(
          contextIndex,
        )
        if (!peerMap) continue

        for (const [peerIndex, edgeIndex] of peerMap.entries()) {
          const edge = this.edgesList[edgeIndex]
          if (!edge) continue
          if (!options.includeInactive && !edge.isValidAt(now)) continue
          if (options.value !== undefined && edge.value !== options.value) {
            continue
          }

          const peerNode = this.nodesList[peerIndex]
          if (!peerNode) continue

          const authorNode = direction === 'out' ? node : peerNode
          const subjectNode = direction === 'out' ? peerNode : node
          if (options.subjectType && subjectNode.type !== options.subjectType) {
            continue
          }

          const key = `${authorNode.index}:${subjectNode.index}:${edgeIndex}`
          if (seen.has(key)) continue
          seen.add(key)

          result.push({
            author: authorNode.id,
            subject: subjectNode.id,
            subjectType: subjectNode.type,
            edge: this.edgePayload(edge),
          })
        }
      }
    }

    return result
  }

  out(
    authorId: string,
    options: GraphTrustConnectionOptions = {},
  ): GraphTrustConnectionPayload[] {
    return this.connections(authorId, 'out', options)
  }

  in(
    subjectId: string,
    options: GraphTrustConnectionOptions = {},
  ): GraphTrustConnectionPayload[] {
    return this.connections(subjectId, 'in', options)
  }

  addNode(id: string, type: SubjectType): Node {
    const normalized = id.toLowerCase()
    const index = this.nodesIndex.get(normalized)
    if (index !== undefined) {
      const node = this.nodesList[index]
      if (node) return node
    }
    return this.createNode(normalized, type)
  }

  getNode(id: string): Node | null {
    const index = this.nodesIndex.get(id.toLowerCase())
    if (index === undefined) return null
    return this.nodesList[index] ?? null
  }

  createNode(id: string, type: SubjectType): Node {
    const node = new Node(id.toLowerCase(), type)
    node.index = this.nodesList.push(node) - 1
    this.nodesIndex.set(node.id, node.index)
    this.eventAddedSinceLastSave++
    return node
  }

  addEdge(trust: ITrustEvent): IEdge | null {
    const index = this.edgesIndex.get(trust.addressableId)
    if (index !== undefined) {
      const edge = this.edgesList[index]
      if (!edge) return null
      const action = shouldReplaceEdge(edge, trust)
      if (action === 'ignore') return null
      edge.update(trust)
      this.eventAddedSinceLastSave++
      return edge
    }

    const edge = this.createEdge(trust)
    const node = this.addNode(trust.pubkey, 'p')
    node.edges.add(edge.index!)
    this.eventAddedSinceLastSave++
    return edge
  }

  removeEdge(dTag: string): IEdge | null {
    const index = this.edgesIndex.get(dTag)
    if (index === undefined) return null
    const edge = this.edgesList[index]
    if (!edge) return null
    this.edgesList[index] = null
    this.edgesIndex.delete(dTag)
    const node = this.getNode(edge.author)
    if (node && edge.index !== undefined) node.edges.delete(edge.index)
    return edge
  }

  createEdge(trust: ITrustEvent): IEdge {
    const edge = new EdgeT1(trust)
    edge.index = this.edgesList.push(edge) - 1
    this.edgesIndex.set(trust.addressableId, edge.index)
    return edge
  }

  applyContext(context: string, subjectType: SubjectType): number {
    const bucket = contextBucketType(subjectType)
    const key = bucket + (context.length > 0 ? ':' : '') + context
    return this.addContext(key)
  }

  getContextIndex(
    context: string,
    subjectType: SubjectType,
  ): number | undefined {
    const bucket = contextBucketType(subjectType)
    const key = bucket + (context.length > 0 ? ':' : '') + context
    return this.contextIndex.get(key)
  }

  addContext(context: string): number {
    const existing = this.contextIndex.get(context)
    if (existing !== undefined) return existing
    const index = this.contextList.push(context) - 1
    this.contextIndex.set(context, index)
    return index
  }
}
