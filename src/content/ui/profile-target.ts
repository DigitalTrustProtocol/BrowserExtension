import { isXNumericId, normalizeObservedHandle } from '../../shared/observed-x-identity'
import {
  canonicalTwitterProfileId,
  canonicalTwitterProfileUrl,
} from '../../shared/x-identity'
import { identitiesByHandle } from '../scanner'
import type { Target } from '../types'

const FOLLOW_TESTID = /^(\d{1,24})-(?:un)?(?:follow|subscribe)$/i

/**
 * X UserCell / HoverCard action buttons that encode `<twitterId>-(un)follow`
 * or `<twitterId>-(un)subscribe` (creator Connect People uses Subscribe).
 */
export const USER_ACTION_TESTID_SELECTOR = [
  '[data-testid$="-follow"]',
  '[data-testid$="-unfollow"]',
  '[data-testid$="-subscribe"]',
  '[data-testid$="-unsubscribe"]',
].join(', ')

/** Numeric id from X Follow or Subscribe `data-testid` (`<id>-follow`). */
export function twitterIdFromFollowTestId(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined
  const match = FOLLOW_TESTID.exec(value.trim())
  const id = match?.[1]
  return id && isXNumericId(id) ? id : undefined
}

/** Follow/Subscribe button id under a UserCell, HoverCard, or similar root. */
export function twitterIdFromFollowButton(
  root: ParentNode,
): string | undefined {
  const button = root.querySelector<HTMLElement>(USER_ACTION_TESTID_SELECTOR)
  return twitterIdFromFollowTestId(button?.getAttribute('data-testid'))
}

/** Builds a profile target, filling the numeric ID from page-world observations. */
export function profileTargetForHandle(
  handle: string,
  twitterId?: string,
): Target {
  const resolved =
    twitterId ??
    identitiesByHandle.get(normalizeObservedHandle(handle) ?? handle)
      ?.twitterId
  return {
    type: 'profile',
    id: canonicalTwitterProfileId({ handle, twitterId: resolved }),
    handle,
    twitterId: resolved,
    url: canonicalTwitterProfileUrl({ handle, twitterId: resolved }),
  }
}

export function handleFromProfileHref(
  href: string | null | undefined,
): string | undefined {
  if (!href) return undefined
  const segment = href.split('?')[0]?.split('/').filter(Boolean)[0]
  if (!segment) return undefined
  return normalizeObservedHandle(segment)
}
