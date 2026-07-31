/**
 * Maps AttentionX ReducedTrustStatement (kind 32009) → Trust ITrustEvent for Graph.applyTrustEvent.
 */

import { parseNodeId, subjectNodeId } from '../shared/graph-deeplink'
import type { ReducedTrustStatement, TrustSubject } from './types'
import type { ITrustEvent, SubjectType } from './trust/types'

const KIND_32009 = 32009

/** Heap Graph node id = subject value (lowercased). Not the wire `type:value` id. */
export function graphSubjectId(subject: TrustSubject): string {
  return subject.value.toLowerCase()
}

/** Wire / cockpit node id (`p:…`, `i:user:id:…`). Same as deeplink `subjectNodeId`. */
export function wireNodeId(subject: TrustSubject): string {
  return subjectNodeId(subject)
}

export function slotAddressableId(statement: ReducedTrustStatement): string {
  const subject = statement.subject
  return [
    `${statement.author.length}:${statement.author}`,
    `${subject.type}:${subject.value.length}:${subject.value}`,
    `${statement.context.length}:${statement.context}`,
  ].join('|')
}

export function statementToTrustEvent(
  statement: ReducedTrustStatement,
): ITrustEvent {
  return {
    kind: KIND_32009,
    pubkey: statement.author.toLowerCase(),
    created_at: statement.createdAt,
    addressableId: slotAddressableId(statement),
    eventId: statement.eventId,
    value: statement.value,
    c_tag: statement.context,
    activate: statement.activeFrom,
    expire: statement.activeUntil,
    subjects: [
      {
        tag: statement.subject.type as SubjectType,
        value: statement.subject.value.toLowerCase(),
      },
    ],
  }
}

export function parseWireCenterId(centerId: string):
  | {
      graphId: string
      authorPubkey?: string
      subject?: TrustSubject
      wireId: string
      kind: 'pubkey' | 'twitter_id' | 'post' | 'other'
      label: string
    }
  | undefined {
  const subject = parseNodeId(centerId)
  if (!subject) return undefined

  const graphId = subject.value.toLowerCase()
  const meta = classifyTrustSubject(subject)
  if (subject.type === 'p') {
    return {
      graphId,
      authorPubkey: graphId,
      subject,
      wireId: centerId,
      kind: 'pubkey',
      label: meta.label,
    }
  }
  return {
    graphId,
    subject,
    wireId: centerId,
    kind: meta.kind,
    label: meta.label,
  }
}

export function classifyTrustSubject(subject: TrustSubject): {
  id: string
  kind: 'pubkey' | 'twitter_id' | 'post' | 'other'
  label: string
} {
  if (subject.type === 'p') {
    return {
      id: wireNodeId(subject),
      kind: 'pubkey',
      label: `${subject.value.slice(0, 12)}…`,
    }
  }
  if (subject.type === 'i' && subject.value.startsWith('user:id:')) {
    return {
      id: wireNodeId(subject),
      kind: 'twitter_id',
      label: `X · ${subject.value.slice('user:id:'.length)}`,
    }
  }
  if (subject.type === 'i' && subject.value.startsWith('post:id:')) {
    return {
      id: wireNodeId(subject),
      kind: 'post',
      label: `Post · ${subject.value.slice('post:id:'.length)}`,
    }
  }
  if (subject.type === 'e') {
    return {
      id: wireNodeId(subject),
      kind: 'post',
      label: `Event · ${subject.value.slice(0, 12)}…`,
    }
  }
  return {
    id: wireNodeId(subject),
    kind: 'other',
    label: `${subject.type}:${subject.value.slice(0, 24)}`,
  }
}
