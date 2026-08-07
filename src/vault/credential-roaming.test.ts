import { beforeEach, describe, expect, it, vi } from 'vitest'

const syncStore: Record<string, unknown> = {}
const localStore: Record<string, unknown> = {}

vi.mock('./browser.ts', () => ({
  default: {
    storage: {
      sync: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys]
          const out: Record<string, unknown> = {}
          for (const k of list) {
            if (k in syncStore) out[k] = syncStore[k]
          }
          return out
        }),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          Object.assign(syncStore, obj)
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys]
          for (const k of list) delete syncStore[k]
        }),
      },
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys]
          const out: Record<string, unknown> = {}
          for (const k of list) {
            if (k in localStore) out[k] = localStore[k]
          }
          return out
        }),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          Object.assign(localStore, obj)
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys]
          for (const k of list) delete localStore[k]
        }),
      },
    },
  },
}))

import {
  appendCredentialChecksum,
  findChecksumMatch,
  readCredentialChecksums,
} from './credential-checksums.ts'
import {
  getBrowserKeyRoaming,
  setBrowserKeyRoaming,
  clearAllRoamingSyncData,
} from './browser-key-roaming.ts'
import {
  markEasyBlobDeletedForTwitterId,
  readEasyBlobsMap,
  writeEasyBlobsMap,
  countLiveEasyBlobs,
} from './easy-roaming.ts'

describe('credential checksums + roaming preference', () => {
  beforeEach(() => {
    for (const k of Object.keys(syncStore)) delete syncStore[k]
    for (const k of Object.keys(localStore)) delete localStore[k]
  })

  it('appends checksums without duplicates', async () => {
    await appendCredentialChecksum({ checksum: 'a'.repeat(64), iterations: 210000 })
    await appendCredentialChecksum({ checksum: 'a'.repeat(64), iterations: 210000 })
    const list = await readCredentialChecksums()
    expect(list).toHaveLength(1)
    expect(findChecksumMatch(list, 'a'.repeat(64), 210000)).toBe(true)
  })

  it('defaults roaming ON and clears sync on OFF', async () => {
    expect(await getBrowserKeyRoaming()).toBe(true)
    await writeEasyBlobsMap({
      version: 2,
      byTwitterId: {
        '1': {
          version: 2,
          updatedAt: 1,
          ncryptsec: 'ncryptsec1qq',
          pubkeyHint: 'b'.repeat(64),
          boundTwitterId: '1',
          boundUpdatedAt: 1,
        },
      },
    })
    await appendCredentialChecksum({ checksum: 'c'.repeat(64) })
    await setBrowserKeyRoaming(false)
    expect(await getBrowserKeyRoaming()).toBe(false)
    await clearAllRoamingSyncData()
    expect(await readCredentialChecksums()).toHaveLength(0)
    expect(countLiveEasyBlobs(await readEasyBlobsMap())).toBe(0)
  })

  it('writes delete markers without secrets', async () => {
    await writeEasyBlobsMap({
      version: 2,
      byTwitterId: {
        '99': {
          version: 2,
          updatedAt: 1,
          ncryptsec: 'ncryptsec1secret',
          mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
          pubkeyHint: 'ab'.repeat(32),
          boundTwitterId: '99',
          boundUpdatedAt: 1,
        },
      },
    })
    await markEasyBlobDeletedForTwitterId('99', {
      pubkeyHint: 'ab'.repeat(32),
    })
    const map = await readEasyBlobsMap()
    const entry = map.byTwitterId['99']
    expect(entry.deleted).toBe(true)
    expect(entry.ncryptsec).toBeUndefined()
    expect(entry.mnemonic).toBeUndefined()
    expect(entry.npubDeleted).toMatch(/^npub1/)
    expect(countLiveEasyBlobs(map)).toBe(0)
  })
})
