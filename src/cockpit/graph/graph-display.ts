import type { XIdentityDisplay, XPostDisplay } from '../../shared/contracts'
import { parseNodeId } from '../../shared/graph-deeplink'
import { buildXProfileIconUrl } from '../../shared/x-profile-display'
import type { GraphVizData, GraphVizLink, GraphVizNode } from './types'

export function twitterIdFromNodeId(nodeId: string): string | undefined {
  const prefix = 'i:user:id:'
  if (!nodeId.startsWith(prefix)) return undefined
  const twitterId = nodeId.slice(prefix.length)
  return /^\d{1,24}$/.test(twitterId) ? twitterId : undefined
}

export function postIdFromNodeId(nodeId: string): string | undefined {
  const prefix = 'i:post:id:'
  if (!nodeId.startsWith(prefix)) return undefined
  const postId = nodeId.slice(prefix.length)
  return /^\d{1,24}$/.test(postId) ? postId : undefined
}

export function labelFromXIdentityDisplay(
  display: XIdentityDisplay,
): string | undefined {
  const labels = labelsFromXIdentityDisplay(display)
  return labels.label
}

export function labelsFromXIdentityDisplay(
  display: XIdentityDisplay,
): { label?: string; subtitle?: string } {
  const handle = display.handle ? `@${display.handle}` : undefined
  if (display.displayName?.trim()) {
    return {
      label: display.displayName.trim(),
      ...(handle ? { subtitle: handle } : {}),
    }
  }
  if (handle) return { label: handle }
  return {}
}

export function pictureFromXIdentityDisplay(
  display: XIdentityDisplay,
): string | undefined {
  return display.iconPath ? buildXProfileIconUrl(display.iconPath) : undefined
}

/** Apply xIdentities display chrome onto a graph node (label / @handle / avatar). */
export function applyXDisplayToGraphNode<
  T extends {
    label: string
    subtitle?: string
    picture?: string
  },
>(
  node: T,
  display: XIdentityDisplay,
  options?: { keepLabel?: boolean },
): T {
  const labels = labelsFromXIdentityDisplay(display)
  const picture = pictureFromXIdentityDisplay(display)
  const next = {
    ...node,
    ...(labels.label && !options?.keepLabel ? { label: labels.label } : {}),
    ...(labels.subtitle ? { subtitle: labels.subtitle } : {}),
    ...(picture ? { picture } : {}),
  }
  if ((labels.label || labels.subtitle) && 'unidentifiedKind' in next) {
    delete (next as { unidentifiedKind?: unknown }).unidentifiedKind
  }
  return next
}

export function unidentifiedKindForGraphNode(node: {
  kind: string
  isRoot?: boolean
}): 'x-id' | 'external' | undefined {
  if (node.isRoot) return undefined
  if (node.kind === 'twitter_id') return 'x-id'
  if (node.kind === 'pubkey') return 'external'
  return undefined
}

export function labelsFromXPostDisplay(
  display: XPostDisplay,
): { label?: string; subtitle?: string } {
  const handle = display.authorHandle
    ? `@${display.authorHandle.replace(/^@/, '')}`
    : undefined
  const headline = display.headline?.trim()
  if (headline) {
    return {
      label: headline,
      ...(handle ? { subtitle: handle } : {}),
    }
  }
  if (handle) return { subtitle: handle }
  return {}
}

/** Apply xPosts chrome onto a post graph node (headline / @author). */
export function applyXPostDisplayToGraphNode<
  T extends {
    label: string
    subtitle?: string
  },
>(node: T, display: XPostDisplay): T {
  const labels = labelsFromXPostDisplay(display)
  return {
    ...node,
    ...(labels.label ? { label: labels.label } : {}),
    ...(labels.subtitle ? { subtitle: labels.subtitle } : {}),
  }
}

export function nodeNeedsXProfileEnrichment(
  node: { id: string; kind: string; label: string },
): string | undefined {
  if (node.kind !== 'twitter_id') return undefined
  const twitterId = twitterIdFromNodeId(node.id)
  if (!twitterId) return undefined
  if (!node.label.startsWith('X · ')) return undefined
  return twitterId
}

/** Post still using the default `Post · {id}` / localized label, or missing author. */
export function nodeNeedsXPostEnrichment(node: {
  id: string
  kind: string
  label: string
  subtitle?: string
}): string | undefined {
  if (node.kind !== 'post') return undefined
  const postId = postIdFromNodeId(node.id)
  if (!postId) return undefined
  const hasDefaultLabel =
    node.label.startsWith('Post · ') || /^[^\s]+ · \d+$/.test(node.label)
  if (!hasDefaultLabel && node.subtitle?.startsWith('@')) return undefined
  return postId
}

/** Root "You" needs signed-in X chrome when handle/avatar are still missing. */
export function rootNeedsSignedInXProfile(node: {
  isRoot?: boolean
  subtitle?: string
  picture?: string
}): boolean {
  if (!node.isRoot) return false
  return !node.subtitle?.startsWith('@') || !node.picture
}

export interface GraphPubkeyProfileChrome {
  name?: string
  picture?: string
}

/** In-memory graph chrome so expand/collapse can reapply avatars without RPC. */
export interface GraphChromeCaches {
  xByTwitterId: ReadonlyMap<string, XIdentityDisplay>
  xByPubkey: ReadonlyMap<string, XIdentityDisplay>
  profileByPubkey: ReadonlyMap<string, GraphPubkeyProfileChrome>
  postById: ReadonlyMap<string, XPostDisplay>
  rootXDisplay?: XIdentityDisplay
}

type GraphChromeNode = {
  id: string
  kind: string
  label: string
  isRoot?: boolean
  subtitle?: string
  picture?: string
  unidentifiedKind?: 'x-id' | 'external'
}

export function graphNodeChromeChanged(
  prev: GraphChromeNode,
  next: GraphChromeNode,
): boolean {
  return (
    next.label !== prev.label ||
    next.subtitle !== prev.subtitle ||
    next.picture !== prev.picture ||
    next.unidentifiedKind !== prev.unidentifiedKind
  )
}

export function hydrateGraphNodeChrome<T extends GraphChromeNode>(
  node: T,
  caches: GraphChromeCaches,
): T {
  if (node.isRoot && caches.rootXDisplay) {
    return applyXDisplayToGraphNode(node, caches.rootXDisplay, {
      keepLabel: true,
    })
  }
  const twitterId = twitterIdFromNodeId(node.id)
  if (twitterId) {
    const display = caches.xByTwitterId.get(twitterId)
    if (display) return applyXDisplayToGraphNode(node, display)
  }
  const postId = postIdFromNodeId(node.id)
  if (postId && node.kind === 'post') {
    const display = caches.postById.get(postId)
    if (display) return applyXPostDisplayToGraphNode(node, display)
  }
  const subject = parseNodeId(node.id)
  if (subject?.type !== 'p' || node.isRoot) return node
  const xDisplay = caches.xByPubkey.get(subject.value)
  if (xDisplay) return applyXDisplayToGraphNode(node, xDisplay)
  const profile = caches.profileByPubkey.get(subject.value)
  if (!profile || node.subtitle?.startsWith('@')) return node
  return {
    ...node,
    ...(profile.name ? { label: profile.name } : {}),
    ...(profile.picture ? { picture: profile.picture } : {}),
    ...(!node.subtitle
      ? { subtitle: `${subject.value.slice(0, 8)}…` }
      : {}),
    unidentifiedKind: 'external' as const,
  }
}

export function hydrateGraphDataChrome<
  T extends { nodes: U[] },
  U extends GraphChromeNode,
>(data: T, caches: GraphChromeCaches): T {
  let changed = false
  const nodes = data.nodes.map((node) => {
    const next = hydrateGraphNodeChrome(node, caches)
    if (graphNodeChromeChanged(node, next)) {
      changed = true
      return next
    }
    return node
  })
  return changed ? { ...data, nodes } : data
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => id.length > 0))]
}

function linkEndpointId(ref: string | { id: string }): string {
  return typeof ref === 'string' ? ref : ref.id
}

function twitterIdFromDisplay(
  display: XIdentityDisplay | undefined,
): string | undefined {
  const twitterId = display?.twitterId
  return twitterId && /^\d{1,24}$/.test(twitterId) ? twitterId : undefined
}

function rewriteGraphNodeIds(
  node: GraphVizNode,
  rewrite: (id: string) => string,
  originalId: string,
): GraphVizNode {
  const id = rewrite(node.id)
  const remapped = id !== originalId
  const collapsedFromIds = uniqueIds([
    ...(node.collapsedFromIds ?? []),
    ...(remapped ? [originalId] : []),
  ])
  const expandedFrom = node.expandedFrom
    ? uniqueIds(node.expandedFrom.map(rewrite))
    : undefined
  const aggregateParentId = node.aggregateParentId
    ? rewrite(node.aggregateParentId)
    : undefined
  return {
    ...node,
    id,
    ...(remapped ? { kind: 'twitter_id' as const } : {}),
    ...(remapped && node.unidentifiedKind === 'external'
      ? { unidentifiedKind: 'x-id' as const }
      : {}),
    ...(collapsedFromIds.length > 0 ? { collapsedFromIds } : {}),
    ...(expandedFrom && expandedFrom.length > 0 ? { expandedFrom } : {}),
    ...(aggregateParentId ? { aggregateParentId } : {}),
  }
}

function isStubGraphLabel(label: string): boolean {
  return (
    label === 'Unknown' ||
    label.startsWith('X · ') ||
    label.startsWith('Post · ')
  )
}

function mergeAliasedGraphNodes(
  existing: GraphVizNode,
  incoming: GraphVizNode,
): GraphVizNode {
  const preferUser =
    existing.kind === 'twitter_id'
      ? existing
      : incoming.kind === 'twitter_id'
        ? incoming
        : existing
  const other = preferUser === existing ? incoming : existing
  const expandedFrom = uniqueIds([
    ...(preferUser.expandedFrom ?? []),
    ...(other.expandedFrom ?? []),
  ])
  const collapsedFromIds = uniqueIds([
    ...(preferUser.collapsedFromIds ?? []),
    ...(other.collapsedFromIds ?? []),
  ])
  const label =
    isStubGraphLabel(preferUser.label) && !isStubGraphLabel(other.label)
      ? other.label
      : preferUser.label
  const merged: GraphVizNode = {
    ...preferUser,
    id: preferUser.id,
    kind: 'twitter_id',
    label,
    depth: Math.min(preferUser.depth, other.depth),
    ...(preferUser.isFocus || other.isFocus ? { isFocus: true } : {}),
    ...(preferUser.expanded || other.expanded ? { expanded: true } : {}),
    ...(preferUser.picture || other.picture
      ? { picture: preferUser.picture ?? other.picture }
      : {}),
    ...(preferUser.subtitle || other.subtitle
      ? { subtitle: preferUser.subtitle ?? other.subtitle }
      : {}),
    ...(preferUser.resolution || other.resolution
      ? { resolution: preferUser.resolution ?? other.resolution }
      : {}),
    ...(expandedFrom.length > 0 ? { expandedFrom } : {}),
    ...(collapsedFromIds.length > 0 ? { collapsedFromIds } : {}),
  }
  if (merged.subtitle || !isStubGraphLabel(merged.label)) {
    delete merged.unidentifiedKind
  }
  return merged
}

/**
 * Draw bound non-root `p:` hops as `i:user:id:` when xIdentities has a twitterId.
 * Unbound hops stay `p:`. Root stays `p:<vault>`.
 */
export function collapseBoundPubkeyAliases(
  data: GraphVizData,
  caches: GraphChromeCaches,
): GraphVizData {
  const remap = new Map<string, string>()
  for (const node of data.nodes) {
    if (node.isRoot) continue
    const subject = parseNodeId(node.id)
    if (subject?.type !== 'p') continue
    const twitterId = twitterIdFromDisplay(caches.xByPubkey.get(subject.value))
    if (!twitterId) continue
    const target = `i:user:id:${twitterId}`
    if (target === node.id) continue
    remap.set(node.id, target)
  }
  if (remap.size === 0) return data

  const rewrite = (id: string): string => remap.get(id) ?? id
  const byId = new Map<string, GraphVizNode>()
  for (const node of data.nodes) {
    const next = rewriteGraphNodeIds(node, rewrite, node.id)
    const existing = byId.get(next.id)
    if (!existing) {
      byId.set(next.id, next)
      continue
    }
    byId.set(next.id, mergeAliasedGraphNodes(existing, next))
  }

  const links: GraphVizLink[] = []
  const seen = new Set<string>()
  for (const link of data.links) {
    const source = rewrite(linkEndpointId(link.source))
    const target = rewrite(linkEndpointId(link.target))
    if (source === target) continue
    const expandedFrom = link.expandedFrom
      ? uniqueIds(link.expandedFrom.map(rewrite))
      : undefined
    const next: GraphVizLink = {
      ...link,
      source,
      target,
      ...(expandedFrom && expandedFrom.length > 0 ? { expandedFrom } : {}),
    }
    const key = `${next.id}:${source}:${target}`
    if (seen.has(key)) continue
    seen.add(key)
    links.push(next)
  }

  return { nodes: [...byId.values()], links }
}

/** Look up a batch result by current node id or a collapsed `p:` alias. */
export function lookupByGraphNodeId<T>(
  node: { id: string; collapsedFromIds?: readonly string[] },
  byId: Readonly<Record<string, T>>,
): T | undefined {
  const direct = byId[node.id]
  if (direct) return direct
  for (const id of node.collapsedFromIds ?? []) {
    const aliased = byId[id]
    if (aliased) return aliased
  }
  return undefined
}
