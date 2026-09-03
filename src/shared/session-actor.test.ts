import { describe, expect, it } from 'vitest'
import {
  VIEWER_FORBIDDEN_ERROR,
  VIEWER_NO_IDENTITY_ERROR,
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

  it('ignores overlayTwitterId (plan 1: viewer follows operator)', () => {
    const viewer = resolveViewer({
      operator: signingOperator,
      overlayTwitterId: '44196397',
      appMode: 'demo',
      impersonationPubkey: OTHER,
    })
    expect(viewer.origin).toBe('operator')
    expect(viewer.pubkey).toBe(PUBKEY)
    expect(viewer.publish).toBe('local')
  })

  it('throws when the operator has no pubkey', () => {
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
})
