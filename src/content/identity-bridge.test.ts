import { describe, expect, it, vi } from 'vitest'
import {
  OBSERVED_X_IDENTITY_MESSAGE,
  OBSERVED_X_IDENTITY_SOURCE,
  OBSERVED_X_IDENTITY_VERSION,
} from '../shared/observed-x-identity'
import { startIdentityBridge } from './identity-bridge'

describe('identity bridge', () => {
  it('validates source and schema, enriches, deduplicates, and batches', () => {
    let deliver: ((data: unknown) => void) | undefined
    const target = {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
      document: {},
    } as unknown as Window
    const forwardBatch = vi.fn()
    const bridge = startIdentityBridge({
      targetWindow: target,
      now: () => 500,
      renderedPostIds: () => ['222'],
      forwardBatch,
      subscribeInbound: (handler) => {
        deliver = handler
        return () => {
          deliver = undefined
        }
      },
    })
    const observation = {
      twitterId: '11348282',
      handle: 'NASA',
      observedAt: 100,
      sourceOperation: 'TweetDetail',
      postIds: ['111'],
    }
    const message = {
      source: OBSERVED_X_IDENTITY_SOURCE,
      type: OBSERVED_X_IDENTITY_MESSAGE,
      version: OBSERVED_X_IDENTITY_VERSION,
      observations: [observation],
    }

    deliver?.({ ...message, version: 99 })
    deliver?.(message)
    deliver?.({
      ...message,
      observations: [{ ...observation, observedAt: 200, postIds: ['333'] }],
    })
    bridge.flush()

    expect(forwardBatch).toHaveBeenCalledOnce()
    expect(forwardBatch).toHaveBeenCalledWith({
      version: 1,
      observations: [
        {
          twitterId: '11348282',
          handle: 'nasa',
          observedAt: 500,
          sourceOperation: 'TweetDetail',
          postIds: ['111', '222', '333'],
        },
      ],
    })
    bridge.stop()
  })

  it('rejects forged operations and replaces future page timestamps', () => {
    let deliver: ((data: unknown) => void) | undefined
    const target = {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
      document: {},
    } as unknown as Window
    const forwardBatch = vi.fn()
    const bridge = startIdentityBridge({
      targetWindow: target,
      now: () => 1_000,
      renderedPostIds: () => [],
      forwardBatch,
      subscribeInbound: (handler) => {
        deliver = handler
        return () => {
          deliver = undefined
        }
      },
    })

    deliver?.({
      source: OBSERVED_X_IDENTITY_SOURCE,
      type: OBSERVED_X_IDENTITY_MESSAGE,
      version: OBSERVED_X_IDENTITY_VERSION,
      observations: [
        {
          twitterId: '1',
          handle: 'a',
          observedAt: 9_999_999,
          sourceOperation: 'NotAllowed',
        },
        {
          twitterId: '11348282',
          handle: 'nasa',
          observedAt: 9_999_999,
          sourceOperation: 'UserByScreenName',
        },
      ],
    })
    bridge.flush()

    expect(forwardBatch).toHaveBeenCalledWith({
      version: 1,
      observations: [
        {
          twitterId: '11348282',
          handle: 'nasa',
          observedAt: 1_000,
          sourceOperation: 'UserByScreenName',
        },
      ],
    })
    bridge.stop()
  })
})
