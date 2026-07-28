import { contextCandidates } from './context'
import { executeTrustQuery, normalizeBounds } from './query'
import type {
  ContextMatch,
  GraphBounds,
  GraphUpdateResult,
  ReducedTrustStatement,
  TrustQuery,
  TrustQueryResult,
  TrustSubject,
} from './types'

export interface ResolvedGraphStatement {
  statement: Readonly<ReducedTrustStatement>
  contextMatch: ContextMatch
}

/**
 * Narrow read view used by the query engine. Keeping this interface exported
 * lets storage/contracts integrate later without coupling to graph internals.
 */
export interface TrustGraphView {
  readonly graphVersion: number
  readonly defaultBounds: Readonly<GraphBounds>
  resolveStatement(
    author: string,
    subject: TrustSubject,
    requestedContext: string,
    now: number,
  ): ResolvedGraphStatement | undefined
  traversableStatements(
    author: string,
    requestedContext: string,
    now: number,
  ): ResolvedGraphStatement[]
}

type ContextIndex = Map<string, Readonly<ReducedTrustStatement>>
type SubjectIndex = Map<string, ContextIndex>
type AuthorIndex = Map<string, ContextIndex>

function subjectKey(subject: TrustSubject): string {
  return `${subject.type}:${subject.value.length}:${subject.value}`
}

function slotKey(statement: ReducedTrustStatement): string {
  return `${statement.author.length}:${statement.author}|${subjectKey(statement.subject)}|${statement.context.length}:${statement.context}`
}

function cloneStatement(
  statement: ReducedTrustStatement,
): Readonly<ReducedTrustStatement> {
  return {
    ...statement,
    subject: { ...statement.subject },
    ...(statement.derivedFrom
      ? {
          derivedFrom: {
            subject: { ...statement.derivedFrom.subject },
            twitterId: statement.derivedFrom.twitterId,
          },
        }
      : {}),
  }
}

function replaces(
  candidate: ReducedTrustStatement,
  current: ReducedTrustStatement,
): boolean {
  return (
    candidate.createdAt > current.createdAt ||
    (candidate.createdAt === current.createdAt &&
      candidate.eventId.localeCompare(current.eventId) < 0)
  )
}

function isActive(statement: ReducedTrustStatement, now: number): boolean {
  return (
    (statement.activeFrom === undefined || statement.activeFrom <= now) &&
    (statement.activeUntil === undefined || statement.activeUntil >= now)
  )
}

export type GraphNodeKind = 'pubkey' | 'twitter_id' | 'post' | 'other'

export interface GraphViewNode {
  id: string
  kind: GraphNodeKind
  depth: number
  label: string
}

export interface GraphViewEdge {
  from: string
  to: string
  value: 1 | -1
  context: string
  eventId: string
  depth: number
}

export type NeighborhoodDirection = 'out' | 'in' | 'both'
export type NeighborhoodValueFilter = 'trust' | 'distrust' | 'both'

function classifySubject(subject: TrustSubject): {
  id: string
  kind: GraphNodeKind
  label: string
} {
  if (subject.type === 'p') {
    return {
      id: `p:${subject.value}`,
      kind: 'pubkey',
      label: subject.value.slice(0, 12) + '…',
    }
  }
  if (subject.type === 'i' && subject.value.startsWith('ext:twitter_id:')) {
    const twitterId = subject.value.slice('ext:twitter_id:'.length)
    return {
      id: `i:${subject.value}`,
      kind: 'twitter_id',
      label: `X · ${twitterId}`,
    }
  }
  if (subject.type === 'i' && subject.value.startsWith('ext:twitter_post:')) {
    const postId = subject.value.slice('ext:twitter_post:'.length)
    return {
      id: `i:${subject.value}`,
      kind: 'post',
      label: `Post · ${postId}`,
    }
  }
  if (subject.type === 'e') {
    return {
      id: `e:${subject.value}`,
      kind: 'post',
      label: `Event · ${subject.value.slice(0, 12)}…`,
    }
  }
  return {
    id: `${subject.type}:${subject.value}`,
    kind: 'other',
    label: `${subject.type}:${subject.value.slice(0, 24)}`,
  }
}

function parseCenterId(centerId: string): {
  authorPubkey?: string
  subject?: TrustSubject
  node: ReturnType<typeof classifySubject>
} | undefined {
  const colon = centerId.indexOf(':')
  if (colon <= 0) return undefined
  const type = centerId.slice(0, colon)
  const value = centerId.slice(colon + 1)
  if (!value || (type !== 'p' && type !== 'e' && type !== 'i')) return undefined
  const subject = { type, value } as TrustSubject
  const node = classifySubject(subject)
  if (type === 'p') {
    return { authorPubkey: value, subject, node }
  }
  return { subject, node }
}

function valueMatches(
  value: 1 | -1,
  filter: NeighborhoodValueFilter,
): boolean {
  if (filter === 'both') return true
  if (filter === 'trust') return value === 1
  return value === -1
}

function visibleStatements(
  contexts: ContextIndex,
  requestedContext: string | undefined,
  now: number,
): Readonly<ReducedTrustStatement>[] {
  if (requestedContext === undefined || requestedContext === '') {
    return [...contexts.values()]
      .filter(
        (statement) =>
          statement.value !== 0 && isActive(statement, now),
      )
      .sort(
        (left, right) =>
          left.context.localeCompare(right.context) ||
          left.eventId.localeCompare(right.eventId),
      )
  }

  for (const candidate of contextCandidates(requestedContext)) {
    const statement = contexts.get(candidate.context)
    if (!statement) continue
    // A cancellation or inactive exact/parent statement shadows broader slots.
    return statement.value !== 0 && isActive(statement, now)
      ? [statement]
      : []
  }
  return []
}

/**
 * In-memory index over replacement-reduced kind-32009 statements.
 *
 * `p` subjects are indexed for traversal. `e` and `i` subjects remain terminal
 * evidence, so an X account identifier can never silently become a second
 * traversable representation of a linked Nostr pubkey.
 */
export class LocalTrustGraph implements TrustGraphView {
  private readonly slots = new Map<
    string,
    Readonly<ReducedTrustStatement>
  >()

  private readonly byAuthor = new Map<string, SubjectIndex>()
  private readonly bySubject = new Map<string, AuthorIndex>()

  graphVersion = 0
  readonly defaultBounds: Readonly<GraphBounds>

  constructor(
    statements: Iterable<ReducedTrustStatement> = [],
    defaultBounds: Partial<GraphBounds> = {},
  ) {
    this.defaultBounds = normalizeBounds(defaultBounds)
    this.rebuild(statements)
  }

  rebuild(statements: Iterable<ReducedTrustStatement>): GraphUpdateResult {
    this.slots.clear()
    this.byAuthor.clear()
    this.bySubject.clear()

    let accepted = 0
    let ignored = 0
    for (const statement of statements) {
      if (this.replaceStatement(statement)) {
        accepted += 1
      } else {
        ignored += 1
      }
    }

    this.graphVersion += 1
    return { accepted, ignored, graphVersion: this.graphVersion }
  }

  update(statements: Iterable<ReducedTrustStatement>): GraphUpdateResult {
    let accepted = 0
    let ignored = 0
    for (const statement of statements) {
      if (this.replaceStatement(statement)) {
        accepted += 1
      } else {
        ignored += 1
      }
    }

    if (accepted > 0) {
      this.graphVersion += 1
    }
    return { accepted, ignored, graphVersion: this.graphVersion }
  }

  upsert(statement: ReducedTrustStatement): boolean {
    return this.update([statement]).accepted === 1
  }

  query(query: TrustQuery): TrustQueryResult {
    return executeTrustQuery(this, query)
  }

  /** All replacement-reduced statements currently held in memory. */
  listStatements(): ReducedTrustStatement[] {
    return [...this.slots.values()].map((statement) => cloneStatement(statement))
  }

  /**
   * Ego network from `rootPubkey`: traverse trusted `p` subjects up to
   * `maxDepth`, and attach terminal `i`/`e` evidence from visited authors.
   */
  egoSnapshot(
    rootPubkey: string,
    options: {
      maxDepth?: number
      context?: string
      now?: number
      maxNodes?: number
    } = {},
  ): {
    graphVersion: number
    rootPubkey: string
    nodeCount: number
    edgeCount: number
    truncated: boolean
    nodes: GraphViewNode[]
    edges: GraphViewEdge[]
  } {
    const maxDepth = Math.max(1, Math.min(options.maxDepth ?? 4, 6))
    const maxNodes = Math.max(10, Math.min(options.maxNodes ?? 400, 2_000))
    const context = options.context ?? 'identity'
    const now = options.now ?? Math.floor(Date.now() / 1_000)
    const nodes = new Map<string, GraphViewNode>()
    const edges: GraphViewEdge[] = []
    let truncated = false

    const ensureNode = (
      id: string,
      kind: GraphNodeKind,
      depth: number,
      label: string,
    ): boolean => {
      const existing = nodes.get(id)
      if (existing) {
        if (depth < existing.depth) existing.depth = depth
        return true
      }
      if (nodes.size >= maxNodes) {
        truncated = true
        return false
      }
      nodes.set(id, { id, kind, depth, label })
      return true
    }

    const rootId = `p:${rootPubkey}`
    ensureNode(rootId, 'pubkey', 0, 'You')

    const queue: Array<{ pubkey: string; depth: number }> = [
      { pubkey: rootPubkey, depth: 0 },
    ]
    const visited = new Set<string>([rootPubkey])

    while (queue.length > 0) {
      const current = queue.shift()!
      if (current.depth >= maxDepth) continue

      // Trusted Nostr peers (traversable).
      for (const resolved of this.traversableStatements(
        current.pubkey,
        context,
        now,
      )) {
        const target = classifySubject(resolved.statement.subject)
        if (!ensureNode(target.id, target.kind, current.depth + 1, target.label)) {
          continue
        }
        edges.push({
          from: `p:${current.pubkey}`,
          to: target.id,
          value: 1,
          context: resolved.statement.context,
          eventId: resolved.statement.eventId,
          depth: current.depth + 1,
        })
        if (
          target.kind === 'pubkey' &&
          resolved.statement.subject.type === 'p' &&
          !visited.has(resolved.statement.subject.value)
        ) {
          visited.add(resolved.statement.subject.value)
          queue.push({
            pubkey: resolved.statement.subject.value,
            depth: current.depth + 1,
          })
        }
      }

      // Terminal evidence (X ids / posts) from this author.
      const subjects = this.byAuthor.get(current.pubkey)
      if (!subjects) continue
      for (const contexts of subjects.values()) {
        for (const candidate of contextCandidates(context)) {
          const statement = contexts.get(candidate.context)
          if (!statement || statement.value === 0 || !isActive(statement, now)) {
            continue
          }
          if (statement.subject.type === 'p') break
          const target = classifySubject(statement.subject)
          if (!ensureNode(target.id, target.kind, current.depth + 1, target.label)) {
            break
          }
          edges.push({
            from: `p:${current.pubkey}`,
            to: target.id,
            value: statement.value === -1 ? -1 : 1,
            context: statement.context,
            eventId: statement.eventId,
            depth: current.depth + 1,
          })
          break
        }
      }
    }

    const nodeList = [...nodes.values()].sort(
      (a, b) => a.depth - b.depth || a.id.localeCompare(b.id),
    )
    return {
      graphVersion: this.graphVersion,
      rootPubkey,
      nodeCount: nodeList.length,
      edgeCount: edges.length,
      truncated,
      nodes: nodeList,
      edges,
    }
  }

  /**
   * One-hop neighborhood around a center node for on-demand graph expand.
   * Scans the in-memory index (rebuilt from IndexedDB in the service worker).
   */
  neighborhood(
    centerId: string,
    options: {
      direction?: NeighborhoodDirection
      valueFilter?: NeighborhoodValueFilter
      context?: string
      now?: number
      limit?: number
    } = {},
  ): {
    graphVersion: number
    centerId: string
    truncated: boolean
    nodes: GraphViewNode[]
    edges: GraphViewEdge[]
  } {
    const direction = options.direction ?? 'both'
    const valueFilter = options.valueFilter ?? 'both'
    const now = options.now ?? Math.floor(Date.now() / 1_000)
    const limit = Math.max(1, Math.min(options.limit ?? 200, 500))
    const parsed = parseCenterId(centerId)
    if (!parsed) {
      return {
        graphVersion: this.graphVersion,
        centerId,
        truncated: false,
        nodes: [],
        edges: [],
      }
    }

    const nodes = new Map<string, GraphViewNode>()
    const edges: GraphViewEdge[] = []
    const edgeKeys = new Set<string>()
    let truncated = false

    nodes.set(parsed.node.id, {
      id: parsed.node.id,
      kind: parsed.node.kind,
      depth: 0,
      label: parsed.node.label,
    })

    const pushEdge = (
      fromId: string,
      fromMeta: ReturnType<typeof classifySubject>,
      toMeta: ReturnType<typeof classifySubject>,
      value: 1 | -1,
      context: string,
      eventId: string,
    ): void => {
      const edgeKey = `${eventId}:${fromId}:${toMeta.id}`
      if (edgeKeys.has(edgeKey)) return
      if (edges.length >= limit) {
        truncated = true
        return
      }
      if (!nodes.has(fromId)) {
        nodes.set(fromId, {
          id: fromMeta.id,
          kind: fromMeta.kind,
          depth: fromId === parsed.node.id ? 0 : 1,
          label: fromMeta.label,
        })
      }
      if (!nodes.has(toMeta.id)) {
        nodes.set(toMeta.id, {
          id: toMeta.id,
          kind: toMeta.kind,
          depth: toMeta.id === parsed.node.id ? 0 : 1,
          label: toMeta.label,
        })
      }
      edges.push({
        from: fromId,
        to: toMeta.id,
        value,
        context,
        eventId,
        depth: 1,
      })
      edgeKeys.add(edgeKey)
    }

    const wantOut = direction === 'out' || direction === 'both'
    const wantIn = direction === 'in' || direction === 'both'

    if (wantOut && parsed.authorPubkey) {
      const subjects = this.byAuthor.get(parsed.authorPubkey)
      if (subjects) {
        const sortedSubjects = [...subjects.entries()].sort(([left], [right]) =>
          left.localeCompare(right),
        )
        for (const [, contexts] of sortedSubjects) {
          for (const statement of visibleStatements(
            contexts,
            options.context,
            now,
          )) {
            if (statement.value !== 1 && statement.value !== -1) continue
            if (!valueMatches(statement.value, valueFilter)) continue
            const toMeta = classifySubject(statement.subject)
            pushEdge(
              parsed.node.id,
              parsed.node,
              toMeta,
              statement.value,
              statement.context,
              statement.eventId,
            )
            if (truncated) break
          }
          if (truncated) break
        }
      }
    }

    if (wantIn && parsed.subject) {
      const targetKey = subjectKey(parsed.subject)
      const authors = this.bySubject.get(targetKey)
      const sortedAuthors = [...(authors?.entries() ?? [])].sort(
        ([left], [right]) => left.localeCompare(right),
      )
      for (const [author, contexts] of sortedAuthors) {
        for (const statement of visibleStatements(
          contexts,
          options.context,
          now,
        )) {
          if (statement.value !== 1 && statement.value !== -1) continue
          if (!valueMatches(statement.value, valueFilter)) continue
          const fromMeta = classifySubject({ type: 'p', value: author })
          pushEdge(
            fromMeta.id,
            fromMeta,
            parsed.node,
            statement.value,
            statement.context,
            statement.eventId,
          )
          if (truncated) break
        }
        if (truncated) break
      }
    }

    const nodeList = [...nodes.values()].sort(
      (a, b) => a.depth - b.depth || a.id.localeCompare(b.id),
    )
    return {
      graphVersion: this.graphVersion,
      centerId: parsed.node.id,
      truncated,
      nodes: nodeList,
      edges,
    }
  }

  resolveStatement(
    author: string,
    subject: TrustSubject,
    requestedContext: string,
    now: number,
  ): ResolvedGraphStatement | undefined {
    const contexts = this.byAuthor.get(author)?.get(subjectKey(subject))
    if (!contexts) {
      return undefined
    }

    for (const candidate of contextCandidates(requestedContext)) {
      const statement = contexts.get(candidate.context)
      if (!statement) {
        continue
      }
      if (statement.value === 0 || !isActive(statement, now)) {
        return undefined
      }
      return { statement, contextMatch: candidate.match }
    }
    return undefined
  }

  traversableStatements(
    author: string,
    requestedContext: string,
    now: number,
  ): ResolvedGraphStatement[] {
    const subjects = this.byAuthor.get(author)
    if (!subjects) {
      return []
    }

    const resolved: ResolvedGraphStatement[] = []
    const keys = [...subjects.keys()].filter((key) => key.startsWith('p:'))
    keys.sort()

    for (const key of keys) {
      const contexts = subjects.get(key)
      if (!contexts) {
        continue
      }
      for (const candidate of contextCandidates(requestedContext)) {
        const statement = contexts.get(candidate.context)
        if (!statement) {
          continue
        }
        if (
          statement.value === 1 &&
          isActive(statement, now)
        ) {
          resolved.push({ statement, contextMatch: candidate.match })
        }
        break
      }
    }

    resolved.sort((left, right) => {
      const subjectOrder = left.statement.subject.value.localeCompare(
        right.statement.subject.value,
      )
      return (
        subjectOrder ||
        left.statement.eventId.localeCompare(right.statement.eventId)
      )
    })
    return resolved
  }

  private replaceStatement(statement: ReducedTrustStatement): boolean {
    const key = slotKey(statement)
    const current = this.slots.get(key)
    // Derived edges must never overwrite a real (non-derived) statement.
    if (current && statement.derivedFrom && !current.derivedFrom) {
      return false
    }
    if (current && !replaces(statement, current)) {
      return false
    }

    const stored = cloneStatement(statement)
    this.slots.set(key, stored)

    let subjects = this.byAuthor.get(stored.author)
    if (!subjects) {
      subjects = new Map()
      this.byAuthor.set(stored.author, subjects)
    }

    const keyForSubject = subjectKey(stored.subject)
    let contexts = subjects.get(keyForSubject)
    if (!contexts) {
      contexts = new Map()
      subjects.set(keyForSubject, contexts)
    }
    contexts.set(stored.context, stored)

    let authors = this.bySubject.get(keyForSubject)
    if (!authors) {
      authors = new Map()
      this.bySubject.set(keyForSubject, authors)
    }
    let reverseContexts = authors.get(stored.author)
    if (!reverseContexts) {
      reverseContexts = new Map()
      authors.set(stored.author, reverseContexts)
    }
    reverseContexts.set(stored.context, stored)
    return true
  }
}
