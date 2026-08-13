import type { Filter } from 'nostr-tools'
import { X_TRUST_SCOPE } from '../shared/x-identity'
import { RATING_STATEMENT_KIND } from '../shared/kind-32014'
import { TRUST_STATEMENT_KIND } from './graph'

/** Default batch size for `#i` subject filters (relay limits vary). */
export const X_TRUST_SUBJECT_FILTER_BATCH = 20

/**
 * Pull kind `32009` events authored by one pubkey for AttentionX on x.com.
 *
 * Omits `#s` so both legacy empty-scope and explicit `s=x.com` statements
 * match. Relays cannot filter “missing `s`”; unrelated scopes are
 * dropped client-side via `isEligibleXTrustScope`.
 *
 * @see docs/architecture.md § Scope policy
 */
export function buildAuthorTrustSyncFilter(
  author: string,
  since?: number,
): Filter {
  return {
    kinds: [TRUST_STATEMENT_KIND],
    authors: [author],
    ...(since === undefined ? {} : { since }),
  }
}

/**
 * Pull kind `32014` ratings authored by one pubkey already on the 32009
 * frontier. Separate REQ from trust so ratings never expand WoT traversal.
 */
export function buildAuthorRatingSyncFilter(
  author: string,
  since?: number,
): Filter {
  return {
    kinds: [RATING_STATEMENT_KIND],
    authors: [author],
    ...(since === undefined ? {} : { since }),
  }
}

/**
 * Discover trust statements about specific X accounts from any author.
 *
 * `#k=user:id` AND `#i=user:id:<digits>` — no `#s`, so legacy empty-scope and
 * new explicit `s=x.com` user statements are included; unrelated scopes are
 * filtered client-side.
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
    '#i': subjects,
    ...(since === undefined ? {} : { since }),
  }
}

/**
 * Optional companion filter for site-scoped statements only (`#s=x.com`).
 * Useful when a caller wants an explicit x.com pull alongside the open filter.
 */
export function buildXScopedTrustFilter(
  base: Omit<Filter, '#s' | 'kinds'> & { kinds?: number[] },
): Filter {
  return {
    ...base,
    kinds: base.kinds ?? [TRUST_STATEMENT_KIND],
    '#s': [X_TRUST_SCOPE],
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
