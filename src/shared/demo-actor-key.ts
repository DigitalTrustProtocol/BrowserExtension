/**
 * Deterministic, public-derivable schnorr secrets for demo impersonation.
 * Never treat these as secrets: no vault, no NIP-07, no durable nsec storage.
 * Containment is `publish: 'local'` (ingest only).
 *
 * @module shared/demo-actor-key
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { getPublicKey } from 'nostr-tools'

export const DEMO_ACTOR_KEY_PREFIX = 'attentionx-demo-actor:'

const encoder = new TextEncoder()

function isValidSchnorrSecret(secret: Uint8Array): boolean {
  try {
    getPublicKey(secret)
    return true
  } catch {
    return false
  }
}

/**
 * SHA-256('attentionx-demo-actor:' + twitterId), retrying with ':1', ':2', …
 * suffixes if the digest is not a valid secp256k1 scalar.
 */
export function demoActorSecretKey(twitterId: string): Uint8Array {
  const id = twitterId.trim()
  let label = `${DEMO_ACTOR_KEY_PREFIX}${id}`
  for (let n = 0; n < 256; n += 1) {
    const secret = sha256(encoder.encode(label))
    if (isValidSchnorrSecret(secret)) return secret
    secret.fill(0)
    label = `${DEMO_ACTOR_KEY_PREFIX}${id}:${n + 1}`
  }
  throw new Error('Unable to derive a demo actor key')
}

export function demoActorPubkey(twitterId: string): string {
  const secret = demoActorSecretKey(twitterId)
  try {
    return getPublicKey(secret)
  } finally {
    secret.fill(0)
  }
}
