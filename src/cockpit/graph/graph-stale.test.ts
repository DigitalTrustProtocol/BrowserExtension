import { describe, expect, it } from 'vitest'
import { TRUST_GRAPH_UPDATED_MESSAGE } from '../../shared/demo-wot'
import { VIEWER_CHANGED_MESSAGE } from '../../shared/session-actor'
import {
  APPLICATION_STALE_TOPICS,
  GRAPH_STALE_TOPICS,
  graphViewRefreshToken,
  isStaleTopicMessage,
  isTrustGraphUpdatedMessage,
} from './graph-stale'

const VIEWER_PAYLOAD = {
  type: VIEWER_CHANGED_MESSAGE,
  origin: 'impersonation',
  twitterId: '44196397',
  pubkey: 'ab'.repeat(32),
  publish: 'local',
  readOnly: false,
} as const

const IDENTITY_PAYLOAD = {
  type: 'X_IDENTITY_UPDATED',
  twitterId: '44196397',
  state: 'verified',
  handle: 'elonmusk',
  statusChanged: false,
} as const

describe('isTrustGraphUpdatedMessage', () => {
  it('accepts the backend graph-updated broadcast', () => {
    expect(
      isTrustGraphUpdatedMessage({ type: TRUST_GRAPH_UPDATED_MESSAGE }),
    ).toBe(true)
  })

  it('rejects unrelated messages', () => {
    expect(isTrustGraphUpdatedMessage(undefined)).toBe(false)
    expect(isTrustGraphUpdatedMessage(null)).toBe(false)
    expect(isTrustGraphUpdatedMessage({ type: 'NOSTR_ACCOUNT_CHANGED' })).toBe(
      false,
    )
    expect(isTrustGraphUpdatedMessage('TRUST_GRAPH_UPDATED')).toBe(false)
    expect(isTrustGraphUpdatedMessage(VIEWER_PAYLOAD)).toBe(false)
  })
})

describe('isStaleTopicMessage', () => {
  it('marks Graph stale on trust, viewer, and identity', () => {
    expect(GRAPH_STALE_TOPICS).toEqual(['trustGraph', 'viewer', 'identity'])
    expect(
      isStaleTopicMessage({ type: TRUST_GRAPH_UPDATED_MESSAGE }),
    ).toBe(true)
    expect(isStaleTopicMessage(VIEWER_PAYLOAD)).toBe(true)
    expect(isStaleTopicMessage(IDENTITY_PAYLOAD)).toBe(true)
    expect(isStaleTopicMessage({ type: 'ACTIVITY_CHANGED' })).toBe(false)
    expect(
      isStaleTopicMessage({
        type: VIEWER_CHANGED_MESSAGE,
        origin: 'invalid',
        publish: 'local',
        readOnly: false,
      }),
    ).toBe(false)
  })

  it('marks Application stale on the broader topic set', () => {
    expect(APPLICATION_STALE_TOPICS).toEqual([
      'trustGraph',
      'activity',
      'viewer',
      'identity',
      'profileMetadata',
      'appMode',
      'wotMaxDegree',
    ])
    expect(
      isStaleTopicMessage(
        { type: 'ACTIVITY_CHANGED' },
        APPLICATION_STALE_TOPICS,
      ),
    ).toBe(true)
    expect(
      isStaleTopicMessage(
        { type: 'PROFILE_METADATA_UPDATED', pubkey: 'ab'.repeat(32) },
        APPLICATION_STALE_TOPICS,
      ),
    ).toBe(true)
    expect(
      isStaleTopicMessage(
        { type: 'PANEL_SESSION_CHANGED', snapshot: {} },
        APPLICATION_STALE_TOPICS,
      ),
    ).toBe(false)
  })
})

describe('graphViewRefreshToken', () => {
  it('bumps only this tab when Refresh Graph is clicked', () => {
    expect(graphViewRefreshToken(0, 0)).toBe(0)
    expect(graphViewRefreshToken(0, 1)).toBe(1)
    expect(graphViewRefreshToken(3, 2)).toBe(5)
  })
})
