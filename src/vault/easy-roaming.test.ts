import { afterEach, describe, expect, it } from 'vitest'
import { resetChromeStorage } from '../background/test-chrome-mock.ts'
import { getPublicKey } from './crypto/secp256k1.ts'
import { bytesToHex, hexToBytes, randomBytes } from './crypto/utils.ts'
import {
  buildEasyBlobFromPrivkey,
  classifyEasyConflict,
  clearEasyBlob,
  readEasyBlob,
  remirrorAccountNameIfBlobExists,
  remirrorEasyBlobForPubkey,
  restoreAccountFromEasyBlob,
  writeEasyBlob,
  type EasyAccountBlob,
} from './easy-roaming.ts'

afterEach(() => {
  resetChromeStorage()
})

function randomPrivkeyHex(): string {
  return bytesToHex(randomBytes(32))
}

function pubkeyFromPrivHex(privkeyHex: string): string {
  return bytesToHex(getPublicKey(hexToBytes(privkeyHex)))
}

describe('easy-roaming', () => {
  it('round-trips privkey through empty-password ncryptsec blob', async () => {
    const privkey = randomPrivkeyHex()
    const pubkey = pubkeyFromPrivHex(privkey)
    const blob = await buildEasyBlobFromPrivkey(privkey, { accountName: 'Main' })

    expect(blob.version).toBe(1)
    expect(blob.pubkeyHint).toBe(pubkey)
    expect(blob.easyRoaming).toBe(true)
    expect(blob.ncryptsec.startsWith('ncryptsec1')).toBe(true)

    await writeEasyBlob(blob)
    const read = await readEasyBlob()
    expect(read?.pubkeyHint).toBe(pubkey)

    const account = await restoreAccountFromEasyBlob(read!)
    expect(account.pubkey).toBe(pubkey)
    expect(account.privkey).toBe(privkey)
    expect(account.mnemonic).toBeNull()
    expect(account.type).toBe('generated')
  })

  it('classifies sync conflicts', () => {
    const blob: EasyAccountBlob = {
      version: 1,
      updatedAt: 1,
      ncryptsec: 'ncryptsec1x',
      pubkeyHint: 'aa'.repeat(32),
    }
    expect(classifyEasyConflict(null, null)).toBe('none')
    expect(classifyEasyConflict('bb'.repeat(32), null)).toBe('none')
    expect(classifyEasyConflict('aa'.repeat(32), blob)).toBe('same')
    expect(classifyEasyConflict('bb'.repeat(32), blob)).toBe('different')
  })

  it('refuses remirror over a different pubkey unless replace is set', async () => {
    const first = randomPrivkeyHex()
    const second = randomPrivkeyHex()
    await writeEasyBlob(await buildEasyBlobFromPrivkey(first))

    const blocked = await remirrorEasyBlobForPubkey(second, { replace: false })
    expect(blocked.wrote).toBe(false)
    expect(blocked.conflict).toBe('different')
    const stillFirst = await readEasyBlob()
    expect(stillFirst?.pubkeyHint).toBe(pubkeyFromPrivHex(first))

    const replaced = await remirrorEasyBlobForPubkey(second, { replace: true })
    expect(replaced.wrote).toBe(true)
    const after = await readEasyBlob()
    expect(after?.pubkeyHint).toBe(pubkeyFromPrivHex(second))
  })

  it('rewrites same-pubkey blob and clearEasyBlob removes it', async () => {
    const privkey = randomPrivkeyHex()
    await writeEasyBlob(await buildEasyBlobFromPrivkey(privkey, { accountName: 'A' }))
    const first = await readEasyBlob()
    const again = await remirrorEasyBlobForPubkey(privkey, { accountName: 'B' })
    expect(again.wrote).toBe(true)
    const second = await readEasyBlob()
    expect(second?.accountName).toBe('B')
    expect(second!.updatedAt).toBeGreaterThanOrEqual(first!.updatedAt)

    await clearEasyBlob()
    expect(await readEasyBlob()).toBeNull()
  })

  it('documents signed-out Sync behavior: writes succeed locally without roaming guarantees', async () => {
    // chrome.storage.sync API accepts writes even when Chrome Sync is off;
    // roaming is a browser-level concern. This test asserts the extension path
    // still persists the blob in the sync storage area.
    const privkey = randomPrivkeyHex()
    await writeEasyBlob(await buildEasyBlobFromPrivkey(privkey))
    expect(await readEasyBlob()).not.toBeNull()
  })

  it('upserts per-X easy blobs and migrates bound v1 into the map', async () => {
    const privkey = randomPrivkeyHex()
    const pubkey = pubkeyFromPrivHex(privkey)
    await writeEasyBlob(
      await buildEasyBlobFromPrivkey(privkey, {
        accountName: 'Main',
        boundTwitterId: '42',
      }),
    )
    const { readEasyBlobsMap, upsertEasyBlobForTwitterId } = await import(
      './easy-roaming.ts'
    )
    const map = await readEasyBlobsMap()
    expect(map.byTwitterId['42']?.pubkeyHint.toLowerCase()).toBe(
      pubkey.toLowerCase(),
    )

    const other = randomPrivkeyHex()
    const wrote = await upsertEasyBlobForTwitterId(other, {
      boundTwitterId: '99',
      accountName: 'Alt',
    })
    expect(wrote.wrote).toBe(true)
    const again = await readEasyBlobsMap()
    expect(Object.keys(again.byTwitterId).sort()).toEqual(['42', '99'])
  })

  it('rewrites accountName only when a live blob already exists', async () => {
    const privkey = randomPrivkeyHex()
    const pubkey = pubkeyFromPrivHex(privkey)
    expect(
      await remirrorAccountNameIfBlobExists(privkey, {
        accountName: 'Nostr Key 1',
        pubkey,
      }),
    ).toBe(false)
    expect(await readEasyBlob()).toBeNull()

    await writeEasyBlob(
      await buildEasyBlobFromPrivkey(privkey, { accountName: 'Old' }),
    )
    expect(
      await remirrorAccountNameIfBlobExists(privkey, {
        accountName: 'Nostr Key 2',
        pubkey,
      }),
    ).toBe(true)
    expect((await readEasyBlob())?.accountName).toBe('Nostr Key 2')
  })
})
