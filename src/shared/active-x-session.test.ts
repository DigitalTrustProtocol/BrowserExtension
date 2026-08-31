import { describe, expect, it } from 'vitest'
import {
  ACTIVE_X_TAB_REGISTRY_MAX,
  bumpTabNavigationEpoch,
  emptyActiveXTabRegistry,
  ensureCommitMatches,
  observationForTab,
  pruneActiveXTabRegistry,
  removeActiveXTabObservation,
  upsertActiveXTabObservation,
  activeXAccountFromUnknown,
} from './active-x-session.ts'

describe('active X tab registry', () => {
  it('stores observations per tab and does not leak across tabs', () => {
    let registry = emptyActiveXTabRegistry()
    registry = upsertActiveXTabObservation(
      registry,
      {
        tabId: 1,
        windowId: 1,
        status: 'identified',
        observedAt: 10,
        navigationEpoch: 0,
        account: { handle: 'alice', twitterId: '1', detectedAt: 10 },
      },
      10,
    )
    registry = upsertActiveXTabObservation(
      registry,
      {
        tabId: 2,
        windowId: 1,
        status: 'loggedOut',
        observedAt: 11,
        navigationEpoch: 0,
      },
      11,
    )
    expect(observationForTab(registry, 1)?.status).toBe('identified')
    expect(observationForTab(registry, 1)?.account?.twitterId).toBe('1')
    expect(observationForTab(registry, 2)?.status).toBe('loggedOut')
    registry = removeActiveXTabObservation(registry, 1)
    expect(observationForTab(registry, 1)).toBeUndefined()
    expect(observationForTab(registry, 2)?.status).toBe('loggedOut')
  })

  it('keeps an identified observation that has twitterId but no handle yet', () => {
    expect(
      activeXAccountFromUnknown({
        handle: '',
        twitterId: '44196397',
        detectedAt: 1,
      }),
    ).toEqual({ handle: '', twitterId: '44196397', detectedAt: 1 })
    let registry = emptyActiveXTabRegistry()
    registry = upsertActiveXTabObservation(
      registry,
      {
        tabId: 3,
        windowId: 1,
        status: 'identified',
        observedAt: 1,
        navigationEpoch: 0,
        account: { handle: '', twitterId: '44196397', detectedAt: 1 },
      },
      1,
    )
    expect(observationForTab(registry, 3)?.status).toBe('identified')
    expect(observationForTab(registry, 3)?.account?.twitterId).toBe('44196397')
  })

  it('bumps navigationEpoch and rejects stale ENSURE commits', () => {
    let registry = emptyActiveXTabRegistry()
    registry = bumpTabNavigationEpoch(registry, 5, 1, 1)
    const epoch1 = observationForTab(registry, 5)?.navigationEpoch ?? 0
    registry = bumpTabNavigationEpoch(registry, 5, 1, 2)
    const epoch2 = observationForTab(registry, 5)?.navigationEpoch ?? 0
    expect(epoch2).toBe(epoch1 + 1)
    expect(
      ensureCommitMatches({
        capturedTabId: 5,
        capturedEpoch: epoch1,
        liveTabId: 5,
        liveEpoch: epoch2,
      }),
    ).toBe(false)
    expect(
      ensureCommitMatches({
        capturedTabId: 5,
        capturedEpoch: epoch2,
        liveTabId: 5,
        liveEpoch: epoch2,
      }),
    ).toBe(true)
  })

  it('prunes stale and over-capacity entries', () => {
    let registry = emptyActiveXTabRegistry()
    for (let i = 0; i < ACTIVE_X_TAB_REGISTRY_MAX + 5; i += 1) {
      registry = upsertActiveXTabObservation(
        registry,
        {
          tabId: i + 1,
          windowId: 1,
          status: 'unknown',
          observedAt: i + 1,
          navigationEpoch: 0,
        },
        i + 1,
      )
    }
    expect(Object.keys(registry.byTabId).length).toBe(ACTIVE_X_TAB_REGISTRY_MAX)
    const pruned = pruneActiveXTabRegistry(registry, 1_000_000_000_000)
    expect(Object.keys(pruned.byTabId).length).toBe(0)
  })
})
