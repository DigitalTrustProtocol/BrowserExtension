import type { XIdentityDisplay } from '../../shared/contracts'
import { buildXProfileIconUrl } from '../../shared/x-profile-display'

export function twitterIdFromNodeId(nodeId: string): string | undefined {
  const prefix = 'i:user:id:'
  if (!nodeId.startsWith(prefix)) return undefined
  const twitterId = nodeId.slice(prefix.length)
  return /^\d{1,24}$/.test(twitterId) ? twitterId : undefined
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
  return {
    ...node,
    ...(labels.label ? { label: labels.label } : {}),
    ...(labels.subtitle ? { subtitle: labels.subtitle } : {}),
    ...(picture ? { picture } : {}),
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

/** Root "You" needs signed-in X chrome when handle/avatar are still missing. */
export function rootNeedsSignedInXProfile(node: {
  isRoot?: boolean
  subtitle?: string
  picture?: string
}): boolean {
  if (!node.isRoot) return false
  return !node.subtitle?.startsWith('@') || !node.picture
}
