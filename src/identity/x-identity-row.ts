import { nip19 } from 'nostr-tools'
import { isDemoActorNpub } from '../shared/demo-actor-key.ts'
import { normalizeObservedHandle } from '../shared/observed-x-identity'
import type { ObservedXIdentity } from '../shared/observed-x-identity'
import { preferXProfileIconChrome } from '../shared/x-profile-display'
import {
  isXVerifiedType,
  pickXVerifiedChrome,
  type XVerifiedChrome,
} from '../shared/x-verified'
import { nextSeenDays } from '../storage/seen-days'
import type {
  IdentityProofState,
  XIdentityProofSource,
  XIdentityRecord,
} from '../storage/types'

export interface XIdentityEvaluation {
  state: IdentityProofState
  proofSource?: XIdentityProofSource
  winningNpub?: string
}

function normalizeNpub(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim().toLowerCase()
  return trimmed.startsWith('npub1') ? trimmed : undefined
}

/**
 * Pick the winning npub + proofSource from durable columns.
 *
 * Precedence:
 * 1. Bio is the hop whenever it is present. Kind 10011 does not replace it.
 * 2. Without Bio, a linking post is the hop. Kind 10011 does not replace it.
 * 3. Kind 10011 never opens a hop. It confirms the bio npub
 *    (`isNostrConfirmed`) when that same key's claim names this X id.
 * 4. 32009 only when Bio and Post have no npub.
 */
export function evaluateXIdentityRow(
  row: Pick<
    XIdentityRecord,
    | 'twitterId'
    | 'xNpub'
    | 'xDate'
    | 'postNpub'
    | 'postDate'
    | 'nip39Npub'
    | 'nip39XId'
    | 'nip39Date'
    | 'eventNpub'
  >,
): XIdentityEvaluation {
  const bio = normalizeNpub(row.xNpub)
  const post = normalizeNpub(row.postNpub)
  const event = isDemoActorNpub(row.twitterId, row.eventNpub)
    ? undefined
    : normalizeNpub(row.eventNpub)

  if (bio) {
    return { state: 'verified', proofSource: 'bio', winningNpub: bio }
  }

  if (post) {
    return { state: 'verified', proofSource: 'post', winningNpub: post }
  }

  if (event) {
    return {
      state: 'verified',
      proofSource: 'trust32009',
      winningNpub: event,
    }
  }

  return { state: 'unverified' }
}

/** Bio npub and kind 10011 name the same key for this X id. */
export function isNostrConfirmed(
  row: Pick<XIdentityRecord, 'twitterId' | 'xNpub' | 'nip39Npub' | 'nip39XId'>,
): boolean {
  const bio = normalizeNpub(row.xNpub)
  const nip39 = normalizeNpub(row.nip39Npub)
  return Boolean(
    bio && nip39 && bio === nip39 && row.nip39XId === row.twitterId,
  )
}

/** True when candidateDate is strictly newer than existingDate (or existing missing). */
export function isNewerSourceDate(
  candidateDate: number | undefined,
  existingDate: number | undefined,
): boolean {
  if (typeof candidateDate !== 'number' || !Number.isFinite(candidateDate)) {
    return false
  }
  if (typeof existingDate !== 'number' || !Number.isFinite(existingDate)) {
    return true
  }
  return candidateDate > existingDate
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

/** Hex pubkeys bound to this xIdentities row (winning + source columns). */
export function collectXIdentityPubkeyHexes(
  row: Pick<
    XIdentityRecord,
    | 'twitterId'
    | 'xNpub'
    | 'xDate'
    | 'postNpub'
    | 'postDate'
    | 'nip39Npub'
    | 'nip39XId'
    | 'nip39Date'
    | 'eventNpub'
  >,
): string[] {
  const hexes = new Set<string>()
  for (const npub of [
    evaluateXIdentityRow(row).winningNpub,
    row.xNpub,
    row.postNpub,
    isNostrConfirmed(row) ? row.nip39Npub : undefined,
    isDemoActorNpub(row.twitterId, row.eventNpub) ? undefined : row.eventNpub,
  ]) {
    const hex = pubkeyFromNpub(npub)
    if (hex) hexes.add(hex)
  }
  return [...hexes]
}
export function primaryNpubFromRow(
  row: Pick<
    XIdentityRecord,
    | 'state'
    | 'proofSource'
    | 'xNpub'
    | 'postNpub'
    | 'nip39Npub'
    | 'eventNpub'
    | 'twitterId'
    | 'xDate'
    | 'postDate'
    | 'nip39XId'
    | 'nip39Date'
  >,
): string | undefined {
  return (
    evaluateXIdentityRow(row).winningNpub ??
    normalizeNpub(row.xNpub) ??
    normalizeNpub(row.postNpub) ??
    (isDemoActorNpub(row.twitterId, row.eventNpub)
      ? undefined
      : normalizeNpub(row.eventNpub))
  )
}

export function preserveXIdentityProfileFields(
  existing: XIdentityRecord | undefined,
): Pick<
  XIdentityRecord,
  | 'displayName'
  | 'iconPath'
  | 'bannerPath'
  | 'verifiedType'
  | 'affiliationBadgePath'
  | 'affiliationLabel'
> {
  return {
    ...(existing?.displayName ? { displayName: existing.displayName } : {}),
    ...(existing?.iconPath ? { iconPath: existing.iconPath } : {}),
    ...(existing?.bannerPath ? { bannerPath: existing.bannerPath } : {}),
    ...pickXVerifiedChrome(existing),
  }
}

/** Preserve existing proof, profile, and seen columns when only updating handles. */
export function preserveXIdentityProofFields(
  existing: XIdentityRecord | undefined,
): Pick<
  XIdentityRecord,
  | 'displayName'
  | 'iconPath'
  | 'bannerPath'
  | 'verifiedType'
  | 'affiliationBadgePath'
  | 'affiliationLabel'
  | 'xNpub'
  | 'xDate'
  | 'xObservedAt'
  | 'postNpub'
  | 'postId'
  | 'postHandle'
  | 'postDate'
  | 'postObservedAt'
  | 'nip39Npub'
  | 'nip39XId'
  | 'nip39Handle'
  | 'nip39PostId'
  | 'nip39Date'
  | 'eventNpub'
  | 'eventDate'
  | 'eventId'
  | 'eventIssuer'
  | 'state'
  | 'proofSource'
  | 'verifiedAt'
  | 'seenDays'
> {
  if (!existing) {
    return { state: 'unverified' }
  }
  return {
    ...(existing.displayName ? { displayName: existing.displayName } : {}),
    ...(existing.iconPath ? { iconPath: existing.iconPath } : {}),
    ...(existing.bannerPath ? { bannerPath: existing.bannerPath } : {}),
    ...pickXVerifiedChrome(existing),
    ...(existing.xNpub ? { xNpub: existing.xNpub } : {}),
    ...(existing.xDate !== undefined ? { xDate: existing.xDate } : {}),
    ...(existing.xObservedAt !== undefined
      ? { xObservedAt: existing.xObservedAt }
      : {}),
    ...(existing.postNpub ? { postNpub: existing.postNpub } : {}),
    ...(existing.postId ? { postId: existing.postId } : {}),
    ...(existing.postHandle ? { postHandle: existing.postHandle } : {}),
    ...(existing.postDate !== undefined ? { postDate: existing.postDate } : {}),
    ...(existing.postObservedAt !== undefined
      ? { postObservedAt: existing.postObservedAt }
      : {}),
    ...(existing.nip39Npub ? { nip39Npub: existing.nip39Npub } : {}),
    ...(existing.nip39XId ? { nip39XId: existing.nip39XId } : {}),
    ...(existing.nip39Handle ? { nip39Handle: existing.nip39Handle } : {}),
    ...(existing.nip39PostId ? { nip39PostId: existing.nip39PostId } : {}),
    ...(existing.nip39Date !== undefined
      ? { nip39Date: existing.nip39Date }
      : {}),
    ...(existing.eventNpub ? { eventNpub: existing.eventNpub } : {}),
    ...(existing.eventDate !== undefined
      ? { eventDate: existing.eventDate }
      : {}),
    ...(existing.eventId ? { eventId: existing.eventId } : {}),
    ...(existing.eventIssuer ? { eventIssuer: existing.eventIssuer } : {}),
    state: existing.state,
    ...(existing.proofSource ? { proofSource: existing.proofSource } : {}),
    ...(existing.verifiedAt !== undefined
      ? { verifiedAt: existing.verifiedAt }
      : {}),
    ...(existing.seenDays !== undefined ? { seenDays: existing.seenDays } : {}),
  }
}

export function mergeXIdentityProfileFromObservation(
  existing: XIdentityRecord | undefined,
  observation: Pick<
    ObservedXIdentity,
    | 'displayName'
    | 'iconPath'
    | 'bannerPath'
    | 'verifiedType'
    | 'affiliationObserved'
    | 'affiliationBadgePath'
    | 'affiliationLabel'
    | 'observedAt'
  >,
): {
  displayName?: string
  iconPath?: string
  bannerPath?: string
  verifiedType?: XVerifiedChrome['verifiedType']
  affiliationBadgePath?: string
  affiliationLabel?: string
  profileChanged: boolean
} {
  const displayName = observation.displayName ?? existing?.displayName
  const iconPath = preferXProfileIconChrome(
    observation.iconPath,
    existing?.iconPath,
  )
  const bannerPath = observation.bannerPath ?? existing?.bannerPath

  const badgesObserved = observation.verifiedType !== undefined
  const verifiedType = badgesObserved
    ? isXVerifiedType(observation.verifiedType)
      ? observation.verifiedType
      : undefined
    : existing?.verifiedType

  const affiliationObserved =
    observation.affiliationObserved === true ||
    observation.affiliationBadgePath !== undefined ||
    observation.affiliationLabel !== undefined
  const affiliationBadgePath = affiliationObserved
    ? observation.affiliationBadgePath
    : existing?.affiliationBadgePath
  const affiliationLabel = affiliationObserved
    ? observation.affiliationLabel
    : existing?.affiliationLabel

  const profileChanged =
    (observation.displayName !== undefined &&
      observation.displayName !== existing?.displayName) ||
    (observation.iconPath !== undefined &&
      iconPath !== existing?.iconPath) ||
    (observation.bannerPath !== undefined &&
      observation.bannerPath !== existing?.bannerPath) ||
    (badgesObserved && verifiedType !== existing?.verifiedType) ||
    (affiliationObserved &&
      (affiliationBadgePath !== existing?.affiliationBadgePath ||
        affiliationLabel !== existing?.affiliationLabel))

  return {
    ...(displayName ? { displayName } : {}),
    ...(iconPath ? { iconPath } : {}),
    ...(bannerPath ? { bannerPath } : {}),
    ...pickXVerifiedChrome({
      verifiedType,
      affiliationBadgePath,
      affiliationLabel,
    }),
    profileChanged,
  }
}

/**
 * Build the next xIdentities row from a page observation.
 * Always bumps `lastSeen`; sets `updatedAt` only when data changes.
 */
export function buildXIdentityFromObservation(
  existing: XIdentityRecord | undefined,
  observation: ObservedXIdentity,
): { record: XIdentityRecord; dataChanged: boolean } {
  const handle =
    normalizeObservedHandle(observation.handle) ??
    observation.handle.trim().replace(/^@/, '').toLowerCase()
  const { displayName, iconPath, bannerPath, profileChanged, ...badges } =
    mergeXIdentityProfileFromObservation(existing, observation)
  const handleChanged =
    !existing || normalizeObservedHandle(existing.handle) !== handle
  const dataChanged = !existing || handleChanged || profileChanged
  const now = observation.observedAt
  const proof = preserveXIdentityProofFields(existing)
  const record: XIdentityRecord = {
    twitterId: observation.twitterId,
    handle,
    ...proof,
    ...(displayName ? { displayName } : {}),
    ...(iconPath ? { iconPath } : {}),
    ...(bannerPath ? { bannerPath } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: dataChanged ? now : (existing?.updatedAt ?? now),
    lastSeen: now,
    seenDays: nextSeenDays(existing?.lastSeen, existing?.seenDays, now),
  }
  delete record.verifiedType
  delete record.affiliationBadgePath
  delete record.affiliationLabel
  Object.assign(record, pickXVerifiedChrome(badges))

  return {
    dataChanged,
    record,
  }
}
