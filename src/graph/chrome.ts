/**
 * Display chrome attached on the Graph instance (not RuntimeContext / Backend).
 */

import { xIdentityDisplayFromRow } from '../identity/x-identity-display'
import type { XIdentityDisplay, XPostDisplay } from '../shared/contracts'
import { parseCanonicalTwitterSubject } from '../shared/x-identity'
import type { XIdentityRecord, XPostRecord } from '../storage/types'
import type { Graph } from './trust/Graph'
import type { GraphPathViewNode } from './types'

const IDENTITIES = Symbol.for('attentionx.graph.xIdentities')
const POSTS = Symbol.for('attentionx.graph.xPosts')

type GraphChromeHost = Graph & {
  xIdentities: Map<string, XIdentityDisplay>
  xPosts: Map<string, XPostDisplay>
  [IDENTITIES]?: Map<string, XIdentityDisplay>
  [POSTS]?: Map<string, XPostDisplay>
}

function host(graph: Graph): GraphChromeHost {
  return graph as GraphChromeHost
}

export function attachGraphChrome(graph: Graph): void {
  const g = host(graph)
  if (!g[IDENTITIES]) {
    const identities = new Map<string, XIdentityDisplay>()
    const posts = new Map<string, XPostDisplay>()
    g[IDENTITIES] = identities
    g[POSTS] = posts
    g.xIdentities = identities
    g.xPosts = posts
  }
}

export function resetGraphChrome(graph: Graph): void {
  attachGraphChrome(graph)
  host(graph).xIdentities.clear()
  host(graph).xPosts.clear()
}

export function graphIdentities(
  graph: Graph,
): Map<string, XIdentityDisplay> {
  attachGraphChrome(graph)
  return host(graph).xIdentities
}

export function graphPosts(graph: Graph): Map<string, XPostDisplay> {
  attachGraphChrome(graph)
  return host(graph).xPosts
}

export function xPostDisplayFromRow(row: XPostRecord): XPostDisplay {
  return {
    ...(row.headline ? { headline: row.headline } : {}),
    ...(row.authorHandle ? { authorHandle: row.authorHandle } : {}),
    ...(row.authorTwitterId ? { authorTwitterId: row.authorTwitterId } : {}),
    ...(row.role ? { role: row.role } : {}),
    ...(row.prunedAt !== undefined ? { prunedAt: row.prunedAt } : {}),
  }
}

export function putIdentityChrome(graph: Graph, row: XIdentityRecord): void {
  graphIdentities(graph).set(row.twitterId, xIdentityDisplayFromRow(row))
}

export function putPostChrome(graph: Graph, row: XPostRecord): void {
  graphPosts(graph).set(row.postId, xPostDisplayFromRow(row))
}

export function twitterIdFromISubject(iSubject: string): string | undefined {
  const parsed = parseCanonicalTwitterSubject(iSubject)
  return parsed?.type === 'account' ? parsed.twitterId : undefined
}

export function twitterIdsForPubkey(graph: Graph, hex: string): string[] {
  const aliases = graph.pToI.get(hex.toLowerCase())
  if (!aliases || aliases.size === 0) return []
  const ids: string[] = []
  for (const iKey of aliases) {
    const twitterId = twitterIdFromISubject(iKey)
    if (twitterId) ids.push(twitterId)
  }
  return ids
}

/** Last bound twitterId for this pubkey (load / bind insertion order). */
export function twitterIdForPubkey(
  graph: Graph,
  hex: string,
): string | undefined {
  const ids = twitterIdsForPubkey(graph, hex)
  return ids.length === 0 ? undefined : ids[ids.length - 1]
}

export function pubkeyForTwitterId(
  graph: Graph,
  twitterId: string,
): string | undefined {
  return graph.iToP.get(`user:id:${twitterId}`)
}

export function chromeForNeighborhoodNodes(
  graph: Graph,
  nodes: readonly GraphPathViewNode[],
): {
  identities: Record<string, XIdentityDisplay>
  posts: Record<string, XPostDisplay>
} {
  const identities: Record<string, XIdentityDisplay> = {}
  const posts: Record<string, XPostDisplay> = {}
  const identityMap = graphIdentities(graph)
  const postMap = graphPosts(graph)
  for (const node of nodes) {
    const value = node.subject?.value ?? ''
    const parsed = parseCanonicalTwitterSubject(value)
    if (parsed?.type === 'account') {
      const display = identityMap.get(parsed.twitterId)
      if (display) identities[parsed.twitterId] = display
      continue
    }
    if (parsed?.type === 'post') {
      const display = postMap.get(parsed.postId)
      if (display) posts[parsed.postId] = display
      continue
    }
    if (node.subject?.type === 'p') {
      const hex = node.subject.value.trim().toLowerCase()
      const twitterId = twitterIdForPubkey(graph, hex)
      if (!twitterId) continue
      const display = identityMap.get(twitterId)
      if (!display) continue
      identities[twitterId] = display
      identities[hex] = display
    }
  }
  return { identities, posts }
}
