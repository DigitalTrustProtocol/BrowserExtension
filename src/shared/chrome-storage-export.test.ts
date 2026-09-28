import { describe, expect, it } from 'vitest'
import { exportChromeStorageAreas } from './chrome-storage-export'

describe('exportChromeStorageAreas', () => {
  it('keeps relay settings and drops vault, easy blobs, and nested secrets', () => {
    const exported = exportChromeStorageAreas(
      {
        keyVault: { ciphertext: 'secret' },
        'attentionx-state-v1': {
          relays: ['wss://nos.lol'],
          secretKeyHex: 'ab'.repeat(32),
          wotMaxDegree: 3,
        },
        inactiveRelays: ['wss://example.custom'],
        relayFlags: { 'wss://nos.lol': { read: true, write: false } },
        accounts: [
          {
            pubkey: 'cd'.repeat(32),
            privkey: '11'.repeat(32),
            mnemonic: 'abandon abandon',
          },
        ],
        note: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        activityLog: [{ method: 'sign', ts: 1 }],
        attentionxResolveTimingV1: { byDegree: {}, noMatch: { sumMs: 1, samples: 1 } },
      },
      {
        relays: 'wss://nos.lol,wss://relay.damus.io',
        myPubkey: 'cd'.repeat(32),
        easyAccountBlob: { ncryptsec: 'ncryptsec1abc', mnemonic: 'seed words' },
        easyAccountBlobs: { byTwitterId: { '1': { ncryptsec: 'ncryptsec1def' } } },
      },
      50,
    )

    expect(exported.local).toEqual({
      'attentionx-state-v1': {
        relays: ['wss://nos.lol'],
        wotMaxDegree: 3,
      },
      inactiveRelays: ['wss://example.custom'],
      relayFlags: { 'wss://nos.lol': { read: true, write: false } },
      accounts: [{ pubkey: 'cd'.repeat(32) }],
    })
    expect(exported.sync).toEqual({
      relays: 'wss://nos.lol,wss://relay.damus.io',
      myPubkey: 'cd'.repeat(32),
    })
    expect(exported.omittedKeys).toEqual([
      'local.keyVault',
      'local.activityLog',
      'local.attentionxResolveTimingV1',
      'sync.easyAccountBlob',
      'sync.easyAccountBlobs',
    ])
    expect(JSON.stringify(exported)).not.toContain('nsec1')
    expect(JSON.stringify(exported)).not.toContain('ncryptsec1')
    expect(JSON.stringify(exported)).not.toContain('secretKeyHex')
    expect(JSON.stringify(exported)).not.toContain('privkey')
  })
})
