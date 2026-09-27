import { sha256 } from '@noble/hashes/sha2.js'
import { getPublicKey, nip19 } from 'nostr-tools'

export interface SigningKey {
  secret: Uint8Array
  pubkey: string
  nsec: string
  npub: string
}

const PREFIX = 'attentionx-test-relay:'
const encoder = new TextEncoder()

/** Same scalar search as the demo actor keys, kept here so the extension stays unchanged. */
function deriveSchnorrSecret(baseLabel: string): Uint8Array {
  let label = baseLabel
  for (let n = 0; n < 256; n += 1) {
    const secret = sha256(encoder.encode(label))
    try {
      getPublicKey(secret)
      return secret
    } catch {
      secret.fill(0)
      label = `${baseLabel}:${n + 1}`
    }
  }
  throw new Error('Unable to derive a test relay key')
}

export function signingKey(label: string): SigningKey {
  const secret = deriveSchnorrSecret(`${PREFIX}${label}`)
  const pubkey = getPublicKey(secret)
  return {
    secret,
    pubkey,
    nsec: nip19.nsecEncode(secret),
    npub: nip19.npubEncode(pubkey),
  }
}

export function personaKey(seed: string, index: number): SigningKey {
  return signingKey(`${seed}:persona:${index}`)
}

export function operatorKey(seed: string, slot: 'a' | 'b'): SigningKey {
  return signingKey(`${seed}:operator:${slot}`)
}
