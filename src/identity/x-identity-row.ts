import { nip19 } from 'nostr-tools'
import { normalizeObservedHandle } from '../shared/observed-x-identity'
import type { ObservedXIdentity } from '../shared/observed-x-identity'
import type {
  IdentityProofState,
  XIdentityBlockedBy,
  XIdentityRecord,
} from '../storage/types'

export interface XIdentityEvaluation {
  state: IdentityProofState
  blockedBy?: XIdentityBlockedBy
  /** True when both sides are present and column values agree. */
  columnsAligned: boolean
}

function normalizeNpub(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim().toLowerCase()
  return trimmed.startsWith('npub1') ? trimmed : undefined
}

function handlesEqual(
  left: string | undefined,
  right: string | undefined,
): boolean {
  const a = left ? normalizeObservedHandle(left) : undefined
  const b = right ? normalizeObservedHandle(right) : undefined
  if (!a || !b) return false
  return a === b
}

/**
 * Derive proof status from xIdentities columns only.
 * Does not load kind 10011 events or call live oEmbed.
 */
export function evaluateXIdentityRow(
  row: Pick<
    XIdentityRecord,
    | 'twitterId'
    | 'xProofNpub'
    | 'xProofPostId'
    | 'xProofHandle'
    | 'nip39Npub'
    | 'nip39XId'
    | 'nip39Handle'
    | 'nip39PostId'
  >,
  options: { proofUnavailable?: boolean } = {},
): XIdentityEvaluation {
  const xNpub = normalizeNpub(row.xProofNpub)
  const nip39Npub = normalizeNpub(row.nip39Npub)
  const hasX = Boolean(xNpub && row.xProofPostId)
  const hasNip39 = Boolean(nip39Npub && row.nip39XId && row.nip39PostId)

  if (!hasX && !hasNip39) {
    return { state: 'unverified', columnsAligned: false }
  }
  if (hasX && !hasNip39) {
    return {
      state: 'unverified',
      blockedBy: 'missing-nip39',
      columnsAligned: false,
    }
  }
  if (!hasX && hasNip39) {
    if (options.proofUnavailable) {
      return {
        state: 'pending',
        blockedBy: 'proof-unavailable',
        columnsAligned: false,
      }
    }
    return {
      state: 'unverified',
      blockedBy: 'missing-x-proof',
      columnsAligned: false,
    }
  }

  // Both sides present — check column alignment.
  if (xNpub !== nip39Npub) {
    return {
      state: 'unverified',
      blockedBy: 'mismatch',
      columnsAligned: false,
    }
  }
  if (row.nip39XId !== row.twitterId) {
    return {
      state: 'unverified',
      blockedBy: 'mismatch',
      columnsAligned: false,
    }
  }
  if (row.nip39PostId !== row.xProofPostId) {
    return {
      state: 'unverified',
      blockedBy: 'mismatch',
      columnsAligned: false,
    }
  }
  if (
    row.nip39Handle &&
    row.xProofHandle &&
    !handlesEqual(row.nip39Handle, row.xProofHandle)
  ) {
    return {
      state: 'unverified',
      blockedBy: 'mismatch',
      columnsAligned: false,
    }
  }

  return { state: 'verified', columnsAligned: true }
}

/** Decode an npub to lowercase hex pubkey, or undefined if invalid. */
export function pubkeyFromNpub(npub: string | undefined): string | undefined {
  const normalized = normalizeNpub(npub)
  if (!normalized) return undefined
  try {
    const decoded = nip19.decode(normalized)
    if (decoded.type !== 'npub') return undefined
    return decoded.data.toLowerCase()
  } catch {
    return undefined
  }
}

/** Encode a hex pubkey to lowercase npub, or undefined if invalid. */
export function npubFromPubkey(pubkey: string | undefined): string | undefined {
  if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) return undefined
  try {
    return nip19.npubEncode(pubkey.toLowerCase()).toLowerCase()
  } catch {
    return undefined
  }
}

/** Primary npub for display / sorting: prefer verified binding, else either side. */
export function primaryNpubFromRow(
  row: Pick<XIdentityRecord, 'state' | 'xProofNpub' | 'nip39Npub'>,
): string | undefined {
  if (row.state === 'verified') {
    return normalizeNpub(row.xProofNpub) ?? normalizeNpub(row.nip39Npub)
  }
  return normalizeNpub(row.xProofNpub) ?? normalizeNpub(row.nip39Npub)
}

export function preserveXIdentityProfileFields(
  existing: XIdentityRecord | undefined,
): Pick<XIdentityRecord, 'displayName' | 'iconPath'> {
  return {
    ...(existing?.displayName ? { displayName: existing.displayName } : {}),
    ...(existing?.iconPath ? { iconPath: existing.iconPath } : {}),
  }
}

/** Preserve existing proof and profile columns when only updating handles. */
export function preserveXIdentityProofFields(
  existing: XIdentityRecord | undefined,
): Pick<
  XIdentityRecord,
  | 'displayName'
  | 'iconPath'
  | 'xProofNpub'
  | 'xProofPostId'
  | 'xProofHandle'
  | 'xProofObservedAt'
  | 'nip39Npub'
  | 'nip39XId'
  | 'nip39Handle'
  | 'nip39PostId'
  | 'nip39EventId'
  | 'nip39ObservedAt'
  | 'state'
  | 'blockedBy'
  | 'verifiedAt'
> {
  if (!existing) {
    return { state: 'unverified' }
  }
  return {
    ...(existing.displayName ? { displayName: existing.displayName } : {}),
    ...(existing.iconPath ? { iconPath: existing.iconPath } : {}),
    ...(existing.xProofNpub ? { xProofNpub: existing.xProofNpub } : {}),
    ...(existing.xProofPostId ? { xProofPostId: existing.xProofPostId } : {}),
    ...(existing.xProofHandle ? { xProofHandle: existing.xProofHandle } : {}),
    ...(existing.xProofObservedAt !== undefined
      ? { xProofObservedAt: existing.xProofObservedAt }
      : {}),
    ...(existing.nip39Npub ? { nip39Npub: existing.nip39Npub } : {}),
    ...(existing.nip39XId ? { nip39XId: existing.nip39XId } : {}),
    ...(existing.nip39Handle ? { nip39Handle: existing.nip39Handle } : {}),
    ...(existing.nip39PostId ? { nip39PostId: existing.nip39PostId } : {}),
    ...(existing.nip39EventId ? { nip39EventId: existing.nip39EventId } : {}),
    ...(existing.nip39ObservedAt !== undefined
      ? { nip39ObservedAt: existing.nip39ObservedAt }
      : {}),
    state: existing.state,
    ...(existing.blockedBy ? { blockedBy: existing.blockedBy } : {}),
    ...(existing.verifiedAt !== undefined
      ? { verifiedAt: existing.verifiedAt }
      : {}),
  }
}

export function mergeXIdentityProfileFromObservation(
  existing: XIdentityRecord | undefined,
  observation: Pick<ObservedXIdentity, 'displayName' | 'iconPath' | 'observedAt'>,
): {
  displayName?: string
  iconPath?: string
  profileChanged: boolean
} {
  const displayName = observation.displayName ?? existing?.displayName
  const iconPath = observation.iconPath ?? existing?.iconPath
  // Case-sensitive: pbs.twimg.com icon paths differ by filename case.
  const profileChanged =
    (observation.displayName !== undefined &&
      observation.displayName !== existing?.displayName) ||
    (observation.iconPath !== undefined &&
      observation.iconPath !== existing?.iconPath)

  return {
    ...(displayName ? { displayName } : {}),
    ...(iconPath ? { iconPath } : {}),
    profileChanged,
  }
}

