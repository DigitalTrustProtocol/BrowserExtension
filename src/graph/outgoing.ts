import { parseCanonicalTwitterSubject } from '../shared/x-identity'
import { cloneLabelHints } from '../shared/kind-32009'
import type {
  ReducedTrustStatement,
  ResolvedStatement,
} from './types'

/** Cap for outgoing user:id statements returned to Notes. */
export const MAX_OUTGOING_TRUST_STATEMENTS = 200

function authorKey(author: string): string {
  return author.trim().toLowerCase()
}

/** True when this winner is an active user:id statement by one of `authorPubkeys`. */
export function isOutgoingUserStatement(
  statement: Pick<ReducedTrustStatement, 'author' | 'subject' | 'value'>,
  authorPubkeys: ReadonlySet<string>,
): boolean {
  if (!authorPubkeys.has(authorKey(statement.author))) return false
  if (statement.subject.type !== 'i') return false
  const parsed = parseCanonicalTwitterSubject(statement.subject.value)
  if (parsed?.type !== 'account') return false
  switch (statement.value) {
    case 1:
    case 0:
    case -1:
      return true
    default: {
      const _exhaustive: never = statement.value
      return _exhaustive
    }
  }
}

export function toOutgoingResolvedStatement(
  statement: ReducedTrustStatement,
): ResolvedStatement {
  const labelHints = cloneLabelHints(statement.labelHints)
  return {
    eventId: statement.eventId,
    author: statement.author,
    subject: { ...statement.subject },
    context: statement.context,
    requestedContext: statement.context,
    contextMatch: 'exact',
    value: statement.value,
    createdAt: statement.createdAt,
    ...(statement.activeFrom !== undefined
      ? { activeFrom: statement.activeFrom }
      : {}),
    ...(statement.activeUntil !== undefined
      ? { activeUntil: statement.activeUntil }
      : {}),
    ...(statement.content !== undefined && statement.content !== ''
      ? { content: statement.content }
      : {}),
    ...(statement.labels !== undefined && statement.labels.length > 0
      ? { labels: [...statement.labels] }
      : {}),
    ...(labelHints !== undefined ? { labelHints } : {}),
    distance: 0,
    ...(statement.derivedFrom
      ? { derivedFrom: { ...statement.derivedFrom } }
      : {}),
  }
}

export function selectOutgoingUserStatements(
  statements: readonly ReducedTrustStatement[],
  authorPubkeys: ReadonlySet<string>,
): {
  statements: ResolvedStatement[]
  truncated: boolean
} {
  const authors = new Set(
    [...authorPubkeys].map((pubkey) => authorKey(pubkey)).filter(Boolean),
  )
  if (authors.size === 0) {
    return { statements: [], truncated: false }
  }
  const matched: ResolvedStatement[] = []
  for (const statement of statements) {
    if (!isOutgoingUserStatement(statement, authors)) continue
    matched.push(toOutgoingResolvedStatement(statement))
  }
  const truncated = matched.length > MAX_OUTGOING_TRUST_STATEMENTS
  return {
    statements: truncated
      ? matched.slice(0, MAX_OUTGOING_TRUST_STATEMENTS)
      : matched,
    truncated,
  }
}

export function outgoingTargetTwitterId(
  statement: Pick<ResolvedStatement, 'subject'>,
): string | undefined {
  if (statement.subject.type !== 'i') return undefined
  const parsed = parseCanonicalTwitterSubject(statement.subject.value)
  return parsed?.type === 'account' ? parsed.twitterId : undefined
}
