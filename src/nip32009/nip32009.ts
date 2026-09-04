/**
 * AttentionX working trust event: IndexedDB `EventRecord` → heap `ITrustEvent`.
 * Slot id is author|subject|context — not NIP-32010 pubkey+d_tag.
 */

import {
  TRUST_STATEMENT_CONTENT_LIMIT,
  cloneLabelHints,
  getTrustSubjectValidationError,
  isCanonicalTrustLabel,
  parseHumanLabelTags,
  type TrustSubject,
} from '../shared/kind-32009'
import { sanitizeTrustContent } from '../shared/trust-content'
import type { EventRecord } from '../storage/types'
import type {
  ExtractedSubject,
  GraphTrustValue,
  ITrustEvent as HeapTrustEvent,
  SubjectType,
} from '../graph/trust/types'
import type { ReducedTrustStatement } from '../graph/types'

export const KIND_TRUST = 32009

export type { ExtractedSubject, GraphTrustValue, SubjectType }

/** Heap-compatible trust event; extra signed fields are ignored by Graph. */
export interface ITrustEvent extends HeapTrustEvent {
  id?: string
  tags?: string[][]
  sig?: string
}

const UNIX_SECONDS = /^\d+$/
const SUBJECT_TAGS = new Set(['p', 'e', 'i'])

function tagsNamed(tags: readonly string[][], name: string): string[][] {
  return tags.filter((tag) => tag[0] === name)
}

function parseUnixSeconds(tag: string[] | undefined): number | undefined {
  if (!tag || tag.length !== 2 || !UNIX_SECONDS.test(tag[1])) return undefined
  const parsed = Number(tag[1])
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

export function slotAddressableId(
  author: string,
  subject: { type: string; value: string },
  context: string,
): string {
  return [
    `${author.length}:${author}`,
    `${subject.type}:${subject.value.length}:${subject.value}`,
    `${context.length}:${context}`,
  ].join('|')
}

export function statementToTrustEvent(
  statement: ReducedTrustStatement,
): ITrustEvent {
  const labelHints = cloneLabelHints(statement.labelHints)
  return {
    kind: KIND_TRUST,
    pubkey: statement.author.toLowerCase(),
    created_at: statement.createdAt,
    addressableId: slotAddressableId(
      statement.author,
      statement.subject,
      statement.context,
    ),
    eventId: statement.eventId,
    value: statement.value,
    c_tag: statement.context,
    activate: statement.activeFrom,
    expire: statement.activeUntil,
    ...(statement.content !== undefined ? { content: statement.content } : {}),
    ...(statement.labels !== undefined ? { labels: [...statement.labels] } : {}),
    ...(labelHints !== undefined ? { labelHints } : {}),
    subjects: [
      {
        tag: statement.subject.type as SubjectType,
        value: statement.subject.value.toLowerCase(),
      },
    ],
  }
}

export function isTrustEventValid(event: ITrustEvent): boolean {
  if (event.kind !== KIND_TRUST) return false
  if (event.value !== 1 && event.value !== 0 && event.value !== -1) return false
  if (event.subjects.length === 0) return false
  if (event.addressableId.length === 0) return false
  if (event.pubkey.length === 0) return false
  if (event.eventId.length === 0) return false
  return true
}

export function cloneTrustEvent(event: ITrustEvent): ITrustEvent {
  const labelHints = cloneLabelHints(event.labelHints)
  return {
    ...event,
    subjects: event.subjects.map((subject) => ({ ...subject })),
    ...(event.labels !== undefined ? { labels: [...event.labels] } : {}),
    ...(labelHints !== undefined ? { labelHints } : {}),
  }
}

/**
 * Fill one heap event from a stored winner. Empty `v` (tombstone) returns
 * undefined — Delete never enters the graph.
 */
export function asTrustEvent(record: EventRecord): ITrustEvent | undefined {
  return parseTrustEvent(record, false)
}

/**
 * Slot identity for heap unapply. Empty `v` is included with dummy `value` 0
 * so Delete can remove the previous winner — do not apply this object.
 */
export function asTrustSlotEvent(record: EventRecord): ITrustEvent | undefined {
  return parseTrustEvent(record, true)
}

function parseTrustEvent(
  record: EventRecord,
  includeTombstone: boolean,
): ITrustEvent | undefined {
  if (record.kind !== KIND_TRUST) return undefined

  const subjectTags = record.tags.filter((tag) => SUBJECT_TAGS.has(tag[0] ?? ''))
  const valueTags = tagsNamed(record.tags, 'v')
  if (subjectTags.length !== 1 || (subjectTags[0]?.length ?? 0) < 2) {
    return undefined
  }
  if (valueTags.length !== 1 || valueTags[0]?.length !== 2) return undefined

  const rawValue = valueTags[0][1]
  const live =
    rawValue === '1' || rawValue === '0' || rawValue === '-1'
  const tombstone = rawValue === ''
  if (!live && !(includeTombstone && tombstone)) return undefined

  const subjectTag = subjectTags[0]
  const subject: TrustSubject = {
    type: subjectTag[0] as TrustSubject['type'],
    value: subjectTag[1],
  }
  if (getTrustSubjectValidationError(subject)) return undefined

  const contextTags = tagsNamed(record.tags, 'c')
  if (contextTags.length > 1) return undefined
  const context = contextTags[0]?.[1] ?? ''

  const labelTags = tagsNamed(record.tags, 'l')
  const { labels, labelHints } = parseHumanLabelTags(
    labelTags,
    [],
    isCanonicalTrustLabel,
  )
  const hints = cloneLabelHints(labelHints)
  const content = sanitizeTrustContent(
    record.content,
    TRUST_STATEMENT_CONTENT_LIMIT,
  )
  const activate = parseUnixSeconds(tagsNamed(record.tags, 'x')[0])
  const expire = parseUnixSeconds(tagsNamed(record.tags, 'y')[0])
  const author = record.pubkey.toLowerCase()
  const subjectValue = subject.value.toLowerCase()

  return {
    kind: KIND_TRUST,
    pubkey: author,
    created_at: record.created_at,
    addressableId: slotAddressableId(
      record.pubkey,
      subject,
      context,
    ),
    eventId: record.id,
    value: (tombstone ? 0 : Number(rawValue)) as GraphTrustValue,
    c_tag: context,
    subjects: [{ tag: subject.type as SubjectType, value: subjectValue }],
    id: record.id,
    tags: record.tags,
    sig: record.sig,
    ...(content !== '' ? { content } : {}),
    ...(labels.length > 0 ? { labels: [...labels] } : {}),
    ...(hints !== undefined ? { labelHints: hints } : {}),
    ...(activate === undefined ? {} : { activate }),
    ...(expire === undefined ? {} : { expire }),
  }
}
