/**
 * Session actor: vault operator vs trust viewer.
 *
 * Plan 1: viewer always follows the operator (overlay is ignored).
 * Plan 2 will resolve overlayTwitterId to an impersonation viewer.
 *
 * @module shared/session-actor
 */

import type { AppMode } from './app-mode.ts'

export type PublishDestination = 'relay' | 'local' | 'forbidden'

export type ViewerOrigin = 'operator' | 'impersonation'

export interface OperatorIdentity {
  pubkey?: string
  accountId?: string
  canSign: boolean
}

export interface ViewerIdentity {
  origin: ViewerOrigin
  twitterId?: string
  pubkey: string
  publish: PublishDestination
  readOnly: boolean
}

export const VIEWER_UNLOCK_ERROR = 'Unlock the AttentionX vault to sign'
export const VIEWER_NO_IDENTITY_ERROR =
  'Create or import a signing identity from the AttentionX popup first'
export const VIEWER_FORBIDDEN_ERROR =
  'Read-only Nostr accounts cannot publish X trust or proofs'

const HEX_64 = /^[0-9a-f]{64}$/

export function normalizeOperatorPubkey(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const hex = value.trim().toLowerCase()
  return HEX_64.test(hex) ? hex : undefined
}

export function publishDestinationForOperator(
  appMode: AppMode,
  canSign: boolean,
): PublishDestination {
  if (!canSign) return 'forbidden'
  return appMode === 'demo' ? 'local' : 'relay'
}

/**
 * Resolve the trust viewer from the vault operator.
 * `overlayTwitterId` is accepted for the plan-2 signature but ignored here.
 */
export function resolveViewer(input: {
  operator: OperatorIdentity
  overlayTwitterId: string | null
  appMode: AppMode
  impersonationPubkey?: string
}): ViewerIdentity {
  const pubkey = normalizeOperatorPubkey(input.operator.pubkey)
  if (!pubkey) {
    throw new Error(VIEWER_NO_IDENTITY_ERROR)
  }
  const publish = publishDestinationForOperator(
    input.appMode,
    input.operator.canSign,
  )
  return {
    origin: 'operator',
    pubkey,
    publish,
    readOnly: publish === 'forbidden',
  }
}
