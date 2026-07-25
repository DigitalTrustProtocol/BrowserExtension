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
    return true
  }
}
