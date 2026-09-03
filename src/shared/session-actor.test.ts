import { describe, expect, it } from 'vitest'
import {
  VIEWER_BOUND_ERROR,
  VIEWER_FORBIDDEN_ERROR,
  VIEWER_NO_IDENTITY_ERROR,
  VIEWER_RESEED_ERROR,
  lockedOperatorViewerState,
  parseViewerOverlay,
  publishDestinationForOperator,
  resolveViewer,
  type OperatorIdentity,
} from './session-actor.ts'

const PUBKEY = 'ab'.repeat(32)
const OTHER = 'cd'.repeat(32)

const signingOperator: OperatorIdentity = {
  pubkey: PUBKEY,
  accountId: 'acct-1',
  canSign: true,
}

const readOnlyOperator: OperatorIdentity = {
  pubkey: PUBKEY.toUpperCase(),
  accountId: 'acct-ro',
  canSign: false,
}

describe('publishDestinationForOperator', () => {
  it('maps demo + canSign to local', () => {
    expect(publishDestinationForOperator('demo', true)).toBe('local')
  })

  it('maps production + canSign to relay', () => {
    expect(publishDestinationForOperator('production', true)).toBe('relay')
  })

  it('maps !canSign to forbidden in both modes', () => {
    expect(publishDestinationForOperator('demo', false)).toBe('forbidden')
    expect(publishDestinationForOperator('production', false)).toBe('forbidden')
  })
})

describe('parseViewerOverlay', () => {
  it('accepts a numeric twitterId and 64-hex pubkey', () => {
    expect(
      parseViewerOverlay({ twitterId: '44196397', pubkey: PUBKEY.toUpperCase() }),
    ).toEqual({ twitterId: '44196397', pubkey: PUBKEY })
  })

  it('rejects missing or malformed overlays', () => {
    expect(parseViewerOverlay(null)).toBeNull()
    expect(parseViewerOverlay({ twitterId: 'elon', pubkey: PUBKEY })).toBeNull()
    expect(parseViewerOverlay({ twitterId: '44196397' })).toBeNull()
  })
})

describe('resolveViewer', () => {
  it('demo signing operator is local and not readOnly', () => {
    const viewer = resolveViewer({
      operator: signingOperator,
      overlayTwitterId: null,
      appMode: 'demo',
    })
    expect(viewer).toEqual({
      origin: 'operator',
      pubkey: PUBKEY,
      publish: 'local',
      readOnly: false,
    })
  })

  it('live signing operator is relay and not readOnly', () => {
    const viewer = resolveViewer({
      operator: signingOperator,
      overlayTwitterId: null,
      appMode: 'production',
    })
    expect(viewer.origin).toBe('operator')
    expect(viewer.publish).toBe('relay')
    expect(viewer.readOnly).toBe(false)
    expect(viewer.pubkey).toBe(PUBKEY)
  })

  it('vault readOnly account is forbidden in demo and live', () => {
    for (const appMode of ['demo', 'production'] as const) {
      const viewer = resolveViewer({
        operator: readOnlyOperator,
        overlayTwitterId: null,
        appMode,
      })
      expect(viewer.publish).toBe('forbidden')
      expect(viewer.readOnly).toBe(true)
      expect(viewer.origin).toBe('operator')
      expect(viewer.pubkey).toBe(PUBKEY)
    }
  })

  it('demo impersonation is local even when the operator cannot sign', () => {
    const viewer = resolveViewer({
      operator: readOnlyOperator,
      overlayTwitterId: '44196397',
      impersonationPubkey: OTHER,
      appMode: 'demo',
    })
    expect(viewer).toEqual({
      origin: 'impersonation',
      twitterId: '44196397',
      pubkey: OTHER,
      publish: 'local',
      readOnly: false,
    })
  })

  it('live impersonation is forbidden / readOnly', () => {
    const viewer = resolveViewer({
      operator: signingOperator,
      overlayTwitterId: '44196397',
      impersonationPubkey: OTHER,
      appMode: 'production',
    })
    expect(viewer.origin).toBe('impersonation')
    expect(viewer.publish).toBe('forbidden')
    expect(viewer.readOnly).toBe(true)
    expect(viewer.pubkey).toBe(OTHER)
    expect(viewer.twitterId).toBe('44196397')
  })

  it('overlay without impersonationPubkey follows the operator', () => {
    const viewer = resolveViewer({
      operator: signingOperator,
      overlayTwitterId: '44196397',
      appMode: 'demo',
    })
    expect(viewer.origin).toBe('operator')
    expect(viewer.pubkey).toBe(PUBKEY)
  })

  it('throws when the operator has no pubkey and there is no overlay', () => {
    expect(() =>
      resolveViewer({
        operator: { canSign: false },
        overlayTwitterId: null,
        appMode: 'production',
      }),
    ).toThrow(VIEWER_NO_IDENTITY_ERROR)
  })

  it('forbidden error copy matches live bind-gate', () => {
    expect(VIEWER_FORBIDDEN_ERROR).toBe(
      'Read-only Nostr accounts cannot publish X trust or proofs',
    )
  })

  it('exposes re-seed and bound-vault copy', () => {
    expect(VIEWER_RESEED_ERROR).toBe('Re-seed demo data first')
    expect(VIEWER_BOUND_ERROR).toBe('bound to your vault')
  })

  it('locked operator RPC shape has no pubkey', () => {
    expect(lockedOperatorViewerState()).toEqual({
      origin: 'operator',
      publish: 'forbidden',
      readOnly: true,
    })
  })
})
