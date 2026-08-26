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
  maxHops: number
  search: string
  showLabels: boolean
  showArrows: boolean
  layout: 'force' | 'radial'
  showUserIcons: boolean
  colorBy: 'trust' | 'distance'
  /**
   * Graph chrome theme. `auto` follows last-known X.com theme, else OS.
   * Default `light` — often clearer for the force graph.
   */
  colorScheme: GraphColorSchemePreference
}

export type GraphFinalStatementFilter = 'all' | 'trust' | 'neutral' | 'distrust'

export const DEFAULT_GRAPH_VIEW_SETTINGS: GraphViewSettings = {
  direction: 'both',
  finalStatementFilter: 'all',
  maxHops: 4,
  search: '',
  showLabels: true,
  showArrows: true,
  layout: 'force',
  showUserIcons: true,
  colorBy: 'trust',
  colorScheme: 'light',
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
    maxHops:
      typeof o.maxHops === 'number' && o.maxHops >= 1 && o.maxHops <= 6
        ? Math.floor(o.maxHops)
        : DEFAULT_GRAPH_VIEW_SETTINGS.maxHops,
    search: typeof o.search === 'string' ? o.search : '',
    showLabels:
      typeof o.showLabels === 'boolean'
        ? o.showLabels
        : DEFAULT_GRAPH_VIEW_SETTINGS.showLabels,
    showArrows:
      typeof o.showArrows === 'boolean'
        ? o.showArrows
        : DEFAULT_GRAPH_VIEW_SETTINGS.showArrows,
    layout: o.layout === 'radial' ? 'radial' : 'force',
    showUserIcons:
      typeof o.showUserIcons === 'boolean'
        ? o.showUserIcons
        : DEFAULT_GRAPH_VIEW_SETTINGS.showUserIcons,
    colorBy: o.colorBy === 'distance' ? 'distance' : 'trust',
    colorScheme:
      o.colorScheme === 'dark' ||
      o.colorScheme === 'light' ||
      o.colorScheme === 'auto'
        ? o.colorScheme
        : DEFAULT_GRAPH_VIEW_SETTINGS.colorScheme,
  }
}

export function filterGraphData(
  data: GraphVizData,
  settings: GraphViewSettings,
  alwaysKeepIds: Set<string>,
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
    const source =
      typeof link.source === 'string' ? link.source : link.source.id
    const target =
      typeof link.target === 'string' ? link.target : link.target.id
    linked.add(source)
    linked.add(target)
  }
  const keptNodes = nodes.filter(
    (n) =>
      alwaysKeepIds.has(n.id) ||
      n.kind === 'aggregate' ||
      searchMatches.has(n.id) ||
      linked.has(n.id) ||
      data.nodes.length <= 1,
  )
  return { nodes: keptNodes, links }
}

export function resolutionColor(resolution?: TrustResolution): string {
  if (resolution === 'trusted') return TRUST_COLOR
  if (resolution === 'distrusted') return DISTRUST_COLOR
  if (resolution === 'mixed') return MIXED_COLOR
  return NEUTRAL_COLOR
}

export function hopColor(depth: number): string {
  if (depth <= 0) return ROOT_COLOR
  if (depth === 1) return TRUST_COLOR
  if (depth === 2) return MIXED_COLOR
  return NEUTRAL_COLOR
}

export type { GraphPageMode }
