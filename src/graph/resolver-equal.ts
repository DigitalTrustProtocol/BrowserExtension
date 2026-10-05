/**
 * Shared resolver-equality fixtures. The extension IndexResolver is the
 * oracle: expects in TrustGraph/corpus/resolver/equal.json are its scores.
 *
 * Load rules (every runner, before resolve):
 * - Expand `@name` to sha256(name) hex.
 * - Apply records in order. A record with `delete` replaces that slot and
 *   carries no value.
 * - Binds are a lookup, not a second walk. Lenient binds `user:id` when own
 *   evidence exists (bio before post) or, if none, when a witness exists
 *   (`32009`, `v=1`, `hint` ≠ author). Strict writes that same candidate
 *   only when `claims` names that pubkey for the X id.
 * - `deadline` is how many degrees may start. It is not wall-clock time.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { Graph } from './trust/Graph'
import { indexResolver } from './trust'
import { RatingScore, TrustScore, type Score } from './trust/Score'
import { TRUST_STATEMENT_KIND } from '../lib/nostr/kind-32009'
import type { EventRecord } from '../storage/types'

export const RESOLVER_CORPUS = 'dtp-resolver-equal/1'

const PLACEHOLDER = /@([A-Za-z0-9_.-]+)/g

export type Mode = 'lenient' | 'strict'
export type Format = 'default' | 'path'
export type SubjectType = 'p' | 'i'

export interface FixtureRecord {
  id: string
  from: string
  to: string
  toType?: SubjectType
  kind?: 32009 | 32014
  /** Absent when `delete` is set. */
  value?: number
  delete?: boolean
  /** Slot identity. Defaults to `id`. A delete uses the slot it replaces. */
  slot?: string
  context?: string
  createdAt?: number
  activate?: number
  expire?: number
  hint?: string
  scopeRank?: number
}

export interface OwnEvidence {
  i: string
  pubkey: string
  source: 'bio' | 'post'
}

export interface Claim {
  pubkey: string
  twitterId: string
}

export interface FixtureQuery {
  root: string
  subject: string
  subjectType?: SubjectType
  kind?: 32009 | 32014
  context?: string
  trustContext?: string
  maxDepth?: number
  threshold?: number
  now?: number
  deadline?: number
  format?: Format
}

export interface FixtureCase {
  id: string
  mode?: Mode
  records: FixtureRecord[]
  ownEvidence?: OwnEvidence[]
  claims?: Claim[]
  queries: FixtureQuery[]
}

export interface ScoreExpect {
  id: string
  connected: boolean
  degree: number
  count: number
  eventIds: string[]
  trust?: number
  distrust?: number
  neutral?: number
  trustValue?: number
  ratingValue?: number
}

export interface QueryExpect {
  truncated?: 'time'
  scores: ScoreExpect[]
}

export interface StoredQuery extends FixtureQuery {
  expect: QueryExpect
}

export interface StoredCase extends Omit<FixtureCase, 'queries'> {
  mode: Mode
  queries: StoredQuery[]
}

export interface ResolverCorpus {
  corpus: typeof RESOLVER_CORPUS
  clock: 'degree-starts'
  cases: StoredCase[]
}

export function placeholderHex(name: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(name)))
}

export function expandPlaceholders<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(PLACEHOLDER, (_match, name: string) => placeholderHex(name)) as T
  }
  if (Array.isArray(value)) return value.map((item) => expandPlaceholders(item)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      out[key] = expandPlaceholders(item)
    }
    return out as T
  }
  return value
}

/** `@name` hex → `@name`, so expects stay readable. */
export function placeholderReverse(value: unknown): Map<string, string> {
  const reverse = new Map<string, string>()
  const visit = (item: unknown): void => {
    if (typeof item === 'string') {
      for (const match of item.matchAll(PLACEHOLDER)) {
        const name = match[1]
        if (name) reverse.set(placeholderHex(name), `@${name}`)
      }
      return
    }
    if (Array.isArray(item)) {
      for (const child of item) visit(child)
      return
    }
    if (item && typeof item === 'object') {
      for (const child of Object.values(item)) visit(child)
    }
  }
  visit(value)
  return reverse
}

export interface AppliedBind {
  i: string
  pubkey: string
}

/** The bind lookup for this mode. Same inputs, same list, on every runtime. */
export function decideBinds(
  mode: Mode,
  records: readonly FixtureRecord[],
  ownEvidence: readonly OwnEvidence[],
  claims: readonly Claim[],
): AppliedBind[] {
  const witnesses = records.filter(
    (record) =>
      (record.kind ?? TRUST_STATEMENT_KIND) === TRUST_STATEMENT_KIND &&
      record.delete !== true &&
      record.value === 1 &&
      (record.toType ?? 'p') === 'i' &&
      record.to.startsWith('user:id:') &&
      record.hint !== undefined &&
      record.hint !== record.from,
  )
  const subjects = new Set<string>()
  for (const own of ownEvidence) subjects.add(own.i)
  for (const witness of witnesses) subjects.add(witness.to)
  const binds: AppliedBind[] = []
  for (const i of [...subjects].sort()) {
    const owns = ownEvidence.filter((own) => own.i === i)
    const bio = owns.find((own) => own.source === 'bio')
    const post = owns.find((own) => own.source === 'post')
    let pubkey = bio?.pubkey ?? post?.pubkey
    if (!pubkey) {
      const ranked = witnesses
        .filter((witness) => witness.to === i)
        .sort((a, b) => a.from.localeCompare(b.from) || a.id.localeCompare(b.id))
      pubkey = ranked[0]?.hint
    }
    if (!pubkey) continue
    const twitterId = i.slice('user:id:'.length)
    if (
      mode === 'strict' &&
      !claims.some((claim) => claim.pubkey === pubkey && claim.twitterId === twitterId)
    ) {
      continue
    }
    binds.push({ i, pubkey })
  }
  return binds
}

export function recordToEvent(record: FixtureRecord): EventRecord & { hintPubkey?: string; scopeRank?: number } {
  const kind = record.kind ?? TRUST_STATEMENT_KIND
  const slot = record.slot ?? record.id
  const pubkey = record.from
  return {
    id: record.id,
    pubkey,
    created_at: record.createdAt ?? 1,
    kind,
    tags: [],
    content: '',
    sig: '',
    firstSeenAt: 0,
    addressKey: `${kind}:${pubkey}:${slot}`,
    subject: record.to,
    subjectType: record.toType ?? 'p',
    c_tag: record.context ?? 'identity',
    addressableId: slot,
    ...(record.delete === true ? {} : { nValue: record.value ?? 0 }),
    ...(record.activate !== undefined ? { activate: record.activate } : {}),
    ...(record.expire !== undefined ? { expire: record.expire } : {}),
    ...(record.hint !== undefined ? { hintPubkey: record.hint } : {}),
    ...(record.scopeRank !== undefined ? { scopeRank: record.scopeRank } : {}),
  }
}

export function loadHeap(spec: FixtureCase): Graph {
  const graph = new Graph()
  for (const record of spec.records) {
    graph.applyTrustEvent(recordToEvent(record))
  }
  const mode = spec.mode ?? 'lenient'
  for (const bind of decideBinds(mode, spec.records, spec.ownEvidence ?? [], spec.claims ?? [])) {
    graph.bindIdentity(bind.i, bind.pubkey)
  }
  return graph
}

function nodeName(graph: Graph, score: Score, reverse: Map<string, string>): string {
  const raw =
    score.subjectIndex !== undefined
      ? (graph.nodesList[score.subjectIndex]?.id ?? score.subject ?? '')
      : (score.subject ?? '')
  return reverse.get(raw) ?? raw
}

function eventName(graph: Graph, index: number, reverse: Map<string, string>): string | undefined {
  const id = graph.edgesList[index]?.id
  if (!id) return undefined
  return reverse.get(id) ?? id
}

export function summarizeScores(
  graph: Graph,
  scores: readonly Score[],
  reverse: Map<string, string>,
): ScoreExpect[] {
  const rows = scores.map((score) => {
    const eventIds = (score.edges ?? [])
      .map((index) => eventName(graph, index, reverse))
      .filter((id): id is string => id !== undefined)
      .sort()
    const row: ScoreExpect = {
      id: nodeName(graph, score, reverse),
      connected: score.connected,
      degree: score.degree,
      count: score.count,
      eventIds,
    }
    if (score instanceof TrustScore) {
      row.trust = score.trust
      row.distrust = score.distrust
      row.neutral = score.neutral
      row.trustValue = score.trustValue
    }
    if (score instanceof RatingScore) row.ratingValue = score.ratingValue
    return row
  })
  rows.sort((a, b) => a.id.localeCompare(b.id) || a.eventIds.join().localeCompare(b.eventIds.join()))
  return rows
}

export function runQuery(
  graph: Graph,
  query: FixtureQuery,
  reverse: Map<string, string>,
): QueryExpect {
  const timeStop: { truncated?: 'time' } = {}
  const kind = query.kind ?? TRUST_STATEMENT_KIND
  const scores = indexResolver.resolve(query.root, query.subject, {
    graph,
    format: query.format ?? 'default',
    kind,
    trustContext: query.trustContext ?? 'identity',
    scoreContext: query.context ?? 'identity',
    maxDepth: query.maxDepth ?? 4,
    followTrustThreshold: query.threshold ?? 75,
    now: query.now ?? 100,
    ...(query.deadline !== undefined ? { deadline: query.deadline } : {}),
    timeStop,
  })
  const expect: QueryExpect = { scores: summarizeScores(graph, scores, reverse) }
  if (timeStop.truncated === 'time') expect.truncated = 'time'
  return expect
}

export function materializeCase(spec: FixtureCase): StoredCase {
  const reverse = placeholderReverse(spec)
  const expanded = expandPlaceholders(spec)
  const graph = loadHeap(expanded)
  return {
    id: spec.id,
    mode: spec.mode ?? 'lenient',
    records: spec.records,
    ...(spec.ownEvidence !== undefined ? { ownEvidence: spec.ownEvidence } : {}),
    ...(spec.claims !== undefined ? { claims: spec.claims } : {}),
    queries: spec.queries.map((query) => ({
      ...query,
      expect: runQuery(graph, expandPlaceholders(query), reverse),
    })),
  }
}

export function materializeCorpus(cases: readonly FixtureCase[]): ResolverCorpus {
  return {
    corpus: RESOLVER_CORPUS,
    clock: 'degree-starts',
    cases: cases.map((spec) => materializeCase(spec)),
  }
}
