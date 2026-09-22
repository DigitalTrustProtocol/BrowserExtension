/**
 * Deterministic person hex for Demo: SHA-256 material of the X id.
 * Demo events are unsigned local records; this is an id, not a live nsec.
 *
 * The Demo **operator sentinel** (`demoOperatorPubkey`) is a separate
 * in-code identity used only to pass "is there an operator?" gates. It is
 * never stored in the vault, never signed with, and never a graph author.
 * Graph authors stay `demoActorPubkey(twitterId)`.
 *
 * @module shared/demo-actor-key
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { getPublicKey, nip19 } from 'nostr-tools'

export const DEMO_ACTOR_KEY_PREFIX = 'attentionx-demo-actor:'
export const DEMO_OPERATOR_KEY_LABEL = 'attentionx-demo-operator'

const encoder = new TextEncoder()

let cachedOperatorPubkey: string | undefined

function isValidSchnorrSecret(secret: Uint8Array): boolean {
  try {
    getPublicKey(secret)
    return true
  } catch {
    return false
  }
}

function deriveSchnorrSecret(baseLabel: string): Uint8Array {
  let label = baseLabel
  for (let n = 0; n < 256; n += 1) {
    const secret = sha256(encoder.encode(label))
    if (isValidSchnorrSecret(secret)) return secret
    secret.fill(0)
    label = `${baseLabel}:${n + 1}`
  }
  throw new Error('Unable to derive a demo key')
}

/**
 * SHA-256('attentionx-demo-actor:' + twitterId), retrying with ':1', ':2', …
 * suffixes if the digest is not a valid secp256k1 scalar.
 */
export function demoActorSecretKey(twitterId: string): Uint8Array {
  return deriveSchnorrSecret(`${DEMO_ACTOR_KEY_PREFIX}${twitterId.trim()}`)
}

/**
 * Hardcoded Demo operator pubkey. Same on every install. Secret is derived
 * and zeroed; it is never persisted or used to sign.
 */
export function demoOperatorPubkey(): string {
  if (cachedOperatorPubkey) return cachedOperatorPubkey
  const secret = deriveSchnorrSecret(DEMO_OPERATOR_KEY_LABEL)
  try {
    cachedOperatorPubkey = getPublicKey(secret)
    return cachedOperatorPubkey
  } finally {
    secret.fill(0)
  }
}

export function isDemoOperatorPubkey(hex: string | undefined): boolean {
  if (!hex) return false
  return hex.trim().toLowerCase() === demoOperatorPubkey()
}

export function demoActorPubkey(twitterId: string): string {
  const secret = demoActorSecretKey(twitterId)
  try {
    return getPublicKey(secret)
  } finally {
    secret.fill(0)
  }
}

export function isDemoActorPubkey(twitterId: string, hex: string): boolean {
  return hex.trim().toLowerCase() === demoActorPubkey(twitterId)
}

export function isDemoActorNpub(
  twitterId: string,
  npub: string | undefined,
): boolean {
  if (!npub) return false
  try {
    const decoded = nip19.decode(npub.trim().toLowerCase())
    if (decoded.type !== 'npub') return false
    return isDemoActorPubkey(twitterId, decoded.data)
  } catch {
    return false
  }
}
