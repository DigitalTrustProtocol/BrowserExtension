import { normalizeObservedHandle } from '../../shared/observed-x-identity'
import {
  canonicalTwitterProfileId,
  canonicalTwitterProfileUrl,
} from '../../shared/x-identity'
import { identitiesByHandle } from '../scanner'
import type { Target } from '../types'

/** Builds a profile target, filling the numeric ID from page-world observations. */
export function profileTargetForHandle(handle: string): Target {
  const twitterId = identitiesByHandle.get(handle)?.twitterId
  return {
    type: 'profile',
    id: canonicalTwitterProfileId({ handle, twitterId }),
    handle,
    twitterId,
    url: canonicalTwitterProfileUrl({ handle, twitterId }),
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
