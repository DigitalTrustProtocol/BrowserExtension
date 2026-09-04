/**
 * Copy kind-32009 person statements from `i:user:id` onto the bound pubkey
 * so X identities can be hops. Trust (+1) becomes a p-hop; distrust (-1)
 * must too — otherwise a leftover or native p-trust from the same author
 * still walks that person after they were distrusted on user:id.
 */
import { parseCanonicalTwitterSubject } from '../shared/x-identity'
import {
  cloneTrustEvent,
  slotAddressableId,
  type ITrustEvent,
} from '../nip32009/nip32009'
import type { ReducedTrustStatement } from './types'

function cloneStatement(
  statement: ReducedTrustStatement,
): ReducedTrustStatement {
  return {
    ...statement,
    subject: { ...statement.subject },
    ...(statement.labels !== undefined ? { labels: [...statement.labels] } : {}),
    ...(statement.labelHints !== undefined
      ? { labelHints: { ...statement.labelHints } }
      : {}),
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

function boundPubkey(
  subjectValue: string,
  twitterIdToPubkey: ReadonlyMap<string, string>,
): string | undefined {
  const parsed = parseCanonicalTwitterSubject(subjectValue)
  if (parsed?.type !== 'account') return undefined
  const pubkey = twitterIdToPubkey.get(parsed.twitterId)
  return pubkey?.toLowerCase()
}

export function boundIdentityPubkey(
  subjectValue: string,
  twitterIdToPubkey: ReadonlyMap<string, string>,
): string | undefined {
  return boundPubkey(subjectValue, twitterIdToPubkey)
}

export function isBlockedPubkeyHop(
  blocked: ReadonlyMap<string, Set<string>>,
  author: string,
  pubkey: string,
): boolean {
  return blocked.get(author.toLowerCase())?.has(pubkey.toLowerCase()) === true
}

export function recordIdentityDistrust(
  event: ITrustEvent,
  twitterIdToPubkey: ReadonlyMap<string, string>,
  blocked: Map<string, Set<string>>,
): void {
  const subject = event.subjects[0]
  if (!subject || subject.tag !== 'i' || event.value !== -1) return
  const pubkey = boundPubkey(subject.value, twitterIdToPubkey)
  if (!pubkey) return
  const author = event.pubkey.toLowerCase()
  const set = blocked.get(author) ?? new Set<string>()
  set.add(pubkey)
  blocked.set(author, set)
}

/** Drop a user:id distrust block (trust, Neutral, or Delete of that slot). */
export function clearIdentityDistrust(
  event: ITrustEvent,
  twitterIdToPubkey: ReadonlyMap<string, string>,
  blocked: Map<string, Set<string>>,
): void {
  const subject = event.subjects[0]
  if (!subject || subject.tag !== 'i') return
  const pubkey = boundPubkey(subject.value, twitterIdToPubkey)
  if (!pubkey) return
  const author = event.pubkey.toLowerCase()
  const set = blocked.get(author)
  if (!set) return
  set.delete(pubkey)
  if (set.size === 0) blocked.delete(author)
}

export function updateIdentityDistrustBlock(
  event: ITrustEvent,
  twitterIdToPubkey: ReadonlyMap<string, string>,
  blocked: Map<string, Set<string>>,
): void {
  if (event.value === -1) {
    recordIdentityDistrust(event, twitterIdToPubkey, blocked)
    return
  }
  clearIdentityDistrust(event, twitterIdToPubkey, blocked)
}

/** Rewrite scratch subjects to the bound pubkey hop (same polarity). */
export function fillDerivedPubkeyHop(event: ITrustEvent, pubkey: string): void {
  const normalized = pubkey.toLowerCase()
  event.subjects = [{ tag: 'p', value: normalized }]
  event.addressableId = slotAddressableId(
    event.pubkey,
    { type: 'p', value: normalized },
    event.c_tag,
  )
}

export function derivedPubkeyHop(
  event: ITrustEvent,
  twitterIdToPubkey: ReadonlyMap<string, string>,
): { hop: ITrustEvent; twitterId: string } | undefined {
  const subject = event.subjects[0]
  if (!subject || subject.tag !== 'i') return undefined
  if (event.value !== 1 && event.value !== 0 && event.value !== -1) {
    return undefined
  }
  const parsed = parseCanonicalTwitterSubject(subject.value)
  if (!parsed || parsed.type !== 'account') return undefined
  const pubkey = twitterIdToPubkey.get(parsed.twitterId)?.toLowerCase()
  if (!pubkey) return undefined
  const hop = cloneTrustEvent(event)
  fillDerivedPubkeyHop(hop, pubkey)
  return { hop, twitterId: parsed.twitterId }
}

/**
 * Author+pubkey pairs the author currently distrusts on `user:id`.
 * A +1 p-edge from that author to that pubkey must not remain a hop.
 */
export function distrustedIdentityPubkeys(
  statements: readonly ReducedTrustStatement[],
  twitterIdToPubkey: ReadonlyMap<string, string>,
): Map<string, Set<string>> {
  const blocked = new Map<string, Set<string>>()
  for (const statement of statements) {
    if (statement.subject.type !== 'i' || statement.value !== -1) continue
    const pubkey = boundPubkey(statement.subject.value, twitterIdToPubkey)
    if (!pubkey) continue
    const author = statement.author.toLowerCase()
    const set = blocked.get(author) ?? new Set<string>()
    set.add(pubkey)
    blocked.set(author, set)
  }
  return blocked
}

function isBlockedHop(
  blocked: ReadonlyMap<string, Set<string>>,
  author: string,
  pubkey: string,
): boolean {
  return blocked.get(author.toLowerCase())?.has(pubkey.toLowerCase()) === true
}

/**
 * Real statements plus identity→pubkey copies, with same-author p-trust
 * hops removed when that author distrusts the matching user:id.
 */
export function applyIdentityPubkeyHops(
  real: readonly ReducedTrustStatement[],
  twitterIdToPubkey: ReadonlyMap<string, string>,
): ReducedTrustStatement[] {
  const blocked = distrustedIdentityPubkeys(real, twitterIdToPubkey)

  const kept: ReducedTrustStatement[] = []
  for (const statement of real) {
    if (
      statement.subject.type === 'p' &&
      statement.value === 1 &&
      isBlockedHop(blocked, statement.author, statement.subject.value)
    ) {
      continue
    }
    kept.push(cloneStatement(statement))
  }

  const derived: ReducedTrustStatement[] = []
  for (const statement of real) {
    if (statement.subject.type !== 'i') continue
    if (
      statement.value !== 1 &&
      statement.value !== 0 &&
      statement.value !== -1
    ) {
      continue
    }
    const parsed = parseCanonicalTwitterSubject(statement.subject.value)
    if (!parsed || parsed.type !== 'account') continue
    const pubkey = twitterIdToPubkey.get(parsed.twitterId)?.toLowerCase()
    if (!pubkey) continue
    if (statement.value === 1 && isBlockedHop(blocked, statement.author, pubkey)) {
      continue
    }
    derived.push({
      eventId: statement.eventId,
      author: statement.author,
      subject: { type: 'p', value: pubkey },
      context: statement.context,
      value: statement.value,
      createdAt: statement.createdAt,
      ...(statement.activeFrom !== undefined
        ? { activeFrom: statement.activeFrom }
        : {}),
      ...(statement.activeUntil !== undefined
        ? { activeUntil: statement.activeUntil }
        : {}),
      ...(statement.content !== undefined ? { content: statement.content } : {}),
      ...(statement.labels !== undefined ? { labels: [...statement.labels] } : {}),
      ...(statement.labelHints !== undefined
        ? { labelHints: { ...statement.labelHints } }
        : {}),
      derivedFrom: {
        subject: { ...statement.subject },
        twitterId: parsed.twitterId,
      },
    })
  }

  return [...kept, ...derived]
}
