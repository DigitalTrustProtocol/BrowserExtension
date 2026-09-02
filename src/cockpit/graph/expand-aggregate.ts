import type { GraphSnapshotNode } from '../../shared/contracts'
import { parseHeapIndexId, type GraphVisId } from '../../graph'
import { linkEndpointId, type GraphVizLink, type GraphVizNode } from './types'

export const EXPAND_VISIBLE_INITIAL = 20
export const EXPAND_LOAD_MORE_BATCH = 100

export interface PendingNeighborhood {
  nodes: GraphSnapshotNode[]
  links: GraphVizLink[]
}

export function aggregateNodeId(parentId: GraphVisId): string {
  return `agg:${parentId}`
}

export function isAggregateNodeId(id: GraphVisId): id is string {
  return typeof id === 'string' && id.startsWith('agg:')
}

export function parentIdFromAggregate(id: GraphVisId): GraphVisId | undefined {
  if (!isAggregateNodeId(id)) return undefined
  const rest = id.slice('agg:'.length)
  return parseHeapIndexId(rest) ?? rest
}

export function aggregateLabel(remaining: number): string {
  return `+${remaining}`
}

/** Split neighbors into an initial visible batch and a pending queue. */
export function partitionNeighborhoodReveal(
  neighborNodes: GraphSnapshotNode[],
  neighborLinks: GraphVizLink[],
  initialCount: number = EXPAND_VISIBLE_INITIAL,
): { reveal: PendingNeighborhood; pending: PendingNeighborhood } {
  const visibleIds = new Set(
    neighborNodes.slice(0, Math.max(0, initialCount)).map((n) => n.id),
  )
  const revealNodes = neighborNodes.filter((n) => visibleIds.has(n.id))
  const pendingNodes = neighborNodes.filter((n) => !visibleIds.has(n.id))
  const pendingIds = new Set(pendingNodes.map((n) => n.id))

  const revealLinks: GraphVizLink[] = []
  const pendingLinks: GraphVizLink[] = []
  for (const link of neighborLinks) {
    const source = linkEndpointId(link.source)
    const target = linkEndpointId(link.target)
    const touchesPending =
      pendingIds.has(source) || pendingIds.has(target)
    if (touchesPending) pendingLinks.push(link)
    else revealLinks.push(link)
  }

  return {
    reveal: { nodes: revealNodes, links: revealLinks },
    pending: { nodes: pendingNodes, links: pendingLinks },
  }
}

/** Take the next batch from a pending neighborhood queue. */
export function takePendingBatch(
  pending: PendingNeighborhood,
  batchSize: number = EXPAND_LOAD_MORE_BATCH,
): { reveal: PendingNeighborhood; remaining: PendingNeighborhood } {
  const take = Math.max(0, batchSize)
  const revealNodes = pending.nodes.slice(0, take)
  const remainingNodes = pending.nodes.slice(take)
  const revealIds = new Set(revealNodes.map((n) => n.id))

  const revealLinks: GraphVizLink[] = []
  const remainingLinks: GraphVizLink[] = []
  for (const link of pending.links) {
    const source = linkEndpointId(link.source)
    const target = linkEndpointId(link.target)
    if (revealIds.has(source) || revealIds.has(target)) {
      revealLinks.push(link)
    } else {
      remainingLinks.push(link)
    }
  }

  return {
    reveal: { nodes: revealNodes, links: revealLinks },
    remaining: { nodes: remainingNodes, links: remainingLinks },
  }
}

export function makeAggregateNode(
  parentId: GraphVisId,
  remaining: number,
  depth: number,
): GraphVizNode {
  return {
    id: aggregateNodeId(parentId),
    kind: 'aggregate',
    depth,
    label: aggregateLabel(remaining),
    expandedFrom: [parentId],
    aggregateParentId: parentId,
    aggregateRemaining: remaining,
  }
}

export function makeAggregateLink(
  parentId: GraphVisId,
  depth: number,
): GraphVizLink {
  const aggId = aggregateNodeId(parentId)
  return {
    id: `agg-link:${parentId}`,
    source: parentId,
    target: aggId,
    value: 1,
    context: '',
    eventId: `agg:${parentId}`,
    depth,
    expandedFrom: [parentId],
  }
}

export function upsertAggregateInData(
  data: {
    nodes: GraphVizNode[]
    links: GraphVizLink[]
  },
  parentId: GraphVisId,
  remaining: number,
  depth: number,
): { nodes: GraphVizNode[]; links: GraphVizLink[] } {
  const aggId = aggregateNodeId(parentId)
  const nodes = data.nodes.filter((n) => n.id !== aggId)
  const links = data.links.filter((l) => {
    const source = linkEndpointId(l.source)
    const target = linkEndpointId(l.target)
    return source !== aggId && target !== aggId
  })
  if (remaining <= 0) {
    return { nodes, links }
  }
  return {
    nodes: [...nodes, makeAggregateNode(parentId, remaining, depth)],
    links: [...links, makeAggregateLink(parentId, depth)],
  }
}
