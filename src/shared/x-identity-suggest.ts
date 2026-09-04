/**
 * Popup suggestion flags for Bio + kind 10011 after operator binding.
 * Pure helpers — backend supplies persisted / local inputs (no live X reads).
 */

import {
  inspectExistingTwitterTags,
  type TwitterIdentityLink,
} from '../lib/nostr/kind-10011'
import { collectNpubsInText } from './proof-composer'

export interface XIdentitySuggestFlags {
  /**
   * Vault/Sync `bioUpdatedAt` set — hide Update Bio on the suggest strip.
   * Only persisted confirmation; not live bio or xIdentities alone.
   */
  hasBioNpubForActive: boolean
  /** Active pubkey's current kind 10011 claims this twitterId (or persisted). */
  hasMatching10011ForActive: boolean
  /** Passive bio saw a different single npub than the active account. */
  bioNpubMismatch: boolean
  /** The other npub from a mismatch observation, when known. */
  otherBioNpub?: string
  /** Resolved X handle used for this query (when looked up from storage). */
  resolvedHandle?: string
}

export function bioContainsActiveNpub(
  bioText: string | undefined,
  activeNpub: string,
): boolean {
  const npub = activeNpub.trim().toLowerCase()
  if (!npub.startsWith('npub1')) return false
  return collectNpubsInText(bioText ?? '').includes(npub)
}

export function resolveIdentitySuggestFlags(input: {
  activeNpub: string
  twitterId: string
  /** Vault / Sync: bio embeds this npub. */
  bioUpdatedPersisted?: boolean
  /** Vault / Sync: kind 10011 binding published. */
  publishedBindingPersisted?: boolean
  /** Vault / Sync: wrong npub observed in bio. */
  bioMismatchNpub?: string | null
  /** Tags from the active pubkey's current kind 10011 slot winner. */
  current10011Tags?: readonly string[][]
}): XIdentitySuggestFlags {
  const mismatch =
    typeof input.bioMismatchNpub === 'string'
      ? input.bioMismatchNpub.trim().toLowerCase()
      : undefined
  const hasBioNpubForActive = input.bioUpdatedPersisted === true

  let claim: TwitterIdentityLink | undefined
  if (input.current10011Tags) {
    claim = inspectExistingTwitterTags(input.current10011Tags).claim
  }
  const hasMatching10011ForActive =
    input.publishedBindingPersisted === true ||
    claim?.twitterId === input.twitterId

  return {
    hasBioNpubForActive,
    hasMatching10011ForActive,
    bioNpubMismatch: Boolean(mismatch?.startsWith('npub1')),
    ...(mismatch?.startsWith('npub1') ? { otherBioNpub: mismatch } : {}),
  }
}
