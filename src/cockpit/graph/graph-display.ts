import type { XIdentityDisplay, XPostDisplay } from '../../shared/contracts'
import { parseNodeId } from '../../shared/graph-deeplink'
import { buildXProfileIconUrl } from '../../shared/x-profile-display'

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
>(node: T, display: XIdentityDisplay): T {
  const labels = labelsFromXIdentityDisplay(display)
  const picture = pictureFromXIdentityDisplay(display)
  const next = {
    ...node,
    ...(labels.label ? { label: labels.label } : {}),
    ...(labels.subtitle ? { subtitle: labels.subtitle } : {}),
    ...(picture ? { picture } : {}),
  }
  if (labels.label && 'unidentifiedKind' in next) {
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
    return applyXDisplayToGraphNode(node, caches.rootXDisplay)
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
