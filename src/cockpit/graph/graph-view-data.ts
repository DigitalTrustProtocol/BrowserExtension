import { t } from '../../lib/i18n'
import type {
  RatingQueryResult,
  TrustQueryResult,
  TrustSubject,
} from '../../graph'
import { ratingScoreToEdgeValue } from '../../graph'
import { parseNodeId, subjectNodeId } from '../../shared/graph-deeplink'
import type { GraphSnapshotNode } from '../../shared/contracts'
import type { GraphVizData, GraphVizLink, GraphVizNode } from './types'

export function defaultContextForSubject(_subject?: TrustSubject): string {
  return ''
}

/** True when the graph node id is an X post subject (`i:post:id:…`). */
export function isPostNodeId(nodeId: string): boolean {
  return nodeId.startsWith('i:post:id:')
}

export function isPostSubject(subject: TrustSubject): boolean {
  return subject.type === 'i' && subject.value.startsWith('post:id:')
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
  const extraPaths =
    rating.paths.length > 0
      ? rating.paths
      : extraStatements.map((statement) => ({
          authors:
            statement.author === root
              ? [root]
              : [root, statement.author],
          subject: { ...rating.subject },
          sourceEventIds: [statement.eventId],
        }))

  const statements = [...trust.statements]
  const seenEvents = new Set(statements.map((row) => row.eventId))
  for (const row of extraStatements) {
    if (seenEvents.has(row.eventId)) continue
    statements.push(row)
    seenEvents.add(row.eventId)
  }
  const paths = [...trust.paths]
  const seenPaths = new Set(
    paths.map((path) => `${path.authors.join('>')}|${path.sourceEventIds.join(',')}`),
  )
  for (const path of extraPaths) {
    const key = `${path.authors.join('>')}|${path.sourceEventIds.join(',')}`
    if (seenPaths.has(key)) continue
    paths.push(path)
    seenPaths.add(key)
  }
  const direct =
    trust.direct ??
    extraStatements.find((row) => row.author === root)
  const trustCount =
    trust.trust + extraStatements.filter((row) => row.value === 1).length
  const distrustCount =
    trust.distrust + extraStatements.filter((row) => row.value === -1).length
  return {
    ...trust,
    connected: trust.connected || extraStatements.length > 0,
    degree: Math.max(trust.degree, rating.degree),
    trust: trustCount,
    distrust: distrustCount,
    trustValue: trustCount - distrustCount,
    statements,
    paths,
    sourceEventIds: [...new Set([...trust.sourceEventIds, ...rating.sourceEventIds])].sort(),
    ...(direct !== undefined ? { direct } : {}),
  }
}

/**
 * Graph Page product rule: expanding a user/pubkey never adds post nodes.
 * When the center itself is a post (timeline deep link / post focus), keep
 * the neighborhood as-is so trusters remain visible.
 */
export function omitPostNeighborsUnlessCenterIsPost(
  centerId: string,
  nodes: GraphSnapshotNode[],
  links: GraphVizLink[],
): { nodes: GraphSnapshotNode[]; links: GraphVizLink[] } {
  if (isPostNodeId(centerId)) {
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
      const source =
        typeof link.source === 'string' ? link.source : link.source.id
      const target =
        typeof link.target === 'string' ? link.target : link.target.id
      return !drop.has(source) && !drop.has(target)
    }),
  }
}

export function mergeNeighborhood(
  current: GraphVizData,
  centerId: string,
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
    nodeMap.set(node.id, {
      ...node,
      depth: node.id === centerId ? 0 : node.depth || 1,
      expandedFrom: node.id === centerId ? undefined : [centerId],
    })
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
  centerId: string,
  rootId: string,
): GraphVizData {
  const collapsedCenters = new Set<string>([centerId])
  const remove = new Set<string>()
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
      const source =
        typeof link.source === 'string' ? link.source : link.source.id
      const target =
        typeof link.target === 'string' ? link.target : link.target.id
      if (!keep.has(source) || !keep.has(target)) return false
      return !link.expandedFrom || link.expandedFrom.length > 0
    })
  return { nodes, links }
}

export function pathsToGraph(
  result: TrustQueryResult,
  rootPubkey: string,
): GraphVizData {
  const rootId = `p:${rootPubkey}`
  const nodes = new Map<string, GraphVizNode>()
  const links = new Map<string, GraphVizLink>()

  nodes.set(rootId, {
    id: rootId,
    kind: 'pubkey',
    depth: 0,
    label: t('graph.you'),
    isRoot: true,
  })

  const subjectId = subjectNodeId(result.subject)
  const subjectLabel =
    result.subject.type === 'i' &&
    result.subject.value.startsWith('user:id:')
      ? `X · ${result.subject.value.slice('user:id:'.length)}`
      : result.subject.type === 'i' &&
          result.subject.value.startsWith('post:id:')
        ? `${t('graph.post')} · ${result.subject.value.slice('post:id:'.length)}`
        : result.subject.value.slice(0, 14) + '…'

  for (const path of result.paths) {
    let prev = rootId
    path.authors.forEach((author, index) => {
      const id = `p:${author}`
      const existing = nodes.get(id)
      if (!existing) {
        nodes.set(id, {
          id,
          kind: 'pubkey',
          depth: index,
          label:
            author === rootPubkey
              ? t('graph.you')
              : author.slice(0, 12) + '…',
          isRoot: author === rootPubkey,
        })
      } else if (index < existing.depth) {
        existing.depth = index
      }
      if (id !== prev) {
        const lid = `path:${prev}:${id}`
        if (!links.has(lid)) {
          links.set(lid, {
            id: lid,
            source: prev,
            target: id,
            value: 1,
            context: result.context,
            eventId: path.sourceEventIds[Math.max(0, index - 1)] ?? lid,
            depth: index,
          })
        }
        prev = id
      }
    })
    const authorId =
      path.authors.length > 0
        ? `p:${path.authors[path.authors.length - 1]}`
        : rootId
    if (!nodes.has(subjectId)) {
      nodes.set(subjectId, {
        id: subjectId,
        kind: subjectId.startsWith('i:post:id:')
          ? 'post'
          : subjectId.startsWith('i:user:id:')
            ? 'twitter_id'
            : 'other',
        depth: path.authors.length,
        label: subjectLabel,
        isFocus: true,
      })
    }
    const stmt = result.statements.find(
      (s) =>
        subjectNodeId(s.subject) === subjectId &&
        `p:${s.author}` === authorId,
    )
    const lid = `ev:${authorId}:${subjectId}:${stmt?.eventId ?? 'x'}`
    if (!links.has(lid)) {
      links.set(lid, {
        id: lid,
        source: authorId,
        target: subjectId,
        value: stmt?.value === -1 ? -1 : 1,
        context: result.context,
        eventId: stmt?.eventId ?? lid,
        depth: path.authors.length,
      })
    }
  }

  if (result.paths.length === 0 && result.direct) {
    nodes.set(subjectId, {
      id: subjectId,
      kind: subjectId.startsWith('i:post:id:')
        ? 'post'
        : subjectId.startsWith('i:user:id:')
          ? 'twitter_id'
          : 'other',
      depth: 1,
      label: subjectLabel,
      isFocus: true,
    })
    links.set(`direct:${subjectId}`, {
      id: `direct:${subjectId}`,
      source: rootId,
      target: subjectId,
      value: result.direct.value === -1 ? -1 : 1,
      context: result.context,
      eventId: result.direct.eventId,
      depth: 1,
    })
  }

  if (!nodes.has(subjectId)) {
    nodes.set(subjectId, {
      id: subjectId,
      kind: subjectId.startsWith('i:post:id:')
        ? 'post'
        : subjectId.startsWith('i:user:id:')
          ? 'twitter_id'
          : result.subject.type === 'p'
            ? 'pubkey'
            : 'other',
      depth: 1,
      label: subjectLabel,
      isFocus: true,
      resolution: result.resolution,
    })
  }

  return { nodes: [...nodes.values()], links: [...links.values()] }
}

export function buildSeedGraphData(
  rootPubkey: string,
  focusId: string | undefined,
): GraphVizData {
  const rootId = `p:${rootPubkey}`
  const seedFocus = focusId ?? rootId

  if (seedFocus === rootId) {
    return {
      nodes: [
        {
          id: rootId,
          kind: 'pubkey',
          depth: 0,
          label: t('graph.you'),
          isRoot: true,
        },
      ],
      links: [],
    }
  }

  const focusSubject = parseNodeId(seedFocus)
  return {
    nodes: [
      {
        id: seedFocus,
        kind: seedFocus.startsWith('i:post:id:')
          ? 'post'
          : seedFocus.startsWith('i:user:id:')
            ? 'twitter_id'
            : focusSubject?.type === 'p'
              ? 'pubkey'
              : 'other',
        depth: 0,
        label:
          focusSubject?.type === 'i' &&
          focusSubject.value.startsWith('user:id:')
            ? `X · ${focusSubject.value.slice('user:id:'.length)}`
            : focusSubject?.type === 'i' &&
                focusSubject.value.startsWith('post:id:')
              ? `${t('graph.post')} · ${focusSubject.value.slice('post:id:'.length)}`
              : focusSubject
                ? `${focusSubject.value.slice(0, 12)}…`
                : seedFocus,
        isFocus: true,
      },
    ],
    links: [],
  }
}
