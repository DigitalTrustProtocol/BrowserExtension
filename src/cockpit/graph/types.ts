import type {
  GraphNeighborhoodDirection,
  GraphSnapshotEdge,
  GraphSnapshotNode,
} from '../../shared/contracts'
import type { GraphPageMode } from '../../shared/graph-deeplink'
import type { GraphColorSchemePreference } from '../../shared/page-color-scheme'
import type { TrustResolution } from '../../graph'

export const GRAPH_VIEW_SETTINGS_KEY = 'graphViewSettings'

export interface GraphViewSettings {
  direction: GraphNeighborhoodDirection
  finalStatementFilter: GraphFinalStatementFilter
  search: string
  showLabels: boolean
  layout: 'force' | 'radial'
  showUserIcons: boolean
  /** When true, Graph nodes get a trust-resolution border (green / yellow / red). */
  colorByTrust: boolean
  /**
   * Graph chrome theme. `auto` follows last-known X.com theme, else OS.
   * The toolbar sun/moon button persists an explicit light or dark override.
   */
  colorScheme: GraphColorSchemePreference
}

export type GraphFinalStatementFilter = 'all' | 'trust' | 'neutral' | 'distrust'

export const DEFAULT_GRAPH_VIEW_SETTINGS: GraphViewSettings = {
  direction: 'both',
  finalStatementFilter: 'all',
  search: '',
  showLabels: true,
  layout: 'force',
  showUserIcons: true,
  colorByTrust: true,
  colorScheme: 'auto',
}

export type GraphVizNodeKind = GraphSnapshotNode['kind'] | 'aggregate'

export interface GraphVizNode extends Omit<GraphSnapshotNode, 'kind'> {
  kind: GraphVizNodeKind
  expanded?: boolean
  expandedFrom?: string[]
  resolution?: TrustResolution
  isRoot?: boolean
  isFocus?: boolean
  picture?: string
  /** Secondary line under the display name (e.g. @handle). */
  subtitle?: string
  /** Parent of a synthetic Load more node. */
  aggregateParentId?: string
  /** How many neighbors are still queued behind this aggregate. */
  aggregateRemaining?: number
  /** Canvas position (set by force-graph). */
  x?: number
  y?: number
  fx?: number
  fy?: number
  /** X id without chrome, or unbound Nostr hop. */
  unidentifiedKind?: 'x-id' | 'external'
  /** Previous `p:` wire ids after bound hops are drawn as `user:id`. */
  collapsedFromIds?: string[]
}

export interface GraphVizLink {
  id: string
  source: string | GraphVizNode
  target: string | GraphVizNode
  value: 1 | 0 | -1
  context: string
  eventId: string
  depth: number
  expandedFrom?: string[]
}

export interface GraphVizData {
  nodes: GraphVizNode[]
  links: GraphVizLink[]
}

export const TRUST_COLOR = '#00a36c'
export const DISTRUST_COLOR = '#e5484d'
export const MIXED_COLOR = '#d49b16'
export const NEUTRAL_COLOR = '#8b95a8'
export const ROOT_COLOR = '#1d9bf0'

export function edgeId(edge: GraphSnapshotEdge): string {
  return `${edge.eventId}:${edge.from}:${edge.to}`
}

export function linkId(link: GraphVizLink): string {
  const source =
    typeof link.source === 'string' ? link.source : link.source.id
  const target =
    typeof link.target === 'string' ? link.target : link.target.id
  return `${link.eventId}:${source}:${target}`
}

export function matchesFinalStatementFilter(
  value: 1 | 0 | -1,
  filter: GraphFinalStatementFilter,
): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'trust':
      return value === 1
    case 'neutral':
      return value === 1 || value === 0
    case 'distrust':
      return value === 1 || value === -1
    default: {
      const _exhaustive: never = filter
      return _exhaustive
    }
  }
}

/** Exclusive last-degree filter (Path). Hops are not this set. */
export function matchesLastDegreeFilter(
  value: 1 | 0 | -1,
  filter: GraphFinalStatementFilter,
): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'trust':
      return value === 1
    case 'neutral':
      return value === 0
    case 'distrust':
      return value === -1
    default: {
      const _exhaustive: never = filter
      return _exhaustive
    }
  }
}

function normalizeColorByTrust(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw
  if (raw === 'distance') return false
  return DEFAULT_GRAPH_VIEW_SETTINGS.colorByTrust
}

function normalizeFinalStatementFilter(
  raw: unknown,
): GraphFinalStatementFilter {
  if (
    raw === 'all' ||
    raw === 'trust' ||
    raw === 'neutral' ||
    raw === 'distrust'
  ) {
    return raw
  }
  if (raw === 'both') return 'all'
  return DEFAULT_GRAPH_VIEW_SETTINGS.finalStatementFilter
}

export function normalizeGraphViewSettings(
  raw: unknown,
): GraphViewSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_GRAPH_VIEW_SETTINGS }
  const o = raw as Record<string, unknown>
  return {
    direction:
      o.direction === 'out' || o.direction === 'in' || o.direction === 'both'
        ? o.direction
        : DEFAULT_GRAPH_VIEW_SETTINGS.direction,
    finalStatementFilter: normalizeFinalStatementFilter(
      o.finalStatementFilter ?? o.valueFilter,
    ),
    search: typeof o.search === 'string' ? o.search : '',
    showLabels:
      typeof o.showLabels === 'boolean'
        ? o.showLabels
        : DEFAULT_GRAPH_VIEW_SETTINGS.showLabels,
    layout: o.layout === 'radial' ? 'radial' : 'force',
    showUserIcons:
      typeof o.showUserIcons === 'boolean'
        ? o.showUserIcons
        : DEFAULT_GRAPH_VIEW_SETTINGS.showUserIcons,
    colorByTrust: normalizeColorByTrust(o.colorByTrust ?? o.colorBy),
    colorScheme:
      o.colorScheme === 'dark' ||
      o.colorScheme === 'light' ||
      o.colorScheme === 'auto'
        ? o.colorScheme
        : DEFAULT_GRAPH_VIEW_SETTINGS.colorScheme,
  }
}

function linkEndpointId(ref: string | { id: string }): string {
  return typeof ref === 'string' ? ref : ref.id
}

function directedNeighbors(
  links: GraphVizData['links'],
): Map<string, string[]> {
  const adj = new Map<string, string[]>()
  for (const link of links) {
    const source = linkEndpointId(link.source)
    const target = linkEndpointId(link.target)
    const list = adj.get(source)
    if (list) list.push(target)
    else adj.set(source, [target])
  }
  return adj
}

function reachable(start: string, adj: Map<string, string[]>): Set<string> {
  const seen = new Set<string>()
  if (!start) return seen
  const queue = [start]
  seen.add(start)
  for (let i = 0; i < queue.length; i += 1) {
    for (const next of adj.get(queue[i]!) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return seen
}

/** Nodes that still lie on a remaining directed path from `fromId` to `toId`. */
function nodesOnDirectedPaths(
  links: GraphVizData['links'],
  fromId: string,
  toId: string,
): Set<string> {
  const forward = directedNeighbors(links)
  const reverse = new Map<string, string[]>()
  for (const [from, tos] of forward) {
    for (const to of tos) {
      const list = reverse.get(to)
      if (list) list.push(from)
      else reverse.set(to, [from])
    }
  }
  const fromStart = reachable(fromId, forward)
  if (!fromStart.has(toId)) return new Set([fromId, toId])
  const toEnd = reachable(toId, reverse)
  const keep = new Set<string>()
  for (const id of fromStart) {
    if (toEnd.has(id)) keep.add(id)
  }
  return keep
}

export function filterGraphData(
  data: GraphVizData,
  settings: GraphViewSettings,
  alwaysKeepIds: Set<string>,
  pathEnds?: { fromId: string; toId: string },
): GraphVizData {
  const q = settings.search.trim().toLowerCase()
  const searchMatches = new Set<string>()
  const nodes = data.nodes.filter((node) => {
    if (alwaysKeepIds.has(node.id)) return true
    if (node.kind === 'aggregate') return true
    if (!q) return true
    const matches =
      node.label.toLowerCase().includes(q) ||
      node.id.toLowerCase().includes(q)
    if (matches) searchMatches.add(node.id)
    return matches
  })
  const nodeIds = new Set(nodes.map((n) => n.id))
  const links = data.links.filter((link) => {
    const source =
      typeof link.source === 'string' ? link.source : link.source.id
    const target =
      typeof link.target === 'string' ? link.target : link.target.id
    if (!nodeIds.has(source) || !nodeIds.has(target)) return false
    if (link.eventId.startsWith('agg:')) return true
    if (pathEnds !== undefined) {
      const isLastDegree = target === pathEnds.toId
      if (!isLastDegree) return true
      return matchesLastDegreeFilter(link.value, settings.finalStatementFilter)
    }
    if (
      !matchesFinalStatementFilter(link.value, settings.finalStatementFilter)
    ) {
      return false
    }
    return true
  })
  // Drop nodes that became isolated after link filter (except always-keep).
  const linked = new Set<string>()
  for (const link of links) {
    linked.add(linkEndpointId(link.source))
    linked.add(linkEndpointId(link.target))
  }
  const onPath =
    pathEnds !== undefined
      ? nodesOnDirectedPaths(links, pathEnds.fromId, pathEnds.toId)
      : undefined
  const keptNodes = nodes.filter((n) => {
    if (alwaysKeepIds.has(n.id) || n.kind === 'aggregate' || n.id.startsWith('agg:')) {
      return true
    }
    if (searchMatches.has(n.id)) return true
    if (data.nodes.length <= 1) return true
    if (onPath) return onPath.has(n.id)
    return linked.has(n.id)
  })
  const keptIds = new Set(keptNodes.map((n) => n.id))
  const keptLinks = links.filter((link) => {
    const source = linkEndpointId(link.source)
    const target = linkEndpointId(link.target)
    return keptIds.has(source) && keptIds.has(target)
  })
  return { nodes: keptNodes, links: keptLinks }
}

export function resolutionColor(resolution?: TrustResolution): string {
  if (resolution === 'trusted') return TRUST_COLOR
  if (resolution === 'distrusted') return DISTRUST_COLOR
  if (resolution === 'mixed') return MIXED_COLOR
  return NEUTRAL_COLOR
}

export type { GraphPageMode }
