/**
 * Identity bind helpers. Heap hops come from `Graph.bindIdentity`
 * converting i-nodes in place — this module does not clone events.
 */
import { parseCanonicalTwitterSubject } from '../shared/x-identity'

export function boundIdentityPubkey(
  subjectValue: string,
  twitterIdToPubkey: ReadonlyMap<string, string>,
): string | undefined {
  const parsed = parseCanonicalTwitterSubject(subjectValue)
  if (parsed?.type !== 'account') return undefined
  const pubkey = twitterIdToPubkey.get(parsed.twitterId)
  return pubkey?.toLowerCase()
}
