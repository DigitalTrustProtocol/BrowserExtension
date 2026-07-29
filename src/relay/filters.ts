import type { Filter } from 'nostr-tools'
import { X_TRUST_SCOPE } from '../shared/x-identity'
import { TRUST_STATEMENT_KIND } from './graph'

/** Default batch size for `#i` subject filters (relay limits vary). */
export const X_TRUST_SUBJECT_FILTER_BATCH = 20

/**
 * Pull kind `32009` events authored by one pubkey in the X trust namespace.
 *
 * AttentionX on x.com uses NIP-32009 author-bounded WoT sync:
 * `authors` AND `#s=x.com`. Matches locally published `s` tags and keeps
 * relay traffic scoped to X trust statements.
 */
export function buildAuthorTrustSyncFilter(
  author: string,
  since?: number,
): Filter {
  return {
    kinds: [TRUST_STATEMENT_KIND],
    authors: [author],
    '#s': [X_TRUST_SCOPE],
    ...(since === undefined ? {} : { since }),
  }
}

/**
 * Discover trust statements about specific X accounts from any author.
 *
 * Matches NIP-32009 "everything said about this X user" filters:
 * `#k=user:id` AND `#s=x.com` AND `#i=user:id:<digits>`.
 */
export function buildXAccountTrustDiscoveryFilter(
  twitterIds: readonly string[],
  since?: number,
): Filter {
  const subjects = [
    ...new Set(
      twitterIds
        .map((id) => id.trim())
        .filter((id) => /^\d+$/.test(id))
        .map((id) => `user:id:${id}`),
    ),
  ]
  if (subjects.length === 0) {
    throw new Error('At least one numeric X user id is required')
  }
  return {
    kinds: [TRUST_STATEMENT_KIND],
    '#k': ['user:id'],
    '#s': [X_TRUST_SCOPE],
    '#i': subjects,
    ...(since === undefined ? {} : { since }),
  }
}

/** Refresh one known replaceable slot when the `d` digest is already known. */
export function buildTrustSlotFilter(author: string, d: string): Filter {
  return {
    kinds: [TRUST_STATEMENT_KIND],
    authors: [author],
    '#d': [d],
  }
}

export function batchXTrustSubjectIds(
  twitterIds: readonly string[],
  batchSize = X_TRUST_SUBJECT_FILTER_BATCH,
): string[][] {
  const unique = [
    ...new Set(
      twitterIds
        .map((id) => id.trim())
        .filter((id) => /^\d+$/.test(id)),
    ),
  ]
  const batches: string[][] = []
  for (let index = 0; index < unique.length; index += batchSize) {
    batches.push(unique.slice(index, index + batchSize))
  }
  return batches
}

export function xSubjectSyncScope(baseScope: string): string {
  return `${baseScope}:x-subjects`
}
