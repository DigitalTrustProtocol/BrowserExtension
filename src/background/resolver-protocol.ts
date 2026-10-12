/**
 * Resolver protocol v1 frames and the NIP-11 `dtp` document.
 * Result shapes match Attention's existing query DTOs.
 */

import type {
  QueryRatingBatchResult,
  QueryTrustBatchResult,
} from '../shared/contracts'
import type {
  GraphPathViewEdge,
  GraphPathViewNode,
  RatingQueryResult,
  ResolvedStatement,
  TrustQueryResult,
  TrustResolution,
  TrustSubject,
} from '../graph/types'

export const REQUIRED_RESOLVER_CAPABILITIES = [
  'trust.query',
  'trust.batch',
  'rating.query',
  'rating.batch',
  'graph.neighborhood',
  'lookup.incoming',
  'lookup.outgoing',
] as const

export interface ResolverInfo {
  api: 'v1'
  instanceId?: string
  capabilities: string[]
  restrictedWrites: boolean
  authRequired: boolean
}

export type ParsedResolverInfo =
  | { ok: true; info: ResolverInfo }
  | { ok: false; error: string; api?: string }

const RESOLUTIONS = new Set<TrustResolution>([
  'trusted',
  'distrusted',
  'mixed',
  'none',
])

export function parseResolverInfo(value: unknown): ParsedResolverInfo {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, error: 'Not a resolver' }
  }
  const record = value as {
    dtp?: unknown
    limitation?: { auth_required?: unknown; restricted_writes?: unknown }
  }
  const dtp = record.dtp
  if (typeof dtp !== 'object' || dtp === null) {
    return { ok: false, error: 'Not a resolver' }
  }
  const doc = dtp as { api?: unknown; instanceId?: unknown; capabilities?: unknown }
  const api = typeof doc.api === 'string' ? doc.api : undefined
  if (api !== 'v1') {
    return { ok: false, error: 'Not a resolver protocol v1 server', api }
  }
  const capabilities = Array.isArray(doc.capabilities)
    ? doc.capabilities.filter((item): item is string => typeof item === 'string')
    : []
  const missing = REQUIRED_RESOLVER_CAPABILITIES.filter(
    (name) => !capabilities.includes(name),
  )
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing resolver capability: ${missing[0]}`,
      api,
    }
  }
  const limitation = record.limitation
  return {
    ok: true,
    info: {
      api: 'v1',
      ...(typeof doc.instanceId === 'string' ? { instanceId: doc.instanceId } : {}),
      capabilities,
      restrictedWrites: limitation?.restricted_writes === true,
      authRequired: limitation?.auth_required === true,
    },
  }
}

export type ResolverFrame =
  | { type: 'auth'; challenge: string }
  | { type: 'ok'; eventId: string; accepted: boolean; message: string }
  | { type: 'dtp-ok'; reqId: string; result: unknown }
  | { type: 'dtp-err'; reqId: string; code: string; message: string }
  | { type: 'push'; topic: string; data: unknown }
  | { type: 'ignore' }

export function parseResolverFrame(data: string): ResolverFrame {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return { type: 'ignore' }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { type: 'ignore' }
  const kind = parsed[0]
  if (kind === 'AUTH' && typeof parsed[1] === 'string') {
    return { type: 'auth', challenge: parsed[1] }
  }
  if (
    kind === 'OK' &&
    typeof parsed[1] === 'string' &&
    typeof parsed[2] === 'boolean'
  ) {
    return {
      type: 'ok',
      eventId: parsed[1],
      accepted: parsed[2],
      message: typeof parsed[3] === 'string' ? parsed[3] : '',
    }
  }
  if (kind === 'DTP-OK' && typeof parsed[1] === 'string') {
    return { type: 'dtp-ok', reqId: parsed[1], result: parsed[2] }
  }
  if (kind === 'DTP-ERR' && typeof parsed[1] === 'string') {
    return {
      type: 'dtp-err',
      reqId: parsed[1],
      code: typeof parsed[2] === 'string' ? parsed[2] : 'error',
      message: typeof parsed[3] === 'string' ? parsed[3] : '',
    }
  }
  if (kind === 'DTP-PUSH' && typeof parsed[1] === 'string') {
    return { type: 'push', topic: parsed[1], data: parsed[2] }
  }
  return { type: 'ignore' }
}

export function emptyTrustResult(input: {
  subject: TrustSubject
  context: string
  now: number
  followTrustThreshold: number
  followTrustRed: number
  graphVersion?: number
}): TrustQueryResult {
  return {
    subject: { ...input.subject },
    context: input.context,
    resolution: 'none',
    trust: 0,
    distrust: 0,
    trustValue: 0,
    degree: 0,
    connected: false,
    statements: [],
    paths: [],
    sourceEventIds: [],
    computedAt: input.now,
    graphVersion: input.graphVersion ?? 0,
    truncated: false,
    followTrustThreshold: input.followTrustThreshold,
    followTrustRed: input.followTrustRed,
  }
}

export function emptyRatingResult(input: {
  subject: TrustSubject
  context: string
  now: number
  followTrustThreshold: number
  followTrustRed: number
  graphVersion?: number
}): RatingQueryResult {
  return {
    subject: { ...input.subject },
    context: input.context,
    claims: [],
    averageScore: null,
    claimCount: 0,
    degree: 0,
    sourceEventIds: [],
    paths: [],
    computedAt: input.now,
    graphVersion: input.graphVersion ?? 0,
    followTrustThreshold: input.followTrustThreshold,
    followTrustRed: input.followTrustRed,
  }
}

function isSubject(value: unknown): value is TrustSubject {
  if (typeof value !== 'object' || value === null) return false
  const subject = value as { type?: unknown; value?: unknown }
  return (
    (subject.type === 'p' || subject.type === 'e' || subject.type === 'i') &&
    typeof subject.value === 'string'
  )
}

export function asTrustQueryResult(
  value: unknown,
  fallback: TrustQueryResult,
): TrustQueryResult {
  if (typeof value !== 'object' || value === null) return fallback
  const row = value as Partial<TrustQueryResult>
  if (!isSubject(row.subject) || !RESOLUTIONS.has(row.resolution as TrustResolution)) {
    return fallback
  }
  return {
    ...fallback,
    ...row,
    subject: { ...row.subject },
    statements: Array.isArray(row.statements) ? row.statements : [],
    paths: [],
    sourceEventIds: Array.isArray(row.sourceEventIds) ? row.sourceEventIds : [],
  }
}

export function asRatingQueryResult(
  value: unknown,
  fallback: RatingQueryResult,
): RatingQueryResult {
  if (typeof value !== 'object' || value === null) return fallback
  const row = value as Partial<RatingQueryResult>
  if (!isSubject(row.subject) || !Array.isArray(row.claims)) return fallback
  return {
    ...fallback,
    ...row,
    subject: { ...row.subject },
    claims: row.claims,
    paths: [],
    sourceEventIds: Array.isArray(row.sourceEventIds) ? row.sourceEventIds : [],
  }
}

export function asTrustBatchResult(
  value: unknown,
  fallbackFor: (key: string) => TrustQueryResult,
  keys: readonly string[],
): QueryTrustBatchResult {
  const record =
    typeof value === 'object' && value !== null
      ? (value as { graphVersion?: unknown; results?: unknown; errors?: unknown })
      : {}
  const rawResults =
    typeof record.results === 'object' && record.results !== null
      ? (record.results as Record<string, unknown>)
      : {}
  const results: Record<string, TrustQueryResult> = {}
  for (const key of keys) {
    results[key] = asTrustQueryResult(rawResults[key], fallbackFor(key))
  }
  const graphVersion =
    typeof record.graphVersion === 'number' ? record.graphVersion : 0
  return { graphVersion, results }
}

export function asRatingBatchResult(
  value: unknown,
  fallbackFor: (key: string) => RatingQueryResult,
  keys: readonly string[],
): QueryRatingBatchResult {
  const record =
    typeof value === 'object' && value !== null
      ? (value as { graphVersion?: unknown; results?: unknown })
      : {}
  const rawResults =
    typeof record.results === 'object' && record.results !== null
      ? (record.results as Record<string, unknown>)
      : {}
  const results: Record<string, RatingQueryResult> = {}
  for (const key of keys) {
    results[key] = asRatingQueryResult(rawResults[key], fallbackFor(key))
  }
  const graphVersion =
    typeof record.graphVersion === 'number' ? record.graphVersion : 0
  return { graphVersion, results }
}

function trustValue(value: unknown): -1 | 0 | 1 | undefined {
  if (value === -1 || value === 0 || value === 1) return value
  return undefined
}

export function lookupItemToStatement(
  value: unknown,
  requestedContext: string,
): ResolvedStatement | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  const author = typeof row.author === 'string' ? row.author : ''
  const eventId = typeof row.eventId === 'string' ? row.eventId : ''
  const trust = trustValue(row.value)
  if (!author || !eventId || trust === undefined || !isSubject(row.subject)) {
    return undefined
  }
  const context = typeof row.context === 'string' ? row.context : ''
  return {
    eventId,
    ...(typeof row.connectionKey === 'string'
      ? { connectionKey: row.connectionKey }
      : {}),
    author,
    subject: { ...row.subject },
    context,
    requestedContext,
    contextMatch: context === requestedContext ? 'exact' : 'parent',
    value: trust,
    createdAt: typeof row.createdAt === 'number' ? row.createdAt : 0,
    ...(typeof row.activeFrom === 'number' ? { activeFrom: row.activeFrom } : {}),
    ...(typeof row.activeUntil === 'number' ? { activeUntil: row.activeUntil } : {}),
    ...(typeof row.content === 'string' ? { content: row.content } : {}),
    ...(Array.isArray(row.labels)
      ? { labels: row.labels.filter((item): item is string => typeof item === 'string') }
      : {}),
    distance: typeof row.distance === 'number' ? row.distance : 1,
  }
}

export interface LookupStatementPage {
  statements: ResolvedStatement[]
  truncated: boolean
}

export function asLookupPage(
  value: unknown,
  requestedContext: string,
): LookupStatementPage {
  const record =
    typeof value === 'object' && value !== null
      ? (value as { items?: unknown; nextCursor?: unknown })
      : {}
  const items = Array.isArray(record.items) ? record.items : []
  const statements = items.flatMap((item) => {
    const statement = lookupItemToStatement(item, requestedContext)
    return statement ? [statement] : []
  })
  return {
    statements,
    truncated: typeof record.nextCursor === 'string' && record.nextCursor.length > 0,
  }
}

export interface ServerNeighborhood {
  graphVersion: number
  centerId: number | string
  truncated: boolean
  nodes: GraphPathViewNode[]
  edges: GraphPathViewEdge[]
}

function asNode(value: unknown): GraphPathViewNode | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Partial<GraphPathViewNode>
  if (row.id === undefined || typeof row.kind !== 'string') return undefined
  if (
    row.kind !== 'pubkey' &&
    row.kind !== 'twitter_id' &&
    row.kind !== 'post' &&
    row.kind !== 'other'
  ) {
    return undefined
  }
  return {
    id: row.id,
    kind: row.kind,
    depth: typeof row.depth === 'number' ? row.depth : 0,
    label: typeof row.label === 'string' ? row.label : '',
    ...(isSubject(row.subject) ? { subject: { ...row.subject } } : {}),
  }
}

function asEdge(value: unknown): GraphPathViewEdge | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Partial<GraphPathViewEdge>
  const trust = trustValue(row.value)
  if (row.id === undefined || row.from === undefined || row.to === undefined) {
    return undefined
  }
  if (trust === undefined || typeof row.eventId !== 'string') return undefined
  return {
    id: row.id,
    from: row.from,
    to: row.to,
    value: trust,
    context: typeof row.context === 'string' ? row.context : '',
    eventId: row.eventId,
    depth: typeof row.depth === 'number' ? row.depth : 1,
  }
}

export function asNeighborhood(
  value: unknown,
  fallbackCenter: number | string,
): ServerNeighborhood {
  const record =
    typeof value === 'object' && value !== null
      ? (value as {
          graphVersion?: unknown
          centerId?: unknown
          truncated?: unknown
          nodes?: unknown
          edges?: unknown
        })
      : {}
  const centerId =
    typeof record.centerId === 'number' || typeof record.centerId === 'string'
      ? record.centerId
      : fallbackCenter
  return {
    graphVersion: typeof record.graphVersion === 'number' ? record.graphVersion : 0,
    centerId,
    truncated: record.truncated === true,
    nodes: Array.isArray(record.nodes)
      ? record.nodes.flatMap((node) => {
          const parsed = asNode(node)
          return parsed ? [parsed] : []
        })
      : [],
    edges: Array.isArray(record.edges)
      ? record.edges.flatMap((edge) => {
          const parsed = asEdge(edge)
          return parsed ? [parsed] : []
        })
      : [],
  }
}

export function infoGraphVersion(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const version = (value as { graphVersion?: unknown }).graphVersion
  return typeof version === 'number' ? version : undefined
}
