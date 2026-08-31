import type { XIdentityDisplay } from '../shared/contracts'
import { pickXVerifiedChrome } from '../shared/x-verified'
import type { XIdentityRecord } from '../storage/types'

/** Live signed-in X chrome (session / ActiveXAccountReport). */
export interface XIdentityLiveChrome {
  twitterId?: string
  displayName?: string
  handle?: string
  iconPath?: string
}

export function xIdentityDisplayHasChrome(
  display: XIdentityDisplay | undefined,
): display is XIdentityDisplay {
  return Boolean(display?.iconPath || display?.displayName || display?.handle)
}

function compactXIdentityDisplay(
  display: XIdentityDisplay,
): XIdentityDisplay {
  return {
    ...(display.twitterId ? { twitterId: display.twitterId } : {}),
    ...(display.displayName ? { displayName: display.displayName } : {}),
    ...(display.handle ? { handle: display.handle } : {}),
    ...(display.iconPath ? { iconPath: display.iconPath } : {}),
    ...pickXVerifiedChrome(display),
  }
}

export function xIdentityDisplayFromRow(
  row: Pick<
    XIdentityRecord,
    | 'twitterId'
    | 'displayName'
    | 'handle'
    | 'postHandle'
    | 'iconPath'
    | 'verifiedType'
    | 'affiliationBadgePath'
    | 'affiliationLabel'
  >,
): XIdentityDisplay {
  const handle = row.postHandle ?? (row.handle || undefined)
  return compactXIdentityDisplay({
    twitterId: row.twitterId,
    ...(row.displayName ? { displayName: row.displayName } : {}),
    ...(handle ? { handle } : {}),
    ...(row.iconPath ? { iconPath: row.iconPath } : {}),
    ...pickXVerifiedChrome(row),
  })
}

export function xIdentityDisplayFromLiveChrome(
  live: XIdentityLiveChrome | undefined,
): XIdentityDisplay | undefined {
  if (!live) return undefined
  const twitterId = live.twitterId?.trim()
  if (!twitterId) return undefined
  const display = compactXIdentityDisplay({
    twitterId,
    ...(live.displayName ? { displayName: live.displayName } : {}),
    ...(live.handle ? { handle: live.handle } : {}),
    ...(live.iconPath ? { iconPath: live.iconPath } : {}),
  })
  return display.twitterId ? display : undefined
}

/**
 * Primary wins when set; fallback fills gaps. Used so signed-in session
 * chrome can complete (or override empty) xIdentities display fields.
 */
export function fillXIdentityDisplayGaps(
  primary: XIdentityDisplay | undefined,
  fallback: XIdentityDisplay | undefined,
): XIdentityDisplay | undefined {
  if (!primary && !fallback) return undefined
  return compactXIdentityDisplay({
    twitterId: primary?.twitterId || fallback?.twitterId,
    displayName: primary?.displayName || fallback?.displayName,
    handle: primary?.handle || fallback?.handle,
    iconPath: primary?.iconPath || fallback?.iconPath,
    verifiedType: primary?.verifiedType || fallback?.verifiedType,
    affiliationBadgePath:
      primary?.affiliationBadgePath || fallback?.affiliationBadgePath,
    affiliationLabel: primary?.affiliationLabel || fallback?.affiliationLabel,
  })
}

/** Overlay live signed-in chrome onto a durable row without persisting. */
export function overlayLiveXChromeOnIdentity(
  identity: XIdentityRecord,
  live: XIdentityLiveChrome | undefined,
): XIdentityRecord {
  if (!live?.twitterId || live.twitterId !== identity.twitterId) {
    return identity
  }
  const handle = identity.handle || live.handle || identity.handle
  return {
    ...identity,
    handle,
    ...(identity.displayName || live.displayName
      ? { displayName: identity.displayName || live.displayName }
      : {}),
    ...(identity.iconPath || live.iconPath
      ? { iconPath: identity.iconPath || live.iconPath }
      : {}),
  }
}
