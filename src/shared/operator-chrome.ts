import {
  buildXProfileIconUrl,
  isXProfileIconPath,
} from './x-profile-display.ts'

export interface OperatorXDisplay {
  displayName?: string
  handle?: string
  iconPath?: string
}

export interface OperatorChromeInput {
  /** Signed-in X tab twitterId, when known. */
  signedInTwitterId?: string | null
  xDisplay?: OperatorXDisplay | null
  /** All X ids bound to the active Nostr account. */
  boundTwitterIds: readonly string[]
  /** Chrome for the sole bound X when off-X. */
  soleBoundDisplay?: OperatorXDisplay | null
  kind0Name?: string
  kind0Picture?: string
  accountName?: string
  npubFallback: string
  emptyFallback: string
}

export interface OperatorChrome {
  displayName: string
  displaySub: string
  avatarUrl: string | null
}

function formatHandle(handle: string | undefined): string | undefined {
  const trimmed = handle?.trim().replace(/^@+/u, '')
  return trimmed ? `@${trimmed}` : undefined
}

function chromeFromX(display: OperatorXDisplay | null | undefined): {
  displayName?: string
  displaySub?: string
  avatarUrl: string | null
} {
  const handle = formatHandle(display?.handle)
  const name = display?.displayName?.trim() || handle
  const path = display?.iconPath?.trim()
  const avatarUrl =
    path && isXProfileIconPath(path) ? buildXProfileIconUrl(path) : null
  return {
    ...(name ? { displayName: name } : {}),
    ...(handle ? { displaySub: handle } : {}),
    avatarUrl,
  }
}

/**
 * Operator identity chrome: signed-in X first, then a sole bound X off-tab,
 * then kind 0 / vault name only when no X session and no unique binding.
 */
export function resolveOperatorChrome(
  input: OperatorChromeInput,
): OperatorChrome {
  const signedIn = Boolean(input.signedInTwitterId)
  if (signedIn) {
    const fromX = chromeFromX(input.xDisplay)
    return {
      displayName:
        fromX.displayName ||
        input.accountName ||
        input.npubFallback ||
        input.emptyFallback,
      displaySub: fromX.displaySub || input.npubFallback,
      avatarUrl: fromX.avatarUrl,
    }
  }

  if (input.boundTwitterIds.length > 1) {
    return {
      displayName: input.accountName || input.npubFallback || input.emptyFallback,
      displaySub: input.npubFallback,
      avatarUrl: null,
    }
  }

  if (input.boundTwitterIds.length === 1) {
    const fromX = chromeFromX(input.soleBoundDisplay)
    return {
      displayName:
        fromX.displayName ||
        input.accountName ||
        input.npubFallback ||
        input.emptyFallback,
      displaySub: fromX.displaySub || input.npubFallback,
      avatarUrl: fromX.avatarUrl,
    }
  }

  const kind0 = input.kind0Name?.trim()
  return {
    displayName:
      kind0 || input.accountName || input.npubFallback || input.emptyFallback,
    displaySub: input.npubFallback,
    avatarUrl: input.kind0Picture?.trim() || null,
  }
}

/**
 * Chrome for any vault account: signed-in X only when this account is bound
 * to it; otherwise sole bound X / generic / kind 0.
 */
export function resolveAccountChrome(input: {
  signedInTwitterId?: string | null
  boundTwitterIds: readonly string[]
  xDisplays: Readonly<Record<string, OperatorXDisplay>>
  kind0Name?: string
  kind0Picture?: string
  accountName?: string
  npubFallback: string
  emptyFallback: string
}): OperatorChrome {
  const signedIn = input.signedInTwitterId?.trim() || null
  const boundToSignedIn =
    Boolean(signedIn) &&
    signedIn !== null &&
    input.boundTwitterIds.includes(signedIn)
  if (boundToSignedIn && signedIn) {
    return resolveOperatorChrome({
      signedInTwitterId: signedIn,
      xDisplay: input.xDisplays[signedIn],
      boundTwitterIds: input.boundTwitterIds,
      kind0Name: input.kind0Name,
      kind0Picture: input.kind0Picture,
      accountName: input.accountName,
      npubFallback: input.npubFallback,
      emptyFallback: input.emptyFallback,
    })
  }
  const soleId =
    input.boundTwitterIds.length === 1 ? input.boundTwitterIds[0] : undefined
  return resolveOperatorChrome({
    signedInTwitterId: null,
    boundTwitterIds: input.boundTwitterIds,
    soleBoundDisplay: soleId ? input.xDisplays[soleId] : undefined,
    kind0Name: input.kind0Name,
    kind0Picture: input.kind0Picture,
    accountName: input.accountName,
    npubFallback: input.npubFallback,
    emptyFallback: input.emptyFallback,
  })
}
