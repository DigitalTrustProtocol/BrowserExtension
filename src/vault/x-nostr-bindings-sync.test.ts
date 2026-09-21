import { afterEach, describe, expect, it } from 'vitest'
import { resetChromeStorage } from '../background/test-chrome-mock.ts'
import {
  readXNostrBindings,
  upsertXNostrBinding,
} from './x-nostr-bindings-sync.ts'

afterEach(() => {
  resetChromeStorage()
})

describe('x-nostr-bindings-sync', () => {
  it('keeps sibling twitterIds when the same pubkey binds a second X', async () => {
    const pubkey = 'aa'.repeat(32)
    await upsertXNostrBinding({
      twitterId: '1',
      pubkey,
      updatedAt: 10,
    })
    await upsertXNostrBinding({
      twitterId: '2',
      pubkey,
      updatedAt: 20,
    })
    const sync = await readXNostrBindings()
    expect(sync.byTwitterId['1']?.pubkey).toBe(pubkey)
    expect(sync.byTwitterId['2']?.pubkey).toBe(pubkey)
  })

  it('keeps setup stamps when the same pubkey rebinds', async () => {
    const pubkey = 'bb'.repeat(32)
    await upsertXNostrBinding({
      twitterId: '7',
      pubkey,
      updatedAt: 10,
      bioUpdatedAt: 11,
      publishedBindingAt: 12,
    })
    await upsertXNostrBinding({
      twitterId: '7',
      pubkey,
      updatedAt: 20,
    })
    const sync = await readXNostrBindings()
    expect(sync.byTwitterId['7']).toMatchObject({
      pubkey,
      updatedAt: 20,
      bioUpdatedAt: 11,
      publishedBindingAt: 12,
    })
  })

  it('drops setup stamps when a different pubkey takes the X id', async () => {
    const first = 'cc'.repeat(32)
    const second = 'dd'.repeat(32)
    await upsertXNostrBinding({
      twitterId: '7',
      pubkey: first,
      updatedAt: 10,
      bioUpdatedAt: 11,
      publishedBindingAt: 12,
      bioMismatchNpub: `npub1${'q'.repeat(20)}`,
    })
    await upsertXNostrBinding({
      twitterId: '7',
      pubkey: second,
      updatedAt: 20,
    })
    const sync = await readXNostrBindings()
    expect(sync.byTwitterId['7']).toEqual({
      pubkey: second,
      updatedAt: 20,
    })
  })
})

