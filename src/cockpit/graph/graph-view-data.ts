import { trustQueryContextForSubject } from '../../shared/trust-context'
import { t } from '../../lib/i18n'
import type {
  GraphVisId,
  RatingQueryResult,
  TrustQueryResult,
  TrustSubject,
} from '../../graph'
import { EMPTY_PATH_VIEW, ratingScoreToEdgeValue, unionPathViews } from '../../graph'
import type { GraphSnapshotEdge, GraphSnapshotNode } from '../../shared/contracts'
import { unidentifiedKindForGraphNode } from './graph-display'
import {
  edgeId,
  linkEndpointId,
  type GraphVizData,
  type GraphVizLink,
  type GraphVizNode,
} from './types'

export function defaultContextForSubject(subject?: TrustSubject): string {
  if (!subject) return ''
  return trustQueryContextForSubject(subject)
}

export type GraphNodeClickIntent = 'expand' | 'collapse' | 'select'

/**
 * Canvas pointerdown focuses the node in the extension user panel.
 * Click does not expand. Double-click expands a collapsed node or
 * collapses an expanded one.
 */
export function graphNodeClickIntent(options: {
  isDouble: boolean
  expandedNow: boolean
}): GraphNodeClickIntent {
  if (!options.isDouble) return 'select'
  return options.expandedNow ? 'collapse' : 'expand'
}

export function isPostSubject(subject?: TrustSubject): boolean {
  return Boolean(subject && subject.type === 'i' && subject.value.startsWith('post:id:'))
}

function subjectsMatch(left?: TrustSubject, right?: TrustSubject): boolean {
  if (!left || !right) return false
  return (
    left.type === right.type &&
    left.value.toLowerCase() === right.value.toLowerCase()
  )
}

/**
 * Overlay post ratings onto Path evidence. Ratings stay terminal (not hops);
 * their issuer chains reuse the same 32009 positive-p walk as trust Path.
 */
export function mergeTrustAndRatingForPath(
  trust: TrustQueryResult,
  rating: RatingQueryResult | null,
  rootPubkey: string,
): TrustQueryResult {
  if (!rating || rating.claimCount === 0) return trust
  const root = rootPubkey.toLowerCase()
  const extraStatements = rating.claims.map((claim) => ({
    eventId: claim.eventId,
    author: claim.author,
    subject: { ...rating.subject },
    context: claim.context,
    requestedContext: rating.context,
    contextMatch:
      claim.context === rating.context
        ? ('exact' as const)
        : ('general' as const),
    value: ratingScoreToEdgeValue(claim.score),
    createdAt: claim.createdAt,
    distance: claim.distance,
    ...(claim.content ? { content: claim.content } : {}),
    ...(claim.labels.length > 0 ? { labels: [...claim.labels] } : {}),
  }))

  const statements = [...trust.statements]
  const seenEvents = new Set(statements.map((row) => row.eventId))
  for (const row of extraStatements) {
    if (seenEvents.has(row.eventId)) continue
    statements.push(row)
    seenEvents.add(row.eventId)
  }
  const direct =
    trust.direct ??
    extraStatements.find((row) => row.author === root)
  const trustCount =
    trust.trust + extraStatements.filter((row) => row.value === 1).length
  const distrustCount =
    trust.distrust + extraStatements.filter((row) => row.value === -1).length
  const pathView = unionPathViews([
    trust.pathView ?? EMPTY_PATH_VIEW,
    rating.pathView ?? EMPTY_PATH_VIEW,
    { nodes: [], edges: rating.ratingEdges ?? [] },
  ])
  return {
    ...trust,
    connected: trust.connected || extraStatements.length > 0,
    degree: Math.max(trust.degree, rating.degree),
    trust: trustCount,
    distrust: distrustCount,
    trustValue: trustCount - distrustCount,
    statements,
    paths: [],
    pathView,
    sourceEventIds: [...new Set([...trust.sourceEventIds, ...rating.sourceEventIds])].sort(),
    ...(direct !== undefined ? { direct } : {}),
  }
}

function isPostGraphCenter(
  center:
    | GraphVisId
    | { id: GraphVisId; kind?: string; subject?: TrustSubject },
  nodes: GraphSnapshotNode[],
): boolean {
  if (typeof center === 'object') {
    if (center.kind === 'post' || isPostSubject(center.subject)) return true
    return nodes.some((node) => node.id === center.id && node.kind === 'post')
  }
  return nodes.some((node) => node.id === center && node.kind === 'post')
}

/**
 * Graph Page product rule: expanding a user/pubkey never adds post nodes.
 * When the center itself is a post (timeline deep link / post focus), keep
 * the neighborhood as-is so trusters remain visible.
 */
export function omitPostNeighborsUnlessCenterIsPost(
  center:
    | GraphVisId
    | { id: GraphVisId; kind?: string; subject?: TrustSubject },
  nodes: GraphSnapshotNode[],
  links: GraphVizLink[],
): { nodes: GraphSnapshotNode[]; links: GraphVizLink[] } {
  if (isPostGraphCenter(center, nodes)) {
    return { nodes, links }
  }
  const drop = new Set(
    nodes.filter((node) => node.kind === 'post').map((node) => node.id),
  )
  if (drop.size === 0) {
    return { nodes, links }
  }
  return {
    nodes: nodes.filter((node) => !drop.has(node.id)),
    links: links.filter((link) => {
      const source = linkEndpointId(link.source)
      const target = linkEndpointId(link.target)
      return !drop.has(source) && !drop.has(target)
    }),
  }
}

export function mergeNeighborhood(
  current: GraphVizData,
  centerId: GraphVisId,
  nodes: GraphSnapshotNode[],
  links: GraphVizLink[],
): GraphVizData {
  const nodeMap = new Map(current.nodes.map((n) => [n.id, { ...n }]))
  for (const node of nodes) {
    const existing = nodeMap.get(node.id)
    if (existing) {
      if (node.depth < existing.depth) existing.depth = node.depth
      if (
        node.id !== centerId &&
        !existing.isRoot &&
        !existing.expandedFrom?.includes(centerId)
      ) {
        existing.expandedFrom = [
          ...(existing.expandedFrom ?? []),
          centerId,
        ]
      }
      continue
    }
    const next: GraphVizNode = {
      ...node,
      depth: node.id === centerId ? 0 : node.depth || 1,
      expandedFrom: node.id === centerId ? undefined : [centerId],
    }
    const unidentifiedKind = unidentifiedKindForGraphNode(next)
    nodeMap.set(
      node.id,
      unidentifiedKind ? { ...next, unidentifiedKind } : next,
    )
  }
  const center = nodeMap.get(centerId)
  if (center) center.expanded = true

  const linkMap = new Map(current.links.map((l) => [l.id, l]))
  for (const link of links) {
    const existing = linkMap.get(link.id)
    linkMap.set(
      link.id,
      existing
        ? {
            ...existing,
            expandedFrom: existing.expandedFrom?.includes(centerId)
              ? existing.expandedFrom
              : [...(existing.expandedFrom ?? []), centerId],
          }
        : { ...link, expandedFrom: [centerId] },
    )
  }
  return { nodes: [...nodeMap.values()], links: [...linkMap.values()] }
}

export function collapseExpansion(
  current: GraphVizData,
  centerId: GraphVisId,
  rootId: GraphVisId,
): GraphVizData {
  const collapsedCenters = new Set<GraphVisId>([centerId])
  const remove = new Set<GraphVisId>()
  let changed = true
  while (changed) {
    changed = false
    for (const node of current.nodes) {
      if (node.id === rootId || node.id === centerId || remove.has(node.id)) {
        continue
      }
      const owners = node.expandedFrom ?? []
      if (
        owners.length === 0 ||
        !owners.some((owner) => collapsedCenters.has(owner)) ||
        !owners.every((owner) => collapsedCenters.has(owner))
      ) {
        continue
      }
      remove.add(node.id)
      if (node.expanded) collapsedCenters.add(node.id)
      changed = true
    }
  }
  // Always drop aggregate nodes owned by collapsed centers.
  for (const node of current.nodes) {
    if (
      node.kind === 'aggregate' &&
      node.aggregateParentId &&
      collapsedCenters.has(node.aggregateParentId)
    ) {
      remove.add(node.id)
    }
  }
  const nodes = current.nodes
    .filter((n) => !remove.has(n.id))
    .map((node) => ({
      ...node,
      ...(node.id === centerId ? { expanded: false } : {}),
      ...(node.expandedFrom
        ? {
            expandedFrom: node.expandedFrom.filter(
              (owner) => !collapsedCenters.has(owner),
            ),
          }
        : {}),
    }))
  const keep = new Set(nodes.map((n) => n.id))
  const links = current.links
    .map((link) => ({
      ...link,
      expandedFrom: link.expandedFrom?.filter(
        (owner) => !collapsedCenters.has(owner),
      ),
    }))
    .filter((link) => {
      const source = linkEndpointId(link.source)
      const target = linkEndpointId(link.target)
      if (!keep.has(source) || !keep.has(target)) return false
      return !link.expandedFrom || link.expandedFrom.length > 0
    })
  return { nodes, links }
}

export function neighborhoodToGraph(
  neighborhood: {
    centerId: GraphVisId
    nodes: GraphSnapshotNode[]
    edges: GraphSnapshotEdge[]
  },
  rootPubkey?: string,
): GraphVizData {
  const root = rootPubkey?.toLowerCase()
  const nodes: GraphVizNode[] = neighborhood.nodes.map((node) => {
    const isRoot =
      Boolean(root) &&
      node.subject?.type === 'p' &&
      node.subject.value.toLowerCase() === root
    const isFocus = node.id === neighborhood.centerId
    const unidentifiedKind = unidentifiedKindForGraphNode({
      kind: node.kind,
      isRoot,
    })
    return {
      ...node,
      expanded: isFocus,
      ...(isRoot ? { isRoot: true, label: t('graph.you') } : {}),
      ...(isFocus ? { isFocus: true } : {}),
      ...(unidentifiedKind ? { unidentifiedKind } : {}),
    }
  })
  const links: GraphVizLink[] = neighborhood.edges.map((edge) => ({
    id: edgeId(edge),
    source: edge.from,
    target: edge.to,
    value: edge.value,
    context: edge.context,
    eventId: edge.eventId,
    depth: edge.depth,
    expandedFrom: [neighborhood.centerId],
  }))
  return { nodes, links }
}

/** Pass through worker Path vis (heap index ids + subject). */
export function pathsToGraph(
  result: TrustQueryResult,
  rootPubkey: string,
): GraphVizData {
  const root = rootPubkey.toLowerCase()
  const nodes: GraphVizNode[] = (result.pathView?.nodes ?? []).map((node) => {
    const isRoot =
      node.subject?.type === 'p' && node.subject.value.toLowerCase() === root
    const isFocus = subjectsMatch(node.subject, result.subject)
    const unidentifiedKind = unidentifiedKindForGraphNode({
      kind: node.kind,
      isRoot,
    })
    return {
      ...node,
      ...(isRoot ? { isRoot: true, label: t('graph.you') } : {}),
      ...(isFocus ? { isFocus: true } : {}),
      ...(unidentifiedKind ? { unidentifiedKind } : {}),
    }
  })
  const links: GraphVizLink[] = (result.pathView?.edges ?? []).map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    value: edge.value,
    context: edge.context,
    eventId: edge.eventId,
    depth: edge.depth,
  }))
  return { nodes, links }
}
