import type { ResolvedGraphStatement, TrustGraphView } from './graph'
import type {
  ActiveTrustValue,
  GraphBounds,
  ReducedTrustStatement,
  ResolvedStatement,
  TrustPath,
  TrustQuery,
  TrustQueryResult,
  TrustResolution,
} from './types'

export const DEFAULT_GRAPH_BOUNDS: Readonly<GraphBounds> = Object.freeze({
  maxDepth: 3,
  maxAuthorsPerLevel: 250,
  maxTotalAuthors: 1_000,
  maxEvents: 5_000,
})

function bound(
  name: keyof GraphBounds,
  value: number | undefined,
): number {
  const resolved = value ?? DEFAULT_GRAPH_BOUNDS[name]
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`)
  }
  return resolved
}

export function normalizeBounds(
  bounds: Partial<GraphBounds> = {},
): GraphBounds {
  return {
    maxDepth: bound('maxDepth', bounds.maxDepth),
    maxAuthorsPerLevel: bound(
      'maxAuthorsPerLevel',
      bounds.maxAuthorsPerLevel,
    ),
    maxTotalAuthors: bound('maxTotalAuthors', bounds.maxTotalAuthors),
    maxEvents: bound('maxEvents', bounds.maxEvents),
  }
}

interface PathState {
  author: string
  authors: string[]
  edgeEventIds: string[]
  distance: number
}

interface ReachCandidate {
  child: string
  parent: PathState
  edge: ResolvedGraphStatement
}

interface Evidence {
  statement: ResolvedStatement
  path: TrustPath
}

function resolvedStatement(
  source: ReducedTrustStatement,
  resolved: ResolvedGraphStatement,
  requestedContext: string,
  distance: number,
): ResolvedStatement {
  return {
    eventId: source.eventId,
    author: source.author,
    subject: { ...source.subject },
    context: source.context,
    requestedContext,
    contextMatch: resolved.contextMatch,
    value: source.value as ActiveTrustValue,
    createdAt: source.createdAt,
    ...(source.activeFrom === undefined
      ? {}
      : { activeFrom: source.activeFrom }),
    ...(source.activeUntil === undefined
      ? {}
      : { activeUntil: source.activeUntil }),
    distance,
    ...(source.derivedFrom
      ? {
          derivedFrom: {
            subject: { ...source.derivedFrom.subject },
            twitterId: source.derivedFrom.twitterId,
          },
        }
      : {}),
  }
}

function resolutionFor(statements: readonly ResolvedStatement[]): TrustResolution {
  let trusted = false
  let distrusted = false

  for (const statement of statements) {
    trusted ||= statement.value === 1
    distrusted ||= statement.value === -1
  }

  if (trusted && distrusted) {
    return 'mixed'
  }
  if (trusted) {
    return 'trusted'
  }
  if (distrusted) {
    return 'distrusted'
  }
  return 'none'
}

function compareCandidates(left: ReachCandidate, right: ReachCandidate): number {
  return (
    left.child.localeCompare(right.child) ||
    left.parent.authors.join('\u0000').localeCompare(
      right.parent.authors.join('\u0000'),
    ) ||
    left.edge.statement.eventId.localeCompare(right.edge.statement.eventId)
  )
}

function compareEvidence(left: Evidence, right: Evidence): number {
  return (
    left.statement.distance - right.statement.distance ||
    left.statement.author.localeCompare(right.statement.author) ||
    left.statement.eventId.localeCompare(right.statement.eventId)
  )
}

function uniqueInOrder(values: readonly string[]): string[] {
  return [...new Set(values)]
}

/**
 * Runs a deterministic bounded breadth-first query. Each pubkey author is
 * visited once through its canonical shortest path, so alternate identity
 * representations or converging paths never multiply a person's evidence.
 */
export function executeTrustQuery(
  graph: TrustGraphView,
  query: TrustQuery,
): TrustQueryResult {
  const context = query.context ?? ''
  const now = query.now ?? Math.floor(Date.now() / 1_000)
  if (!Number.isFinite(now)) {
    throw new RangeError('now must be finite')
  }

  const bounds = normalizeBounds({
    ...graph.defaultBounds,
    ...query.bounds,
  })
  const usedEventIds = new Set<string>()
  const evidence: Evidence[] = []
  const visited = new Set<string>()
  let truncated = false

  const claimEvent = (eventId: string): boolean => {
    if (usedEventIds.has(eventId)) {
      return true
    }
    if (usedEventIds.size >= bounds.maxEvents) {
      truncated = true
      return false
    }
    usedEventIds.add(eventId)
    return true
  }

  let frontier: PathState[] = []
  if (bounds.maxTotalAuthors === 0) {
    truncated = true
  } else {
    visited.add(query.rootPubkey)
    frontier = [
      {
        author: query.rootPubkey,
        authors: [query.rootPubkey],
        edgeEventIds: [],
        distance: 0,
      },
    ]
  }

  while (frontier.length > 0) {
    frontier.sort((left, right) => left.author.localeCompare(right.author))

    for (const state of frontier) {
      const resolved = graph.resolveStatement(
        state.author,
        query.subject,
        context,
        now,
      )
      if (!resolved || !claimEvent(resolved.statement.eventId)) {
        continue
      }

      evidence.push({
        statement: resolvedStatement(
          resolved.statement,
          resolved,
          context,
          state.distance,
        ),
        path: {
          authors: [...state.authors],
          subject: { ...query.subject },
          sourceEventIds: uniqueInOrder([
            ...state.edgeEventIds,
            resolved.statement.eventId,
          ]),
        },
      })
    }

    const depth = frontier[0]?.distance ?? 0
    const candidates: ReachCandidate[] = []
    for (const state of frontier) {
      for (const edge of graph.traversableStatements(
        state.author,
        context,
        now,
      )) {
        if (edge.statement.subject.type !== 'p') {
          continue
        }
        const child = edge.statement.subject.value
        if (visited.has(child)) {
          continue
        }
        candidates.push({ child, parent: state, edge })
      }
    }

    if (candidates.length === 0) {
      break
    }
    if (depth >= bounds.maxDepth) {
      truncated = true
      break
    }

    candidates.sort(compareCandidates)
    const canonical: ReachCandidate[] = []
    const queued = new Set<string>()
    for (const candidate of candidates) {
      if (!queued.has(candidate.child)) {
        queued.add(candidate.child)
        canonical.push(candidate)
      }
    }

    const authorCapacity = Math.max(
      0,
      Math.min(
        bounds.maxAuthorsPerLevel,
        bounds.maxTotalAuthors - visited.size,
      ),
    )
    if (canonical.length > authorCapacity) {
      truncated = true
    }

    const next: PathState[] = []
    for (const candidate of canonical.slice(0, authorCapacity)) {
      if (!claimEvent(candidate.edge.statement.eventId)) {
        continue
      }
      visited.add(candidate.child)
      next.push({
        author: candidate.child,
        authors: [...candidate.parent.authors, candidate.child],
        edgeEventIds: [
          ...candidate.parent.edgeEventIds,
          candidate.edge.statement.eventId,
        ],
        distance: candidate.parent.distance + 1,
      })
    }
    frontier = next
  }

  evidence.sort(compareEvidence)
  const statements = evidence.map((entry) => entry.statement)
  const paths = evidence.map((entry) => entry.path)
  const direct = statements.find(
    (statement) =>
      statement.distance === 0 && statement.author === query.rootPubkey,
  )

  return {
    subject: { ...query.subject },
    context,
    resolution: resolutionFor(statements),
    ...(direct === undefined ? {} : { direct }),
    statements,
    paths,
    sourceEventIds: [...usedEventIds].sort(),
    computedAt: now,
    graphVersion: graph.graphVersion,
    truncated,
  }
}
