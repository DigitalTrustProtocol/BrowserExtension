import {
  isXProfileIconPath,
  normalizeXProfileIconPath,
} from './x-profile-display'

/** X platform verification badge. Not NIP-39 `state` / `verifiedAt`. */
export type XVerifiedType = 'blue' | 'business' | 'government'

export const X_VERIFIED_TYPES: readonly XVerifiedType[] = [
  'blue',
  'business',
  'government',
] as const

/** Observation sentinel: GraphQL User had verification keys and is not badged. */
export type ObservedXVerifiedType = XVerifiedType | 'none'

export const MAX_X_AFFILIATION_LABEL_LENGTH = 40

export const X_VERIFIED_COLORS: Record<XVerifiedType, string> = {
  blue: '#1D9BF0',
  business: '#E2AC00',
  government: '#829AAB',
}

export interface XVerifiedChrome {
  verifiedType?: XVerifiedType
  affiliationBadgePath?: string
  affiliationLabel?: string
}

export interface ObservedXVerifiedChrome {
  verifiedType?: ObservedXVerifiedType
  affiliationObserved?: boolean
  affiliationBadgePath?: string
  affiliationLabel?: string
}

export function isXVerifiedType(value: unknown): value is XVerifiedType {
  return value === 'blue' || value === 'business' || value === 'government'
}

export function isObservedXVerifiedType(
  value: unknown,
): value is ObservedXVerifiedType {
  return value === 'none' || isXVerifiedType(value)
}

export function normalizeXAffiliationLabel(
  value: string,
): string | undefined {
  const trimmed = value.trim().slice(0, MAX_X_AFFILIATION_LABEL_LENGTH)
  return trimmed.length > 0 ? trimmed : undefined
}

export function pickXVerifiedChrome(
  row: Partial<XVerifiedChrome> | undefined,
): XVerifiedChrome {
  if (!row) return {}
  return {
    ...(row.verifiedType ? { verifiedType: row.verifiedType } : {}),
    ...(row.affiliationBadgePath
      ? { affiliationBadgePath: row.affiliationBadgePath }
      : {}),
    ...(row.affiliationLabel ? { affiliationLabel: row.affiliationLabel } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readVerifiedTypeRaw(
  value: Record<string, unknown>,
): string | undefined {
  const legacy = isRecord(value.legacy) ? value.legacy : undefined
  const verification = isRecord(value.verification)
    ? value.verification
    : undefined
  const candidates = [legacy?.verified_type, verification?.verified_type]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return undefined
}

function userHasVerifiedKeys(value: Record<string, unknown>): boolean {
  const legacy = isRecord(value.legacy) ? value.legacy : undefined
  const verification = isRecord(value.verification)
    ? value.verification
    : undefined
  return (
    'is_blue_verified' in value ||
    (legacy !== undefined &&
      ('verified' in legacy || 'verified_type' in legacy)) ||
    (verification !== undefined &&
      ('verified' in verification || 'verified_type' in verification))
  )
}

/**
 * Read X verification / highlighted affiliation from a GraphQL User object.
 * Missing keys → omit (do not clear). Present empty affiliation →
 * `affiliationObserved: true` with no path.
 */
export function readXVerifiedChrome(
  value: Record<string, unknown>,
): ObservedXVerifiedChrome {
  let verifiedType: ObservedXVerifiedType | undefined
  if (userHasVerifiedKeys(value)) {
    const raw = readVerifiedTypeRaw(value)
    const lower = raw?.toLowerCase()
    const legacy = isRecord(value.legacy) ? value.legacy : undefined
    if (lower === 'government') verifiedType = 'government'
    else if (lower === 'business') verifiedType = 'business'
    else if (value.is_blue_verified === true || legacy?.verified === true) {
      verifiedType = 'blue'
    } else {
      verifiedType = 'none'
    }
  }

  const result: ObservedXVerifiedChrome = {
    ...(verifiedType ? { verifiedType } : {}),
  }

  if (!('affiliates_highlighted_label' in value)) return result

  result.affiliationObserved = true
  const highlighted = value.affiliates_highlighted_label
  if (!isRecord(highlighted)) return result

  const label = isRecord(highlighted.label) ? highlighted.label : highlighted
  const badge = isRecord(label.badge) ? label.badge : undefined
  const badgeUrl = typeof badge?.url === 'string' ? badge.url : undefined
  if (badgeUrl) {
    const path = isXProfileIconPath(badgeUrl)
      ? badgeUrl
      : normalizeXProfileIconPath(badgeUrl)
    if (path) result.affiliationBadgePath = path
  }
  if (typeof label.description === 'string') {
    const description = normalizeXAffiliationLabel(label.description)
    if (description) result.affiliationLabel = description
  }
  return result
}

function preferVerifiedType(
  next: ObservedXVerifiedType | undefined,
  previous: ObservedXVerifiedType | undefined,
): ObservedXVerifiedType | undefined {
  if (next && next !== 'none') return next
  if (previous && previous !== 'none') return previous
  if (next === 'none' || previous === 'none') return 'none'
  return undefined
}

/** Merge badge chrome from two walks of the same User. Prefer a real type / badge. */
export function mergeObservedXVerifiedChrome(
  next: ObservedXVerifiedChrome,
  previous: ObservedXVerifiedChrome | undefined,
): ObservedXVerifiedChrome {
  const verifiedType = preferVerifiedType(
    next.verifiedType,
    previous?.verifiedType,
  )
  const affiliationBadgePath =
    next.affiliationBadgePath ?? previous?.affiliationBadgePath
  const affiliationLabel = next.affiliationLabel ?? previous?.affiliationLabel
  const affiliationObserved =
    next.affiliationObserved === true ||
    previous?.affiliationObserved === true ||
    Boolean(affiliationBadgePath)

  return {
    ...(verifiedType ? { verifiedType } : {}),
    ...(affiliationObserved ? { affiliationObserved: true } : {}),
    ...(affiliationBadgePath
      ? { affiliationBadgePath }
      : {}),
    ...(affiliationLabel ? { affiliationLabel } : {}),
  }
}

export function spreadObservedXVerifiedChrome(
  chrome: ObservedXVerifiedChrome,
): ObservedXVerifiedChrome {
  return {
    ...(chrome.verifiedType ? { verifiedType: chrome.verifiedType } : {}),
    ...(chrome.affiliationObserved ? { affiliationObserved: true } : {}),
    ...(chrome.affiliationBadgePath
      ? { affiliationBadgePath: chrome.affiliationBadgePath }
      : {}),
    ...(chrome.affiliationLabel
      ? { affiliationLabel: chrome.affiliationLabel }
      : {}),
  }
}
