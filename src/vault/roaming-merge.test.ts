import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetChromeStorage } from '../background/test-chrome-mock.ts'
import { getPublicKey } from './crypto/secp256k1.ts'
import { bytesToHex, hexToBytes, randomBytes } from './crypto/utils.ts'
import { buildEasyBlobV2FromPrivkey, writeEasyBlobsMap } from './easy-roaming.ts'
import {
  clearLocalAccounts,
  writeLocalAccounts,
} from '../accounts/local-account-mirror.ts'
import * as vault from './vault.ts'
import { mergeRoamingSyncIntoLocal } from './roaming-merge.ts'

afterEach(() => {
  resetChromeStorage()
  vi.restoreAllMocks()
})

describe('mergeRoamingSyncIntoLocal restore suppression', () => {
  it('does not recreate an empty vault from live Sync blobs after key clear', async () => {
    const privkey = bytesToHex(randomBytes(32))
    const blob = await buildEasyBlobV2FromPrivkey(privkey, {
      accountName: 'Roam',
      boundTwitterId: '44196397',
    })
    await writeEasyBlobsMap({
      version: 2,
      byTwitterId: { '44196397': blob },
    })
    await writeLocalAccounts({
      accounts: [
        {
          id: 'gone',
          name: 'Gone',
          pubkey: bytesToHex(getPublicKey(hexToBytes(privkey))),
          type: 'generated',
          readOnly: false,
          boundTwitterIds: ['44196397'],
          boundTwitterId: '44196397',
          boundUpdatedAt: 1,
        },
      ],
      activeAccountId: 'gone',
      markPersisted: true,
    })
    await clearLocalAccounts({ reason: 'lastKeyDelete' })

    const create = vi.spyOn(vault, 'create')
    const result = await mergeRoamingSyncIntoLocal()
    expect(result).toEqual({ restored: 0, removed: 0 })
    expect(create).not.toHaveBeenCalled()
  })
})
