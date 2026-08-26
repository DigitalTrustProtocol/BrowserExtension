import { describe, expect, it } from 'vitest'
import { TRUST_GRAPH_UPDATED_MESSAGE } from '../../shared/demo-wot'
import {
  graphViewRefreshToken,
  isTrustGraphUpdatedMessage,
} from './graph-stale'

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
  })
})

describe('graphViewRefreshToken', () => {
  it('bumps only this tab when Refresh Graph is clicked', () => {
    expect(graphViewRefreshToken(0, 0)).toBe(0)
    expect(graphViewRefreshToken(0, 1)).toBe(1)
    expect(graphViewRefreshToken(3, 2)).toBe(5)
  })
})
