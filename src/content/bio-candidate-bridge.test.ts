import { describe, expect, it, vi } from 'vitest'
import {
  OBSERVED_X_BIO_MESSAGE,
  OBSERVED_X_BIO_SOURCE,
  OBSERVED_X_BIO_VERSION,
} from '../shared/observed-x-bio'
import { startBioCandidateBridge } from './bio-candidate-bridge'

const NPUB = `npub1${'q'.repeat(60)}`

describe('bio candidate bridge', () => {
  it('validates the message schema and forwards only structured candidates', () => {
    let deliver: ((data: unknown) => void) | undefined
    const forwardCandidates = vi.fn()
    const bridge = startBioCandidateBridge({
      forwardCandidates,
      subscribeInbound: (handler) => {
        deliver = handler
        return () => {
          deliver = undefined
        }
      },
    })

    const candidate = {
      twitterId: '11348282',
      handle: 'nasa',
      npub: NPUB,
      npubCount: 1 as const,
      postId: '2080659774136291424',
      postCreatedAt: 1_700_000_000_000,
      observedAt: 1_700_000_000_001,
    }

    // Wrong version is dropped entirely.
    deliver?.({
      source: OBSERVED_X_BIO_SOURCE,
      type: OBSERVED_X_BIO_MESSAGE,
      version: 99,
      candidates: [candidate],
    })
    deliver?.({
      source: OBSERVED_X_BIO_SOURCE,
      type: OBSERVED_X_BIO_MESSAGE,
      version: OBSERVED_X_BIO_VERSION,
      candidates: [candidate],
    })

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(forwardCandidates).toHaveBeenCalledOnce()
        expect(forwardCandidates).toHaveBeenCalledWith([candidate])
        bridge.stop()
        resolve()
      }, 200)
    })
  })

  it('deduplicates by twitterId, keeping the newer candidate (not last-received)', () => {
    let deliver: ((data: unknown) => void) | undefined
    const forwardCandidates = vi.fn()
    const bridge = startBioCandidateBridge({
      forwardCandidates,
      subscribeInbound: (handler) => {
        deliver = handler
        return () => {
          deliver = undefined
        }
      },
    })

    const older = {
      twitterId: '11348282',
      handle: 'nasa',
      npub: NPUB,
      npubCount: 1 as const,
      postId: '111',
      postCreatedAt: 1_000,
      observedAt: 100,
    }
    const newer = {
      twitterId: '11348282',
      handle: 'nasa',
      npub: NPUB,
      npubCount: 1 as const,
      postId: '222',
      postCreatedAt: 2_000,
      observedAt: 50,
    }

    deliver?.({
      source: OBSERVED_X_BIO_SOURCE,
      type: OBSERVED_X_BIO_MESSAGE,
      version: OBSERVED_X_BIO_VERSION,
      candidates: [newer],
    })
    // Older carrier post arrives later — must not overwrite.
    deliver?.({
      source: OBSERVED_X_BIO_SOURCE,
      type: OBSERVED_X_BIO_MESSAGE,
      version: OBSERVED_X_BIO_VERSION,
      candidates: [older],
    })

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(forwardCandidates).toHaveBeenCalledOnce()
        expect(forwardCandidates).toHaveBeenCalledWith([newer])
        bridge.stop()
        resolve()
      }, 200)
    })
  })

  it('when postCreatedAt is absent, keeps the higher observedAt', () => {
    let deliver: ((data: unknown) => void) | undefined
    const forwardCandidates = vi.fn()
    const bridge = startBioCandidateBridge({
      forwardCandidates,
      subscribeInbound: (handler) => {
        deliver = handler
        return () => {
          deliver = undefined
        }
      },
    })

    const first = {
      twitterId: '11348282',
      handle: 'nasa',
      npub: NPUB,
      npubCount: 1 as const,
      observedAt: 200,
    }
    const second = {
      twitterId: '11348282',
      handle: 'nasa',
      npub: NPUB,
      npubCount: 1 as const,
      observedAt: 100,
    }

    deliver?.({
      source: OBSERVED_X_BIO_SOURCE,
      type: OBSERVED_X_BIO_MESSAGE,
      version: OBSERVED_X_BIO_VERSION,
      candidates: [first],
    })
    deliver?.({
      source: OBSERVED_X_BIO_SOURCE,
      type: OBSERVED_X_BIO_MESSAGE,
      version: OBSERVED_X_BIO_VERSION,
      candidates: [second],
    })

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(forwardCandidates).toHaveBeenCalledOnce()
        expect(forwardCandidates).toHaveBeenCalledWith([first])
        bridge.stop()
        resolve()
      }, 200)
    })
  })

  it('stops forwarding once stopped', () => {
    let deliver: ((data: unknown) => void) | undefined
    const forwardCandidates = vi.fn()
    const bridge = startBioCandidateBridge({
      forwardCandidates,
      subscribeInbound: (handler) => {
        deliver = handler
        return () => {
          deliver = undefined
        }
      },
    })
    bridge.stop()

    deliver?.({
      source: OBSERVED_X_BIO_SOURCE,
      type: OBSERVED_X_BIO_MESSAGE,
      version: OBSERVED_X_BIO_VERSION,
      candidates: [
        {
          twitterId: '11348282',
          handle: 'nasa',
          npub: NPUB,
          npubCount: 1 as const,
          observedAt: 100,
        },
      ],
    })

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(forwardCandidates).not.toHaveBeenCalled()
        resolve()
      }, 200)
    })
  })
})
