import { parseCanonicalTwitterSubject } from '../../../shared/x-identity'
import type { XPostRole } from '../../../shared/x-post-chrome'
import {
  buildXProfileBannerUrl,
  isXProfileBannerPath,
} from '../../../shared/x-profile-display'

export type SubjectHeaderKind = 'account' | 'post' | 'unknown'

export interface SubjectHeaderLines {
  title: string
  subtitle: string
}

export function subjectHeaderKind(subjectValue: string): SubjectHeaderKind {
  const parsed = parseCanonicalTwitterSubject(subjectValue)
  if (!parsed) return 'unknown'
  switch (parsed.type) {
    case 'account':
      return 'account'
    case 'post':
      return 'post'
    default: {
      const _exhaustive: never = parsed
      return _exhaustive
    }
  }
}

export function formatAtHandle(handle: string | undefined): string | undefined {
  const trimmed = handle?.trim().replace(/^@+/u, '')
  return trimmed ? `@${trimmed}` : undefined
}

export function avatarFallbackLetter(title: string): string {
  const trimmed = title.replace(/^@+/u, '').trim()
  for (const ch of trimmed) {
    if (ch.toLowerCase() !== ch.toUpperCase() || /\d/u.test(ch)) {
      return ch.toUpperCase()
    }
  }
  return ''
}

/** Cover hero from stored xIdentities bannerPath — never the square avatar. */
export function subjectHeroPictureUrl(
  bannerPath: string | undefined,
): string | undefined {
  const path = bannerPath?.trim()
  return path && isXProfileBannerPath(path)
    ? buildXProfileBannerUrl(path)
    : undefined
}

export function postRoleLabel(
  role: XPostRole | undefined,
  labels: { reply: string; quote: string; repost: string },
): string | undefined {
  switch (role) {
    case undefined:
    case 'root':
      return undefined
    case 'reply':
      return labels.reply
    case 'quote':
      return labels.quote
    case 'repost':
      return labels.repost
    default: {
      const _exhaustive: never = role
      return _exhaustive
    }
  }
}

export function formatUserSubjectHeader(input: {
  twitterId: string
  displayName?: string
  handle?: string
  userNoun: string
}): SubjectHeaderLines {
  const name = input.displayName?.trim()
  const handle = formatAtHandle(input.handle)
  if (name) {
    return { title: name, subtitle: handle ?? '' }
  }
  if (handle) {
    return { title: handle, subtitle: '' }
  }
  return { title: input.userNoun, subtitle: input.twitterId }
}

export function formatPostSubjectHeader(input: {
  postId: string
  headline?: string
  authorHandle?: string
  roleLabel?: string
  postNoun: string
  handleAndRole: string
}): SubjectHeaderLines {
  const headline = input.headline?.trim()
  const handle = formatAtHandle(input.authorHandle)
  const roleLabel = input.roleLabel?.trim()
  let subtitle = ''
  if (handle && roleLabel) {
    subtitle = input.handleAndRole
      .replaceAll('{handle}', handle)
      .replaceAll('{role}', roleLabel)
  } else if (handle) {
    subtitle = handle
  } else if (roleLabel) {
    subtitle = roleLabel
  } else if (!headline) {
    subtitle = input.postId
  }
  return {
    title: headline || input.postNoun,
    subtitle,
  }
}
