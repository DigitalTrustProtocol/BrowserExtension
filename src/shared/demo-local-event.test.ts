import { getEventHash } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { demoActorPubkey } from './demo-actor-key.ts'
import { UNSIGNED_DEMO_SIG, unsignedDemoEvent } from './demo-local-event.ts'

describe('unsignedDemoEvent', () => {
  it('sets pubkey and hashes id without a real signature', () => {
    const pubkey = demoActorPubkey('44196397')
    const event = unsignedDemoEvent(
      {
        kind: 0,
        created_at: 1,
        tags: [['test', 'attentionx-demo']],
        content: '{}',
      },
      pubkey,
    )
    expect(event.pubkey).toBe(pubkey)
    expect(event.sig).toBe(UNSIGNED_DEMO_SIG)
    expect(event.id).toBe(
      getEventHash({
        kind: 0,
        created_at: 1,
        tags: [['test', 'attentionx-demo']],
        content: '{}',
        pubkey,
      }),
    )
  })
})
