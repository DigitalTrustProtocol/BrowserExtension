/**
 * Author→pubkey distrust blocks for leftover native `p` +1 after a
 * `user:id` -1. Heap hops themselves come from `Graph.bindIdentity`
 * converting i-nodes in place — this module does not clone events.
 */
import { parseCanonicalTwitterSubject } from '../shared/x-identity'
import type { EventRecord } from '../storage/types'

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

/** Drop a user:id distrust block (trust, Neutral, or Delete of that slot). */
export function clearIdentityDistrust(
  record: EventRecord,
  twitterIdToPubkey: ReadonlyMap<string, string>,
  blocked: Map<string, Set<string>>,
): void {
  if (record.subjectType !== 'i' || !record.subject) return
  const pubkey = boundPubkey(record.subject, twitterIdToPubkey)
  if (!pubkey) return
  const author = record.pubkey.toLowerCase()
  const set = blocked.get(author)
  if (!set) return
  set.delete(pubkey)
  if (set.size === 0) blocked.delete(author)
}

export function recordIdentityDistrust(
  record: EventRecord,
  twitterIdToPubkey: ReadonlyMap<string, string>,
  blocked: Map<string, Set<string>>,
): void {
  if (record.subjectType !== 'i' || record.nValue !== -1 || !record.subject) {
    return
  }
  const pubkey = boundPubkey(record.subject, twitterIdToPubkey)
  if (!pubkey) return
  const author = record.pubkey.toLowerCase()
  const set = blocked.get(author) ?? new Set<string>()
  set.add(pubkey)
  blocked.set(author, set)
}

export function updateIdentityDistrustBlock(
  record: EventRecord,
  twitterIdToPubkey: ReadonlyMap<string, string>,
  blocked: Map<string, Set<string>>,
): void {
  if (record.nValue === -1) {
    recordIdentityDistrust(record, twitterIdToPubkey, blocked)
    return
  }
  clearIdentityDistrust(record, twitterIdToPubkey, blocked)
}
