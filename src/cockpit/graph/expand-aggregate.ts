import type { GraphSnapshotNode } from '../../shared/contracts'
import type { GraphVizLink, GraphVizNode } from './types'

export const EXPAND_VISIBLE_INITIAL = 20
export const EXPAND_LOAD_MORE_BATCH = 100

export interface PendingNeighborhood {
  nodes: GraphSnapshotNode[]
  links: GraphVizLink[]
}

export function aggregateNodeId(parentId: string): string {
  return `agg:${parentId}`
}

export function isAggregateNodeId(id: string): boolean {
  return id.startsWith('agg:')
}

export function parentIdFromAggregate(id: string): string | undefined {
  if (!isAggregateNodeId(id)) return undefined
  return id.slice('agg:'.length)
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
    const source =
      typeof link.source === 'string' ? link.source : link.source.id
    const target =
      typeof link.target === 'string' ? link.target : link.target.id
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
    const source =
      typeof link.source === 'string' ? link.source : link.source.id
    const target =
      typeof link.target === 'string' ? link.target : link.target.id
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
  parentId: string,
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
  parentId: string,
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
  parentId: string,
  remaining: number,
  depth: number,
): { nodes: GraphVizNode[]; links: GraphVizLink[] } {
  const aggId = aggregateNodeId(parentId)
  const nodes = data.nodes.filter((n) => n.id !== aggId)
  const links = data.links.filter((l) => {
    const source = typeof l.source === 'string' ? l.source : l.source.id
    const target = typeof l.target === 'string' ? l.target : l.target.id
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
