import { generateSecretKey, getPublicKey, finalizeEvent, type Event } from 'nostr-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { resetChromeStorage } from '../../../../background/test-chrome-mock.ts'
import { profileCache } from './state.ts'
import {
  dropObsoleteKind0StorageKeys,
  peekProfileMetadata,
  resetKind0DisplayCacheForTests,
  saveKind0Event,
  setKind0RecordStore,
  type Kind0RecordStore,
} from './profile-handlers.ts'

const PUBKEY = 'a'.repeat(64)

afterEach(() => {
  resetKind0DisplayCacheForTests()
  resetChromeStorage()
})

function memoryStore(): Kind0RecordStore & {
  saved: Event[]
} {
  const rows = new Map<string, Record<string, unknown>>()
  const saved: Event[] = []
  return {
    saved,
    async read(pubkey) {
      return rows.get(pubkey) ?? null
    },
    async save(event) {
      saved.push(event)
      rows.set(event.pubkey, JSON.parse(event.content) as Record<string, unknown>)
    },
  }
}

describe('peekProfileMetadata', () => {
  it('returns in-memory metadata without reading the store', async () => {
    profileCache.set(PUBKEY, {
      metadata: { name: 'Cached' },
      fetchedAt: 1,
    })
    await expect(peekProfileMetadata(PUBKEY)).resolves.toEqual({ name: 'Cached' })
  })

  it('returns the kind 0 event stored for that pubkey', async () => {
    setKind0RecordStore({
      async read(pubkey) {
        return pubkey === PUBKEY ? { name: 'Stored' } : null
      },
      async save() {},
    })
    await expect(peekProfileMetadata(PUBKEY)).resolves.toEqual({ name: 'Stored' })
  })

  it('returns null when nothing is stored', async () => {
    await expect(peekProfileMetadata(PUBKEY)).resolves.toBeNull()
  })

  it('saves a signed kind 0 event and does not write a profile key', async () => {
    const store = memoryStore()
    setKind0RecordStore(store)
    const secret = generateSecretKey()
    const event = finalizeEvent(
      {
        kind: 0,
        created_at: 10,
        tags: [],
        content: JSON.stringify({ name: 'Live' }),
      },
      secret,
    )
    await saveKind0Event(event)
    expect(getPublicKey(secret)).toBe(event.pubkey)
    await expect(peekProfileMetadata(event.pubkey)).resolves.toEqual({ name: 'Live' })
    expect(store.saved).toHaveLength(1)
    const chromeKeys = Object.keys(await chrome.storage.local.get(null))
    expect(chromeKeys.some((key) => key.startsWith('profile_'))).toBe(false)
    expect(chromeKeys).not.toContain('kind0DisplayCache')
  })
})

describe('dropObsoleteKind0StorageKeys', () => {
  it('removes leftover profile keys and leaves other settings', async () => {
    await chrome.storage.local.set({
      [`profile_${PUBKEY}`]: { metadata: { name: 'Old' }, fetchedAt: 1 },
      kind0DisplayCache: { entries: {} },
      inactiveRelays: ['wss://nos.lol'],
    })
    await dropObsoleteKind0StorageKeys()
    const stored = await chrome.storage.local.get(null)
    expect(stored[`profile_${PUBKEY}`]).toBeUndefined()
    expect(stored.kind0DisplayCache).toBeUndefined()
    expect(stored.inactiveRelays).toEqual(['wss://nos.lol'])
  })
})
