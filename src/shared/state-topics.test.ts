import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  STATE_TOPICS,
  parseStateTopicMessage,
  stateTopicMessage,
  subscribeStateTopic,
  type StateTopicMessage,
} from './state-topics.ts'

type MessageListener = (message: unknown) => void

const listeners = new Set<MessageListener>()
const addListener = vi.fn((listener: MessageListener) => {
  listeners.add(listener)
})
const removeListener = vi.fn((listener: MessageListener) => {
  listeners.delete(listener)
})

afterEach(() => {
  listeners.clear()
  addListener.mockClear()
  removeListener.mockClear()
  vi.unstubAllGlobals()
})

function installChromeMessageMock(): void {
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: {
        addListener,
        removeListener,
      },
    },
  })
}

describe('state topics', () => {
  it('keeps wire message types unique and protects identity-blind topics', () => {
    const types = Object.values(STATE_TOPICS).map((topic) => topic.type)
    expect(new Set(types).size).toBe(types.length)
    expect(STATE_TOPICS.viewer.tabs).toBe(false)
    expect(STATE_TOPICS.profileMetadata.tabs).toBe(false)
    expect(STATE_TOPICS.panelSession.tabs).toBe(false)
    expect(STATE_TOPICS.trustGraph.tabs).toBe(true)
    expect(STATE_TOPICS.identity.tabs).toBe(true)
  })

  it('builds existing wire messages without changing their shape', () => {
    expect(stateTopicMessage('trustGraph')).toEqual({
      type: 'TRUST_GRAPH_UPDATED',
    })
    expect(
      stateTopicMessage('viewer', {
        origin: 'impersonation',
        twitterId: '44196397',
        pubkey: 'ab'.repeat(32),
        publish: 'local',
        readOnly: false,
      }),
    ).toEqual({
      type: 'VIEWER_CHANGED',
      origin: 'impersonation',
      twitterId: '44196397',
      pubkey: 'ab'.repeat(32),
      publish: 'local',
      readOnly: false,
    })
  })

  it('filters and parses messages, then unsubscribes cleanly', () => {
    installChromeMessageMock()
    const received: Array<StateTopicMessage<'viewer'>> = []
    const unsubscribe = subscribeStateTopic('viewer', (message) => {
      received.push(message)
    })

    expect(addListener).toHaveBeenCalledTimes(1)
    for (const listener of listeners) {
      listener({ type: 'TRUST_GRAPH_UPDATED' })
      listener({
        type: 'VIEWER_CHANGED',
        origin: 'impersonation',
        twitterId: '44196397',
        pubkey: 'AB'.repeat(32),
        publish: 'local',
        readOnly: false,
      })
      listener({
        type: 'VIEWER_CHANGED',
        origin: 'invalid',
        publish: 'forbidden',
        readOnly: true,
      })
    }

    expect(received).toEqual([
      {
        type: 'VIEWER_CHANGED',
        origin: 'impersonation',
        twitterId: '44196397',
        pubkey: 'ab'.repeat(32),
        publish: 'local',
        readOnly: false,
      },
    ])

    unsubscribe()
    expect(removeListener).toHaveBeenCalledTimes(1)
    expect(listeners).toHaveLength(0)
  })

  it('rejects malformed messages through the pure parser', () => {
    expect(
      parseStateTopicMessage('appMode', {
        type: 'APP_MODE_CHANGED',
        mode: 'demo',
      }),
    ).toEqual({ type: 'APP_MODE_CHANGED', mode: 'demo' })
    expect(
      parseStateTopicMessage('appMode', {
        type: 'APP_MODE_CHANGED',
        mode: 'staging',
      }),
    ).toBeUndefined()
    expect(
      parseStateTopicMessage('wotMaxDegree', {
        type: 'WOT_MAX_DEGREE_CHANGED',
        degree: Number.NaN,
      }),
    ).toBeUndefined()
  })
})
