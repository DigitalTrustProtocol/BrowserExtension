import {
  getEventHash,
  validateEvent,
  verifyEvent,
  type Event,
  type EventTemplate,
} from 'nostr-tools'
import { parseCanonicalTwitterSubject } from './x-identity'

export const TRUST_STATEMENT_KIND = 32009
export const TRUST_STATEMENT_CONTENT_LIMIT = 1024
export const TRUST_CONTEXT_BYTE_LIMIT = 128

const HEX_64 = /^[0-9a-f]{64}$/
const CONTEXT_GRAMMAR =
  /^[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._-]*)*$/
const UNIX_SECONDS = /^\d+$/
const RESERVED_TAGS = new Set(['d', 'p', 'e', 'i', 'v', 'c', 'x', 'y'])

export type TrustValue = '1' | '0' | '-1'
export type TrustSubject =
  | { type: 'p'; value: string }
  | { type: 'e'; value: string }
  | { type: 'i'; value: string }
export type TrustStatementActiveStatus =
  | 'active'
  | 'cancelled'
  | 'not_yet_active'
  | 'expired'

export interface BuildKind32009Input {
  subject: TrustSubject
  value: TrustValue
  context?: string
  activationTime?: number
  expirationTime?: number
  content?: string
  createdAt: number
  extraTags?: string[][]
}

export interface ParsedKind32009 {
  event: Event
  d: string
  subject: TrustSubject
  value: TrustValue
  context: string
  activationTime?: number
  expirationTime?: number
}

export interface Kind32009ValidationOptions {
  verifyEvent?: boolean
}

export type Kind32009ValidationResult =
  | { valid: true; statement: ParsedKind32009 }
  | { valid: false; errors: string[] }

export interface ReducedKind32009 {
  statements: ParsedKind32009[]
  rejected: Array<{ event: Event; errors: string[] }>
}

export class Kind32009ValidationError extends Error {
  readonly errors: string[]

  constructor(errors: string[]) {
    super(errors.join('; '))
    this.name = 'Kind32009ValidationError'
    this.errors = errors
  }
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function unicodeCharacterLength(value: string): number {
  return [...value].length
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return bytesToHex(digest)
}

export function isCanonicalTrustContext(context: string): boolean {
  return (
    context === '' ||
    (utf8Length(context) <= TRUST_CONTEXT_BYTE_LIMIT &&
      CONTEXT_GRAMMAR.test(context))
  )
}

export function contextFallbackChain(context: string): string[] {
  if (!isCanonicalTrustContext(context)) {
    throw new Error('Context is not canonical')
  }

  if (context === '') {
    return ['']
  }

  const segments = context.split(':')
  const contexts: string[] = []
  for (let length = segments.length; length > 0; length -= 1) {
    contexts.push(segments.slice(0, length).join(':'))
  }
  contexts.push('')
  return contexts
}

export function canonicalizeWebUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Web subject must contain an absolute URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Web subject URL must use http or https')
  }

  url.hash = ''
  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = ''
  }

  return url.toString()
}

function validateIdentifierSubject(value: string): string | undefined {
  if (parseCanonicalTwitterSubject(value)) {
    return undefined
  }

  if (value.startsWith('ext:twitter_id:')) {
    return 'twitter_id subject must end in decimal digits'
  }
  if (value.startsWith('ext:twitter_post:')) {
    return 'twitter_post subject must end in decimal digits'
  }
  if (/^hash:[0-9a-f]{64}$/.test(value)) {
    return undefined
  }
  if (value.startsWith('hash:')) {
    return 'Hash subject must contain 64 lowercase hexadecimal characters'
  }
  if (value.startsWith('web:')) {
    const rawUrl = value.slice(4)
    try {
      return canonicalizeWebUrl(rawUrl) === rawUrl
        ? undefined
        : 'Web subject URL is not canonical'
    } catch (error) {
      return error instanceof Error ? error.message : 'Invalid web subject'
    }
  }
  if (/^nostr:(?:profile|pubkey):[0-9a-f]{64}$/.test(value)) {
    return undefined
  }
  if (value.startsWith('nostr:addr:')) {
    const address = /^(0|[1-9]\d*):([0-9a-f]{64}):(.*)$/.exec(
      value.slice('nostr:addr:'.length),
    )
    if (
      address &&
      Number.isSafeInteger(Number(address[1]))
    ) {
      return undefined
    }
    return 'Nostr address subject must contain a canonical kind:pubkey:identifier coordinate'
  }
  if (/^ext:[a-z0-9][a-z0-9._-]*:[^\s]+$/.test(value)) {
    return undefined
  }

  return 'Identifier subject must be a normalized typed identifier'
}

export function getTrustSubjectValidationError(
  subject: TrustSubject,
): string | undefined {
  if (subject.type === 'p' || subject.type === 'e') {
    return HEX_64.test(subject.value)
      ? undefined
      : `${subject.type} subject must contain 64 lowercase hexadecimal characters`
  }

  if (subject.type === 'i') {
    return validateIdentifierSubject(subject.value)
  }

  return 'Unsupported subject tag'
}

export async function buildKind32009D(
  subject: TrustSubject,
  context = '',
): Promise<string> {
  const subjectError = getTrustSubjectValidationError(subject)
  if (subjectError) {
    throw new Error(subjectError)
  }
  if (!isCanonicalTrustContext(context)) {
    throw new Error('Context is not canonical')
  }

  const subjectId = HEX_64.test(subject.value)
    ? subject.value
    : await sha256Hex(subject.value)
  return context === '' ? subjectId : `${subjectId}:${context}`
}

function formatUnixSeconds(value: number, name: string): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return String(value)
}

function validateBuildInput(input: BuildKind32009Input): void {
  const subjectError = getTrustSubjectValidationError(input.subject)
  if (subjectError) {
    throw new Error(subjectError)
  }
  if (!['1', '0', '-1'].includes(input.value)) {
    throw new Error('Trust value must be 1, 0, or -1')
  }
  if (!isCanonicalTrustContext(input.context ?? '')) {
    throw new Error('Context is not canonical')
  }
  if (
    unicodeCharacterLength(input.content ?? '') >
    TRUST_STATEMENT_CONTENT_LIMIT
  ) {
    throw new Error(
      `Content must not exceed ${TRUST_STATEMENT_CONTENT_LIMIT} Unicode characters`,
    )
  }
  formatUnixSeconds(input.createdAt, 'createdAt')
  if (input.activationTime !== undefined) {
    formatUnixSeconds(input.activationTime, 'activationTime')
  }
  if (input.expirationTime !== undefined) {
    formatUnixSeconds(input.expirationTime, 'expirationTime')
  }
  if (
    input.activationTime !== undefined &&
    input.expirationTime !== undefined &&
    input.activationTime > input.expirationTime
  ) {
    throw new Error('activationTime must be less than or equal to expirationTime')
  }
  for (const tag of input.extraTags ?? []) {
    if (
      !Array.isArray(tag) ||
      tag.length === 0 ||
      tag.some((part) => typeof part !== 'string')
    ) {
      throw new Error('Extra tags must be non-empty arrays of strings')
    }
    if (RESERVED_TAGS.has(tag[0])) {
      throw new Error(`Extra tags must not contain reserved ${tag[0]} tags`)
    }
  }
}

export async function buildKind32009Event(
  input: BuildKind32009Input,
): Promise<EventTemplate> {
  validateBuildInput(input)
  const context = input.context ?? ''
  const tags: string[][] = [
    ['d', await buildKind32009D(input.subject, context)],
    [input.subject.type, input.subject.value],
  ]

  if (context !== '') {
    tags.push(['c', context])
  }
  tags.push(['v', input.value])
  if (input.activationTime !== undefined) {
    tags.push(['x', formatUnixSeconds(input.activationTime, 'activationTime')])
  }
  if (input.expirationTime !== undefined) {
    tags.push(['y', formatUnixSeconds(input.expirationTime, 'expirationTime')])
  }
  tags.push(...(input.extraTags ?? []).map((tag) => [...tag]))

  return {
    kind: TRUST_STATEMENT_KIND,
    created_at: input.createdAt,
    content: input.content ?? '',
    tags,
  }
}

function tagsNamed(event: Event, name: string): string[][] {
  return event.tags.filter((tag) => tag[0] === name)
}

function parseUnixSeconds(
  tag: string[] | undefined,
  name: string,
  errors: string[],
): number | undefined {
  if (!tag) {
    return undefined
  }
  if (tag.length !== 2 || !UNIX_SECONDS.test(tag[1])) {
    errors.push(`${name} tag must contain one base-10 Unix-second integer`)
    return undefined
  }

  const parsed = Number(tag[1])
  if (!Number.isSafeInteger(parsed)) {
    errors.push(`${name} tag exceeds the safe integer range`)
    return undefined
  }
  return parsed
}

function cloneEventWithoutVerificationCache(event: Event): Event {
  return {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags.map((tag) => [...tag]),
    content: event.content,
    sig: event.sig,
  }
}

async function inspectKind32009(
  event: Event,
  options: Kind32009ValidationOptions,
): Promise<{ errors: string[]; statement?: ParsedKind32009 }> {
  const errors: string[] = []
  if (!validateEvent(event)) {
    return { errors: ['Event does not have a valid Nostr event shape'] }
  }
  if (event.kind !== TRUST_STATEMENT_KIND) {
    errors.push(`Event kind must be ${TRUST_STATEMENT_KIND}`)
  }
  if (!Number.isSafeInteger(event.created_at) || event.created_at < 0) {
    errors.push('created_at must be a non-negative safe integer')
  }
  if (unicodeCharacterLength(event.content) > TRUST_STATEMENT_CONTENT_LIMIT) {
    errors.push(
      `Content must not exceed ${TRUST_STATEMENT_CONTENT_LIMIT} Unicode characters`,
    )
  }

  if (options.verifyEvent !== false) {
    if (!HEX_64.test(event.id)) {
      errors.push('Event id must be 64 lowercase hexadecimal characters')
    } else {
      const uncachedEvent = cloneEventWithoutVerificationCache(event)
      if (getEventHash(uncachedEvent) !== event.id) {
        errors.push('Event id does not match its serialized event hash')
      } else if (!verifyEvent(uncachedEvent)) {
        errors.push('Event signature is invalid')
      }
    }
  }

  const dTags = tagsNamed(event, 'd')
  const subjectTags = event.tags.filter((tag) =>
    ['p', 'e', 'i'].includes(tag[0]),
  )
  const valueTags = tagsNamed(event, 'v')
  const contextTags = tagsNamed(event, 'c')
  const activationTags = tagsNamed(event, 'x')
  const expirationTags = tagsNamed(event, 'y')

  if (dTags.length !== 1 || dTags[0]?.length !== 2) {
    errors.push('Event must contain exactly one two-element d tag')
  }
  if (subjectTags.length !== 1 || subjectTags[0]?.length !== 2) {
    errors.push('Event must contain exactly one two-element subject tag')
  }
  if (valueTags.length !== 1 || valueTags[0]?.length !== 2) {
    errors.push('Event must contain exactly one two-element v tag')
  }
  if (
    contextTags.length > 1 ||
    (contextTags.length === 1 && contextTags[0].length !== 2)
  ) {
    errors.push('Event may contain at most one two-element c tag')
  }
  if (
    activationTags.length > 1 ||
    (activationTags.length === 1 && activationTags[0].length !== 2)
  ) {
    errors.push('Event may contain at most one two-element x tag')
  }
  if (
    expirationTags.length > 1 ||
    (expirationTags.length === 1 && expirationTags[0].length !== 2)
  ) {
    errors.push('Event may contain at most one two-element y tag')
  }

  const context = contextTags[0]?.[1] ?? ''
  if (!isCanonicalTrustContext(context)) {
    errors.push('Context is not canonical')
  }

  const subjectTag = subjectTags[0]
  const subject = subjectTag
    ? ({
        type: subjectTag[0] as TrustSubject['type'],
        value: subjectTag[1],
      } as TrustSubject)
    : undefined
  if (subject) {
    const subjectError = getTrustSubjectValidationError(subject)
    if (subjectError) {
      errors.push(subjectError)
    }
  }

  const value = valueTags[0]?.[1]
  if (value !== '1' && value !== '0' && value !== '-1') {
    errors.push('Trust value must be 1, 0, or -1')
  }

  const activationTime = parseUnixSeconds(
    activationTags[0],
    'x',
    errors,
  )
  const expirationTime = parseUnixSeconds(
    expirationTags[0],
    'y',
    errors,
  )
  if (
    activationTime !== undefined &&
    expirationTime !== undefined &&
    activationTime > expirationTime
  ) {
    errors.push('x must be less than or equal to y')
  }

  if (
    dTags.length === 1 &&
    dTags[0].length === 2 &&
    subject &&
    !getTrustSubjectValidationError(subject) &&
    isCanonicalTrustContext(context)
  ) {
    const expectedD = await buildKind32009D(subject, context)
    if (dTags[0][1] !== expectedD) {
      errors.push('d tag does not match the subject and context')
    }
  }

  if (
    errors.length === 0 &&
    subject &&
    (value === '1' || value === '0' || value === '-1')
  ) {
    return {
      errors,
      statement: {
        event,
        d: dTags[0][1],
        subject,
        value,
        context,
        activationTime,
        expirationTime,
      },
    }
  }
  return { errors }
}

export async function validateKind32009Event(
  event: unknown,
  options: Kind32009ValidationOptions = {},
): Promise<Kind32009ValidationResult> {
  if (
    typeof event !== 'object' ||
    event === null ||
    !('id' in event) ||
    !('sig' in event)
  ) {
    return { valid: false, errors: ['A complete signed Nostr event is required'] }
  }

  const inspection = await inspectKind32009(event as Event, options)
  return inspection.statement
    ? { valid: true, statement: inspection.statement }
    : { valid: false, errors: inspection.errors }
}

export async function parseKind32009Event(
  event: Event,
  options: Kind32009ValidationOptions = {},
): Promise<ParsedKind32009> {
  const result = await validateKind32009Event(event, options)
  if (!result.valid) {
    throw new Kind32009ValidationError(result.errors)
  }
  return result.statement
}

export function isNewerKind32009Replacement(
  candidate: ParsedKind32009,
  current: ParsedKind32009,
): boolean {
  if (
    candidate.event.pubkey !== current.event.pubkey ||
    candidate.d !== current.d
  ) {
    throw new Error('Replacement candidates must have the same author and d tag')
  }
  return (
    candidate.event.created_at > current.event.created_at ||
    (candidate.event.created_at === current.event.created_at &&
      candidate.event.id < current.event.id)
  )
}

export async function reduceKind32009Events(
  events: readonly Event[],
  options: Kind32009ValidationOptions = {},
): Promise<ReducedKind32009> {
  const byAddress = new Map<string, ParsedKind32009>()
  const rejected: ReducedKind32009['rejected'] = []

  for (const event of events) {
    const result = await validateKind32009Event(event, options)
    if (!result.valid) {
      rejected.push({ event, errors: result.errors })
      continue
    }

    const key = `${event.pubkey}:${result.statement.d}`
    const current = byAddress.get(key)
    if (
      !current ||
      isNewerKind32009Replacement(result.statement, current)
    ) {
      byAddress.set(key, result.statement)
    }
  }

  return {
    statements: [...byAddress.values()].sort(
      (left, right) =>
        right.event.created_at - left.event.created_at ||
        left.event.id.localeCompare(right.event.id),
    ),
    rejected,
  }
}

export function getTrustStatementActiveStatus(
  statement: ParsedKind32009,
  now: number,
): TrustStatementActiveStatus {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('now must be a non-negative safe integer')
  }
  if (statement.value === '0') {
    return 'cancelled'
  }
  if (
    statement.activationTime !== undefined &&
    now < statement.activationTime
  ) {
    return 'not_yet_active'
  }
  if (
    statement.expirationTime !== undefined &&
    now > statement.expirationTime
  ) {
    return 'expired'
  }
  return 'active'
}

export function isTrustStatementActive(
  statement: ParsedKind32009,
  now: number,
): boolean {
  return getTrustStatementActiveStatus(statement, now) === 'active'
}

export function resolveTrustStatementContext(
  statements: readonly ParsedKind32009[],
  requestedContext: string,
): ParsedKind32009 | undefined {
  for (const context of contextFallbackChain(requestedContext)) {
    const statement = statements.find((candidate) => candidate.context === context)
    if (statement) {
      return statement
    }
  }
  return undefined
}

// Concise aliases for consumers that name the protocol by its role.
export const buildTrustStatementEvent = buildKind32009Event
export const parseTrustStatementEvent = parseKind32009Event
export const validateTrustStatementEvent = validateKind32009Event
export const reduceTrustStatementEvents = reduceKind32009Events
