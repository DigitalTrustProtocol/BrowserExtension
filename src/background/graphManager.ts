/**
 * One-pass Dexie → heap load. Kind 32009 hops; kind 32014 claims never hops.
 */

import { ratingClaimSlotId } from '../graph/adapter'
import { normalizeResolveBounds } from '../graph/bounds'
import {
  clearIdentityDistrust,
  derivedPubkeyHop,
  isBlockedPubkeyHop,
  recordIdentityDistrust,
  updateIdentityDistrustBlock,
} from '../graph/derived-identity-hops'
import {
  neighborhoodFromHeap,
  type NeighborhoodOptions,
  type NeighborhoodResult,
} from '../graph/graph'
import { executeTrustQuery } from '../graph/query'
import { artifactRatingResolver } from '../graph/ratings/ArtifactRatingResolver'
import indexResolver from '../graph/trust/IndexResolver'
import type {
  RatingQuery,
  RatingQueryResult,
  ReducedRatingClaim,
  ReducedTrustStatement,
  ResolveBounds,
  TrustQuery,
  TrustQueryResult,
  TrustSubject,
} from '../graph/types'
import {
  primaryNpubFromRow,
  pubkeyFromNpub,
} from '../identity/x-identity-row'
import {
  asTrustEvent,
  asTrustSlotEvent,
  cloneTrustEvent,
  isTrustEventValid,
  statementToTrustEvent,
  type ITrustEvent,
} from '../nip32009/nip32009'
import {
  cloneLabelHints,
  getTrustSubjectValidationError,
  parseHumanLabelTags,
  TRUST_STATEMENT_CONTENT_LIMIT,
} from '../shared/kind-32009'
import {
  isCanonicalRatingLabel,
  parseRatingScoreValue,
  RATING_STATEMENT_KIND,
} from '../shared/kind-32014'
import { sanitizeTrustContent } from '../shared/trust-content'
import { WOT_MAX_DEGREE_DEFAULT } from '../shared/wot-max-degree'
import { DEMO_EVENT_STATE } from '../storage'
import type { EventRecord } from '../storage/types'
import type { RuntimeContext } from './runtimeContext'

const KIND_TRUST = 32009
const YIELD_EVERY = 256
const ESTIMATED_BYTES_PER_EVENT = 4096
const SUBJECT_TAGS = new Set(['p', 'e', 'i'])

function cloneStatement(
  statement: ReducedTrustStatement,
): ReducedTrustStatement {
  const labelHints = cloneLabelHints(statement.labelHints)
  return {
    ...statement,
    subject: { ...statement.subject },
    ...(statement.labels !== undefined ? { labels: [...statement.labels] } : {}),
    ...(labelHints !== undefined ? { labelHints } : {}),
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

function cloneClaim(claim: ReducedRatingClaim): ReducedRatingClaim {
  const labelHints = cloneLabelHints(claim.labelHints)
  return {
    ...claim,
    subject: { ...claim.subject },
    labels: [...claim.labels],
    ...(labelHints !== undefined ? { labelHints } : {}),
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

function claimReplaces(
  candidate: ReducedRatingClaim,
  current: ReducedRatingClaim,
): boolean {
  return (
    candidate.createdAt > current.createdAt ||
    (candidate.createdAt === current.createdAt &&
      candidate.eventId.localeCompare(current.eventId) < 0)
  )
}

function statementFromTrustEvent(
  event: ITrustEvent,
  derivedFrom?: { subject: TrustSubject; twitterId: string },
): ReducedTrustStatement | undefined {
  const subject = event.subjects[0]
  if (!subject) return undefined
  if (event.value !== 1 && event.value !== 0 && event.value !== -1) {
    return undefined
  }
  const labelHints = cloneLabelHints(event.labelHints)
  return {
    eventId: event.eventId,
    author: event.pubkey,
    subject: { type: subject.tag, value: subject.value },
    context: event.c_tag,
    value: event.value,
    createdAt: event.created_at,
    ...(event.content !== undefined ? { content: event.content } : {}),
    ...(event.labels !== undefined ? { labels: [...event.labels] } : {}),
    ...(labelHints !== undefined ? { labelHints } : {}),
    ...(event.activate === undefined ? {} : { activeFrom: event.activate }),
    ...(event.expire === undefined ? {} : { activeUntil: event.expire }),
    ...(derivedFrom ? { derivedFrom } : {}),
  }
}

function asRatingClaim(record: EventRecord): ReducedRatingClaim | undefined {
  if (record.kind !== RATING_STATEMENT_KIND) return undefined
  const scoreTag = record.tags.find((tag) => tag[0] === 'score')
  if (!scoreTag || scoreTag.length < 2) return undefined
  const score = parseRatingScoreValue(scoreTag[1] ?? '')
  if (score === undefined) return undefined
  const subjectTag = record.tags.find((tag) => SUBJECT_TAGS.has(tag[0] ?? ''))
  if (!subjectTag || subjectTag.length < 2) return undefined
  const subject: TrustSubject = {
    type: subjectTag[0] as TrustSubject['type'],
    value: subjectTag[1],
  }
  if (getTrustSubjectValidationError(subject)) return undefined
  const context = record.tags.find((tag) => tag[0] === 'c')?.[1] ?? ''
  const { labels, labelHints } = parseHumanLabelTags(
    record.tags.filter((tag) => tag[0] === 'l'),
    [],
    isCanonicalRatingLabel,
  )
  const hints = cloneLabelHints(labelHints)
  const activateRaw = record.tags.find((tag) => tag[0] === 'x')?.[1]
  const expireRaw = record.tags.find((tag) => tag[0] === 'y')?.[1]
  const activeFrom =
    activateRaw !== undefined && /^\d+$/.test(activateRaw)
      ? Number(activateRaw)
      : undefined
  const activeUntil =
    expireRaw !== undefined && /^\d+$/.test(expireRaw)
      ? Number(expireRaw)
      : undefined
  return {
    eventId: record.id,
    author: record.pubkey.toLowerCase(),
    subject: { type: subject.type, value: subject.value.toLowerCase() },
    context,
    score,
    labels: [...labels],
    ...(hints !== undefined ? { labelHints: hints } : {}),
    content: sanitizeTrustContent(record.content, TRUST_STATEMENT_CONTENT_LIMIT),
    createdAt: record.created_at,
    ...(activeFrom === undefined ? {} : { activeFrom }),
    ...(activeUntil === undefined ? {} : { activeUntil }),
  }
}

function ratingSlotKeyFromRecord(record: EventRecord): string | undefined {
  if (record.kind !== RATING_STATEMENT_KIND) return undefined
  const subjectTag = record.tags.find((tag) => SUBJECT_TAGS.has(tag[0] ?? ''))
  if (!subjectTag || subjectTag.length < 2) return undefined
  const subject: TrustSubject = {
    type: subjectTag[0] as TrustSubject['type'],
    value: subjectTag[1],
  }
  if (getTrustSubjectValidationError(subject)) return undefined
  const context = record.tags.find((tag) => tag[0] === 'c')?.[1] ?? ''
  return ratingClaimSlotId({
    author: record.pubkey.toLowerCase(),
    subject: { type: subject.type, value: subject.value.toLowerCase() },
    context,
  })
}

function graphMemoryBudgetBytes(): number | undefined {
  const perf = performance as Performance & {
    memory?: { jsHeapSizeLimit: number; usedJSHeapSize: number }
  }
  if (perf.memory && perf.memory.jsHeapSizeLimit > 0) {
    return Math.max(
      0,
      (perf.memory.jsHeapSizeLimit - perf.memory.usedJSHeapSize) * 0.5,
    )
  }
  const nav = navigator as Navigator & { deviceMemory?: number }
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0) {
    return nav.deviceMemory * 1024 * 1024 * 1024 * 0.1
  }
  return undefined
}

export class GraphManager {
  readonly #ctx: RuntimeContext
  readonly #slots = new Map<string, ReducedTrustStatement>()
  readonly #claims = new Map<string, ReducedRatingClaim>()
  #blocked = new Map<string, Set<string>>()
  readonly defaultBounds: Readonly<ResolveBounds>
  graphVersion = 0
  #loaded = false

  constructor(ctx: RuntimeContext) {
    this.#ctx = ctx
    this.defaultBounds = normalizeResolveBounds({
      maxDepth: WOT_MAX_DEGREE_DEFAULT,
    })
  }

  invalidate(): void {
    this.#loaded = false
  }

  clear(): void {
    this.#ctx.graph.clear()
    this.#slots.clear()
    this.#claims.clear()
    this.#blocked.clear()
    this.graphVersion += 1
    this.#loaded = true
  }

  async ensureLoaded(): Promise<boolean> {
    if (this.#loaded) return false
    await this.load()
    return true
  }

  async load(): Promise<void> {
    const identities = await this.#ctx.repository.getAllXIdentities()
    this.#ctx.twitterIdToPubkey.clear()
    for (const identity of identities) {
      if (identity.state !== 'verified') continue
      const pubkey = pubkeyFromNpub(primaryNpubFromRow(identity))
      if (!pubkey) continue
      this.#ctx.twitterIdToPubkey.set(identity.twitterId, pubkey.toLowerCase())
    }

    const demo = this.#ctx.appMode === 'demo'
    const count = demo
      ? await this.#ctx.repository.countEventsByState(DEMO_EVENT_STATE)
      : await this.#ctx.repository.countEvents()
    const budget = graphMemoryBudgetBytes()
    if (budget !== undefined && count * ESTIMATED_BYTES_PER_EVENT > budget) {
      throw new Error(
        `Insufficient memory for graph load: estimated ${count * ESTIMATED_BYTES_PER_EVENT} bytes for ${count} events`,
      )
    }

    this.#ctx.graph.clear()
    this.#slots.clear()
    this.#claims.clear()
    this.#blocked.clear()

    const blocked = new Map<string, Set<string>>()
    const deferredHops: Array<{
      event: ITrustEvent
      derivedFrom?: { subject: TrustSubject; twitterId: string }
    }> = []
    let visited = 0

    const visit = async (record: EventRecord): Promise<void> => {
      if (this.#ctx.abortController.signal.aborted) {
        throw new DOMException('Graph load aborted', 'AbortError')
      }
      visited += 1
      if (visited % YIELD_EVERY === 0) {
        await Promise.resolve()
      }
      if (demo) {
        if (record.state !== DEMO_EVENT_STATE) return
      } else if (record.state === DEMO_EVENT_STATE) {
        return
      }

      if (record.kind === RATING_STATEMENT_KIND) {
        const claim = asRatingClaim(record)
        if (claim) this.applyClaim(claim)
        return
      }
      if (record.kind !== KIND_TRUST) return

      const event = asTrustEvent(record)
      if (!event || !isTrustEventValid(event)) return

      const subject = event.subjects[0]
      if (subject?.tag === 'p' && event.value === 1) {
        deferredHops.push({ event: cloneTrustEvent(event) })
        return
      }

      this.applyTrustEventToGraph(event)
      recordIdentityDistrust(event, this.#ctx.twitterIdToPubkey, blocked)

      if (!subject) return
      const derived = derivedPubkeyHop(event, this.#ctx.twitterIdToPubkey)
      if (!derived) return
      const derivedFrom = {
        subject: { type: subject.tag, value: subject.value },
        twitterId: derived.twitterId,
      }
      if (event.value === 1) {
        deferredHops.push({ event: derived.hop, derivedFrom })
        return
      }
      this.applyTrustEventToGraph(derived.hop, derivedFrom)
    }

    if (demo) {
      await this.#ctx.repository.iterateEventsByState(DEMO_EVENT_STATE, visit)
    } else {
      await this.#ctx.repository.iterateEvents(visit)
    }

    for (const pending of deferredHops) {
      const hopSubject = pending.event.subjects[0]
      if (
        hopSubject &&
        pending.event.value === 1 &&
        isBlockedPubkeyHop(blocked, pending.event.pubkey, hopSubject.value)
      ) {
        continue
      }
      this.applyTrustEventToGraph(pending.event, pending.derivedFrom)
    }

    this.#blocked = blocked
    this.graphVersion += 1
    this.#loaded = true
  }

  /**
   * Apply one stored 32009/32014 winner into the live heap. No Dexie rescan.
   * Tombstones (empty `v` / empty `score`) unapply the previous slot.
   */
  applyRecord(record: EventRecord): boolean {
    if (!this.#loaded) return false
    if (!this.#matchesMode(record)) return false
    const changed = this.#applyRecordNoBump(record)
    if (changed) this.graphVersion += 1
    return changed
  }

  /** Drop a stored winner from the live heap (outbox delete / wipe of one row). */
  removeRecord(record: EventRecord): boolean {
    if (!this.#loaded) return false
    const changed = this.#removeRecordNoBump(record)
    if (changed) this.graphVersion += 1
    return changed
  }

  applyTrustEventToGraph(
    event: ITrustEvent,
    derivedFrom?: { subject: TrustSubject; twitterId: string },
  ): boolean {
    if (!isTrustEventValid(event)) return false
    const statement = statementFromTrustEvent(event, derivedFrom)
    if (!statement) return false
    const key = event.addressableId
    const current = this.#slots.get(key)
    if (current && statement.derivedFrom && !current.derivedFrom) {
      return false
    }
    if (current && !replaces(statement, current)) {
      return false
    }
    this.#slots.set(key, statement)
    return this.#ctx.graph.applyTrustEvent(event)
  }

  applyClaim(claim: ReducedRatingClaim): boolean {
    if (
      !Number.isFinite(claim.score) ||
      claim.score < 0 ||
      claim.score > 100
    ) {
      return false
    }
    const key = ratingClaimSlotId(claim)
    const current = this.#claims.get(key)
    if (current && !claimReplaces(claim, current)) {
      return false
    }
    this.#claims.set(key, cloneClaim(claim))
    return true
  }

  #matchesMode(record: EventRecord): boolean {
    const demo = this.#ctx.appMode === 'demo'
    if (demo) return record.state === DEMO_EVENT_STATE
    return record.state !== DEMO_EVENT_STATE
  }

  #applyRecordNoBump(record: EventRecord): boolean {
    if (record.kind === RATING_STATEMENT_KIND) {
      const claim = asRatingClaim(record)
      if (claim) return this.applyClaim(claim)
      const key = ratingSlotKeyFromRecord(record)
      if (!key) return false
      return this.#claims.delete(key)
    }
    if (record.kind !== KIND_TRUST) return false
    const event = asTrustEvent(record)
    if (event && isTrustEventValid(event)) {
      return this.#applyTrustWithHops(event)
    }
    const slot = asTrustSlotEvent(record)
    if (!slot) return false
    return this.#removeTrustEventAndHops(slot)
  }

  #removeRecordNoBump(record: EventRecord): boolean {
    if (record.kind === RATING_STATEMENT_KIND) {
      const key = ratingSlotKeyFromRecord(record)
      if (!key) return false
      return this.#claims.delete(key)
    }
    if (record.kind !== KIND_TRUST) return false
    const slot = asTrustSlotEvent(record) ?? asTrustEvent(record)
    if (!slot) return false
    return this.#removeTrustEventAndHops(slot)
  }

  #applyTrustWithHops(event: ITrustEvent): boolean {
    const subject = event.subjects[0]
    if (
      subject?.tag === 'p' &&
      event.value === 1 &&
      isBlockedPubkeyHop(this.#blocked, event.pubkey, subject.value)
    ) {
      return this.#removeTrustSlot(event.addressableId)
    }

    let changed = this.applyTrustEventToGraph(event)
    updateIdentityDistrustBlock(
      event,
      this.#ctx.twitterIdToPubkey,
      this.#blocked,
    )
    if (!subject || subject.tag !== 'i') return changed

    const derived = derivedPubkeyHop(event, this.#ctx.twitterIdToPubkey)
    if (!derived) return changed
    const hopSubject = derived.hop.subjects[0]
    if (
      event.value === 1 &&
      hopSubject &&
      isBlockedPubkeyHop(this.#blocked, event.pubkey, hopSubject.value)
    ) {
      return changed
    }
    const derivedFrom = {
      subject: { type: subject.tag, value: subject.value },
      twitterId: derived.twitterId,
    }
    if (event.value === -1) {
      const native = this.#slots.get(derived.hop.addressableId)
      if (native && !native.derivedFrom) {
        if (this.#removeTrustSlot(derived.hop.addressableId)) changed = true
      }
    }
    if (this.applyTrustEventToGraph(derived.hop, derivedFrom)) changed = true
    return changed
  }

  #removeTrustEventAndHops(event: ITrustEvent): boolean {
    let changed = this.#removeTrustSlot(event.addressableId)
    clearIdentityDistrust(event, this.#ctx.twitterIdToPubkey, this.#blocked)
    const subject = event.subjects[0]
    if (!subject || subject.tag !== 'i') return changed
    const derived = derivedPubkeyHop(event, this.#ctx.twitterIdToPubkey)
    if (!derived) return changed
    const current = this.#slots.get(derived.hop.addressableId)
    if (current?.derivedFrom) {
      if (this.#removeTrustSlot(derived.hop.addressableId)) changed = true
    }
    return changed
  }

  #removeTrustSlot(addressableId: string): boolean {
    const current = this.#slots.get(addressableId)
    if (!current) {
      this.#ctx.graph.removeEdge(addressableId)
      return false
    }
    const trust = statementToTrustEvent(current)
    this.#ctx.graph.removeTrustEvent(trust)
    this.#ctx.graph.removeEdge(trust.addressableId)
    this.#slots.delete(addressableId)
    return true
  }

  query(query: TrustQuery): TrustQueryResult {
    return executeTrustQuery(
      this.#ctx.graph,
      indexResolver,
      {
        ...query,
        bounds: { ...this.defaultBounds, ...query.bounds },
      },
      this.graphVersion,
    )
  }

  queryRating(query: RatingQuery): RatingQueryResult {
    return artifactRatingResolver.resolve(
      this.#ctx.graph,
      indexResolver,
      [...this.#claims.values()],
      query,
      this.graphVersion,
      this.defaultBounds,
    )
  }

  neighborhood(
    centerId: NeighborhoodResult['centerId'],
    options: NeighborhoodOptions = {},
  ): NeighborhoodResult {
    return neighborhoodFromHeap(
      this.#ctx.graph,
      this.#claims.values(),
      this.graphVersion,
      centerId,
      options,
    )
  }

  listStatements(): ReducedTrustStatement[] {
    return [...this.#slots.values()].map(cloneStatement)
  }

  listClaims(): ReducedRatingClaim[] {
    return [...this.#claims.values()].map(cloneClaim)
  }
}
