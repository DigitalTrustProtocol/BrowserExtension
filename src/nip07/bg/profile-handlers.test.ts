import { afterEach, describe, expect, it } from 'vitest'
import { resetChromeStorage } from '../../background/test-chrome-mock.ts'
import { profileCache } from './state.ts'
import { peekProfileMetadata, putProfileMetadata } from './profile-handlers.ts'

const PUBKEY = 'a'.repeat(64)

afterEach(() => {
  profileCache.clear()
  resetChromeStorage()
})

describe('peekProfileMetadata', () => {
  it('returns in-memory metadata without waiting on relays', async () => {
    profileCache.set(PUBKEY, {
      metadata: { name: 'Cached' },
      fetchedAt: 1,
    })
    await expect(peekProfileMetadata(PUBKEY)).resolves.toEqual({ name: 'Cached' })
  })

  it('returns last-known chrome.storage metadata when memory is empty', async () => {
    await chrome.storage.local.set({
      [`profile_${PUBKEY}`]: {
        metadata: { name: 'Stored' },
        fetchedAt: 1,
      },
    })
    await expect(peekProfileMetadata(PUBKEY)).resolves.toEqual({ name: 'Stored' })
  })

  it('returns null when nothing is cached', async () => {
    await expect(peekProfileMetadata(PUBKEY)).resolves.toBeNull()
  })

  it('writes via putProfileMetadata then peeks the same value', async () => {
    await putProfileMetadata(PUBKEY, { name: 'Live' })
    await expect(peekProfileMetadata(PUBKEY)).resolves.toEqual({ name: 'Live' })
  })
})
