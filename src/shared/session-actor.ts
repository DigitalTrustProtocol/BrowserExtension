/**
 * Session actor: vault operator vs trust viewer.
 *
 * Overlay `{ twitterId, pubkey }` is resolved once in SET_VIEWER and stored
 * in chrome.storage.session. `#viewer()` stays sync.
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

/** RPC / broadcast shape. `pubkey` is optional when the vault is locked and there is no overlay. */
export interface ViewerState {
  origin: ViewerOrigin
  twitterId?: string
  pubkey?: string
  publish: PublishDestination
  readOnly: boolean
}

export interface ViewerOverlay {
  twitterId: string
  pubkey: string
}

export const VIEWER_UNLOCK_ERROR = 'Unlock the AttentionX vault to sign'
export const VIEWER_NO_IDENTITY_ERROR =
  'Create or import a signing identity from the AttentionX popup first'
export const VIEWER_FORBIDDEN_ERROR =
  'Read-only Nostr accounts cannot publish X trust or proofs'
export const VIEWER_RESEED_ERROR = 'Re-seed demo data first'
export const VIEWER_BOUND_ERROR = 'bound to your vault'
export const VIEWER_NO_LIVE_NPUB_ERROR =
  'No known Nostr identity for this X account'

export const VIEWER_CHANGED_MESSAGE = 'VIEWER_CHANGED' as const
export const VIEWER_OVERLAY_SESSION_KEY = 'attentionxViewerOverlay'

const HEX_64 = /^[0-9a-f]{64}$/
const TWITTER_ID = /^\d+$/

export function normalizeOperatorPubkey(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const hex = value.trim().toLowerCase()
  return HEX_64.test(hex) ? hex : undefined
}

export function parseViewerOverlay(value: unknown): ViewerOverlay | null {
  if (!value || typeof value !== 'object') return null
  const record = value as { twitterId?: unknown; pubkey?: unknown }
  if (typeof record.twitterId !== 'string') return null
  const twitterId = record.twitterId.trim()
  const pubkey = normalizeOperatorPubkey(
    typeof record.pubkey === 'string' ? record.pubkey : undefined,
  )
  if (!TWITTER_ID.test(twitterId) || !pubkey) return null
  return { twitterId, pubkey }
}

export function parseViewerState(value: unknown): ViewerState | null {
  if (!value || typeof value !== 'object') return null
  const record = value as {
    origin?: unknown
    twitterId?: unknown
    pubkey?: unknown
    publish?: unknown
    readOnly?: unknown
  }
  const origin = record.origin
  if (origin !== 'operator' && origin !== 'impersonation') return null
  const publish = record.publish
  if (publish !== 'relay' && publish !== 'local' && publish !== 'forbidden') {
    return null
  }
  if (typeof record.readOnly !== 'boolean') return null
  const twitterId =
    typeof record.twitterId === 'string' && TWITTER_ID.test(record.twitterId.trim())
      ? record.twitterId.trim()
      : undefined
  const pubkey = normalizeOperatorPubkey(
    typeof record.pubkey === 'string' ? record.pubkey : undefined,
  )
  return {
    origin,
    publish,
    readOnly: record.readOnly,
    ...(twitterId ? { twitterId } : {}),
    ...(pubkey ? { pubkey } : {}),
  }
}

export function publishDestinationForOperator(
  appMode: AppMode,
  canSign: boolean,
): PublishDestination {
  if (!canSign) return 'forbidden'
  return appMode === 'demo' ? 'local' : 'relay'
}

export function viewerStateFromIdentity(viewer: ViewerIdentity): ViewerState {
  return {
    origin: viewer.origin,
    ...(viewer.twitterId ? { twitterId: viewer.twitterId } : {}),
    pubkey: viewer.pubkey,
    publish: viewer.publish,
    readOnly: viewer.readOnly,
  }
}

export function lockedOperatorViewerState(): ViewerState {
  return {
    origin: 'operator',
    publish: 'forbidden',
    readOnly: true,
  }
}

/**
 * Resolve the trust viewer from the vault operator and optional overlay.
 * Overlay pubkey is a SET_VIEWER snapshot — do not re-read xIdentities here.
 */
export function resolveViewer(input: {
  operator: OperatorIdentity
  overlayTwitterId: string | null
  appMode: AppMode
  impersonationPubkey?: string
}): ViewerIdentity {
  const overlayId =
    typeof input.overlayTwitterId === 'string' && input.overlayTwitterId.trim()
      ? input.overlayTwitterId.trim()
      : null
  const impersonation = normalizeOperatorPubkey(input.impersonationPubkey)
  if (overlayId && impersonation) {
    const publish: PublishDestination =
      input.appMode === 'demo' ? 'local' : 'forbidden'
    return {
      origin: 'impersonation',
      twitterId: overlayId,
      pubkey: impersonation,
      publish,
      readOnly: publish === 'forbidden',
    }
  }

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
