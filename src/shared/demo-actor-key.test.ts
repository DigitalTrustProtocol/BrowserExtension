import { getPublicKey, nip19 } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import {
  DEMO_ACTOR_KEY_PREFIX,
  DEMO_OPERATOR_KEY_LABEL,
  demoActorPubkey,
  demoActorSecretKey,
  demoOperatorPubkey,
  isDemoActorNpub,
  isDemoActorPubkey,
  isDemoOperatorPubkey,
} from './demo-actor-key.ts'

const ELON_TWITTER_ID = '44196397'

describe('demoActorSecretKey', () => {
  it('is 32 bytes and a valid schnorr secret', () => {
    const secret = demoActorSecretKey(ELON_TWITTER_ID)
    expect(secret).toHaveLength(32)
    expect(getPublicKey(secret)).toMatch(/^[0-9a-f]{64}$/)
    secret.fill(0)
  })

  it('is stable across two derivations for Elon', () => {
    const a = demoActorSecretKey(ELON_TWITTER_ID)
    const b = demoActorSecretKey(ELON_TWITTER_ID)
    expect([...a]).toEqual([...b])
    expect(getPublicKey(a)).toBe(getPublicKey(b))
    a.fill(0)
    b.fill(0)
  })

  it('uses the namespaced prefix material', () => {
    expect(DEMO_ACTOR_KEY_PREFIX).toBe('attentionx-demo-actor:')
  })

  it('differs by twitterId', () => {
    const elon = demoActorPubkey(ELON_TWITTER_ID)
    const spacex = demoActorPubkey('34743251')
    expect(elon).not.toBe(spacex)
  })
})

describe('demoOperatorPubkey', () => {
  it('is a stable 64-char hex distinct from per-X demo actors', () => {
    const a = demoOperatorPubkey()
    const b = demoOperatorPubkey()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).toBe(b)
    expect(a).not.toBe(demoActorPubkey(ELON_TWITTER_ID))
    expect(DEMO_OPERATOR_KEY_LABEL).toBe('attentionx-demo-operator')
  })

  it('matches isDemoOperatorPubkey case-insensitively', () => {
    const hex = demoOperatorPubkey()
    expect(isDemoOperatorPubkey(hex)).toBe(true)
    expect(isDemoOperatorPubkey(hex.toUpperCase())).toBe(true)
    expect(isDemoOperatorPubkey(demoActorPubkey(ELON_TWITTER_ID))).toBe(false)
    expect(isDemoOperatorPubkey(undefined)).toBe(false)
  })
})

describe('isDemoActorPubkey', () => {
  it('matches the derived hex for that X id only', () => {
    const elon = demoActorPubkey(ELON_TWITTER_ID)
    expect(isDemoActorPubkey(ELON_TWITTER_ID, elon)).toBe(true)
    expect(isDemoActorPubkey(ELON_TWITTER_ID, elon.toUpperCase())).toBe(true)
    expect(isDemoActorPubkey('34743251', elon)).toBe(false)
    expect(isDemoActorNpub(ELON_TWITTER_ID, nip19.npubEncode(elon))).toBe(true)
    expect(isDemoActorNpub(ELON_TWITTER_ID, `npub1${'a'.repeat(58)}`)).toBe(
      false,
    )
  })
})
