import { describe, expect, it } from 'vitest'
import { FOLLOW_TRUST_THRESHOLD_DEFAULT } from '../shared/wot-follow-trust-threshold'
import { HeapTrustHarness, trustRecord } from './heap-test-harness'
import type { TrustSubject } from './types'

const root = 'root'
const post: TrustSubject = { type: 'i', value: 'post:id:42' }

function pubkey(id: string): TrustSubject {
  return { type: 'p', value: id }
}

const mixedPeer = [
  trustRecord('root-a', root, pubkey('a'), 1),
  trustRecord('root-b', root, pubkey('b'), 1),
  trustRecord('root-c', root, pubkey('c'), 1),
  trustRecord('root-d', root, pubkey('d'), 1),
  trustRecord('a-peer', 'a', pubkey('peer'), 1),
  trustRecord('b-peer', 'b', pubkey('peer'), 1),
  trustRecord('c-peer', 'c', pubkey('peer'), 1),
  trustRecord('d-peer', 'd', pubkey('peer'), -1),
  trustRecord('peer-post', 'peer', post, 1),
]

describe('executeTrustQuery followTrustThreshold', () => {
  it('echoes the default 75% when the query omits the field', () => {
    const h = new HeapTrustHarness([
      trustRecord('root-alice', root, pubkey('alice'), 1),
    ])
    const result = h.query({
      rootPubkey: root,
      subject: { type: 'p', value: 'alice' },
    })
    expect(result.followTrustThreshold).toBe(FOLLOW_TRUST_THRESHOLD_DEFAULT)
    expect(result.followTrustRed).toBe(25)
    expect(result.connected).toBe(true)
  })

  it('clamps an invalid percent to 75 and echoes it', () => {
    const h = new HeapTrustHarness([
      trustRecord('root-alice', root, pubkey('alice'), 1),
    ])
    const result = h.query({
      rootPubkey: root,
      subject: { type: 'p', value: 'alice' },
      followTrustThreshold: Number.NaN,
    })
    expect(result.followTrustThreshold).toBe(FOLLOW_TRUST_THRESHOLD_DEFAULT)
    expect(result.followTrustRed).toBe(25)
  })

  it('connects a 50% mixed hop at 1% and misses at 75%', () => {
    const h = new HeapTrustHarness(mixedPeer)
    const permissive = h.query({
      rootPubkey: root,
      subject: post,
      followTrustThreshold: 1,
    })
    expect(permissive.followTrustThreshold).toBe(1)
    expect(permissive.followTrustRed).toBe(1)
    expect(permissive.connected).toBe(true)
    expect(permissive.degree).toBe(3)

    const strict = h.query({
      rootPubkey: root,
      subject: post,
      followTrustThreshold: 75,
    })
    expect(strict.followTrustThreshold).toBe(75)
    expect(strict.followTrustRed).toBe(25)
    expect(strict.connected).toBe(false)
    expect(strict.resolution).toBe('none')
  })
})
