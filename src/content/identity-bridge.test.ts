import { describe, expect, it, vi } from 'vitest'
import {
  OBSERVED_X_IDENTITY_MESSAGE,
  OBSERVED_X_IDENTITY_SOURCE,
  OBSERVED_X_IDENTITY_VERSION,
} from '../shared/observed-x-identity'
import { startIdentityBridge } from './identity-bridge'

describe('identity bridge', () => {
  it('validates source and schema, enriches, deduplicates, and batches', () => {
    let listener: ((event: MessageEvent<unknown>) => void) | undefined
    const target = {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
      addEventListener: vi.fn(
        (_type: string, callback: (event: MessageEvent<unknown>) => void) => {
          listener = callback
        },
      ),
      removeEventListener: vi.fn(),
      document: {},
    } as unknown as Window
    const forwardBatch = vi.fn()
    const bridge = startIdentityBridge({
      targetWindow: target,
      now: () => 500,
      renderedPostIds: () => ['222'],
      forwardBatch,
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

    listener?.({ source: {}, data: message } as MessageEvent)
    listener?.({ source: target, data: { ...message, version: 99 } } as MessageEvent)
    listener?.({ source: target, data: message } as MessageEvent)
    listener?.({
      source: target,
      data: {
        ...message,
        observations: [{ ...observation, observedAt: 200, postIds: ['333'] }],
      },
    } as MessageEvent)
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
    let listener: ((event: MessageEvent<unknown>) => void) | undefined
    const target = {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
      addEventListener: vi.fn(
        (_type: string, callback: (event: MessageEvent<unknown>) => void) => {
          listener = callback
        },
      ),
      removeEventListener: vi.fn(),
      document: {},
    } as unknown as Window
    const forwardBatch = vi.fn()
    const bridge = startIdentityBridge({
      targetWindow: target,
      now: () => 1_234,
      renderedPostIds: () => [],
      forwardBatch,
    })
    const message = {
      source: OBSERVED_X_IDENTITY_SOURCE,
      type: OBSERVED_X_IDENTITY_MESSAGE,
      version: OBSERVED_X_IDENTITY_VERSION,
      observations: [
        {
          twitterId: '11348282',
          handle: 'nasa',
          observedAt: Number.MAX_SAFE_INTEGER,
          sourceOperation: 'AccountSettings',
        },
      ],
    }

    listener?.({ source: target, data: message } as MessageEvent)
    bridge.flush()
    expect(forwardBatch).not.toHaveBeenCalled()
    listener?.({
      source: target,
      data: {
        ...message,
        observations: [
          { ...message.observations[0], sourceOperation: 'TweetDetail' },
        ],
      },
    } as MessageEvent)
    bridge.flush()

    expect(forwardBatch).toHaveBeenCalledWith({
      version: 1,
      observations: [
        {
          twitterId: '11348282',
          handle: 'nasa',
          observedAt: 1_234,
          sourceOperation: 'TweetDetail',
        },
      ],
    })
    bridge.stop()
  })
})
