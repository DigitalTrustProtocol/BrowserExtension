import { getPublicKey } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import {
  DEMO_ACTOR_KEY_PREFIX,
  demoActorPubkey,
  demoActorSecretKey,
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
