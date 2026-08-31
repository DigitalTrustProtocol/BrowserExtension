import { parseCanonicalTwitterSubject } from '../shared/x-identity'
import { cloneLabelHints } from '../shared/kind-32009'
import type {
  ReducedTrustStatement,
  ResolvedStatement,
  TrustSubject,
} from './types'

/** Cap for incoming 1-hop statements returned when WoT resolve is empty. */
export const MAX_INCOMING_TRUST_STATEMENTS = 200

function pubkeyKey(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * True when this winner targets the Notes user: `i:user:id` and/or a bound
 * npub (`p`). Graph neighborhood draws these 1-hop edges even when the
 * authors are outside the operator's last-degree WoT resolve.
 */
export function isIncomingUserStatement(
  statement: Pick<ReducedTrustStatement, 'subject' | 'value'>,
  options: {
    twitterId?: string
    pubkeyHexes: ReadonlySet<string>
  },
): boolean {
  switch (statement.value) {
    case 1:
    case 0:
    case -1:
      break
    default: {
      const _exhaustive: never = statement.value
      return _exhaustive
    }
  }
  const subject = statement.subject
  switch (subject.type) {
    case 'i': {
      if (!options.twitterId) return false
      const parsed = parseCanonicalTwitterSubject(subject.value)
      return parsed?.type === 'account' && parsed.twitterId === options.twitterId
    }
    case 'p':
      return options.pubkeyHexes.has(pubkeyKey(subject.value))
    case 'e':
      return false
    default: {
      const _exhaustive: never = subject
      return _exhaustive
    }
  }
}

export function toIncomingResolvedStatement(
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
    distance: 1,
    ...(statement.derivedFrom
      ? { derivedFrom: { ...statement.derivedFrom } }
      : {}),
  }
}

export function incomingSubjectKeys(subject: TrustSubject): {
  twitterId?: string
  pubkeyHexes: Set<string>
} {
  const pubkeyHexes = new Set<string>()
  switch (subject.type) {
    case 'p': {
      const hex = pubkeyKey(subject.value)
      if (/^[0-9a-f]{64}$/.test(hex)) pubkeyHexes.add(hex)
      return { pubkeyHexes }
    }
    case 'i': {
      const parsed = parseCanonicalTwitterSubject(subject.value)
      if (parsed?.type === 'account') {
        return { twitterId: parsed.twitterId, pubkeyHexes }
      }
      return { pubkeyHexes }
    }
    case 'e':
      return { pubkeyHexes }
    default: {
      const _exhaustive: never = subject
      return _exhaustive
    }
  }
}

export function selectIncomingUserStatements(
  statements: readonly ReducedTrustStatement[],
  options: {
    twitterId?: string
    pubkeyHexes: ReadonlySet<string>
  },
): {
  statements: ResolvedStatement[]
  truncated: boolean
} {
  if (!options.twitterId && options.pubkeyHexes.size === 0) {
    return { statements: [], truncated: false }
  }
  const matched: ResolvedStatement[] = []
  for (const statement of statements) {
    if (!isIncomingUserStatement(statement, options)) continue
    matched.push(toIncomingResolvedStatement(statement))
  }
  const truncated = matched.length > MAX_INCOMING_TRUST_STATEMENTS
  return {
    statements: truncated
      ? matched.slice(0, MAX_INCOMING_TRUST_STATEMENTS)
      : matched,
    truncated,
  }
}
