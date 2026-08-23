import type { TrustQueryResult, TrustResolution } from '../../../graph'
import type { TrustScoreSummary } from '../../../shared/trust-score-format'
import {
  canonicalTwitterProfileUrl,
  parseCanonicalTwitterSubject,
} from '../../../shared/x-identity'
import type { XPostRole } from '../../../shared/x-post-chrome'
import {
  buildXProfileBannerUrl,
  buildXProfileIconUrl,
  isXProfileBannerPath,
  isXProfileIconPath,
} from '../../../shared/x-profile-display'

export type SubjectHeaderKind = 'account' | 'post' | 'unknown'

export type NameTrustTone = 'trust' | 'question' | 'misleading'

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

/** Profile photo URL the way X serves it on a profile page (`_400x400`). */
export function subjectAvatarUrl(
  iconPath: string | undefined,
): string | undefined {
  const path = iconPath?.trim()
  return path && isXProfileIconPath(path)
    ? buildXProfileIconUrl(path, '400x400')
    : undefined
}

export function nameTrustTone(
  resolution: TrustResolution | undefined,
): NameTrustTone | undefined {
  switch (resolution) {
    case 'trusted':
      return 'trust'
    case 'mixed':
      return 'question'
    case 'distrusted':
      return 'misleading'
    case 'none':
    case undefined:
      return undefined
    default: {
      const _exhaustive: never = resolution
      return _exhaustive
    }
  }
}

export function trustScoreSummaryFromQuery(
  trust: Pick<
    TrustQueryResult,
    'resolution' | 'direct' | 'degree' | 'connected' | 'trust' | 'distrust'
  >,
): TrustScoreSummary {
  const direct = trust.direct?.value
  return {
    resolution: trust.resolution,
    ...(direct === 1 || direct === 0 || direct === -1 ? { direct } : {}),
    ...(trust.connected ? { degree: trust.degree } : {}),
    trustCount: trust.trust,
    distrustCount: trust.distrust,
  }
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

export function unidentifiedAccountHeader(
  twitterId: string,
  copy: { unknownUser: string; notIdentifiedYet: string },
): {
  title: string
  subtitle: string
  hint: string
  profileHref: string
} {
  return {
    title: copy.unknownUser,
    subtitle: twitterId,
    hint: copy.notIdentifiedYet,
    profileHref: canonicalTwitterProfileUrl({ twitterId }),
  }
}

export function unboundPubkeyHeader(
  npubOrHex: string,
  copy: { externalTrusted: string; notIdentifiedYet: string },
): {
  title: string
  subtitle: string
  hint: string
  profileHref: undefined
} {
  return {
    title: copy.externalTrusted,
    subtitle: npubOrHex,
    hint: copy.notIdentifiedYet,
    profileHref: undefined,
  }
}

export function formatPostAuthorName(input: {
  displayName?: string
  handle?: string
}): string | undefined {
  const name = input.displayName?.trim()
  if (name) return name
  return formatAtHandle(input.handle)
}

export function formatPostSubjectHeader(input: {
  postId: string
  headline?: string
  authorHandle?: string
  displayName?: string
  roleLabel?: string
  postNoun: string
  handleAndRole: string
}): SubjectHeaderLines & { authorName: string } {
  const headline = input.headline?.trim()
  const handle = formatAtHandle(input.authorHandle)
  const roleLabel = input.roleLabel?.trim()
  const authorName = formatPostAuthorName({
    displayName: input.displayName,
    handle: input.authorHandle,
  })
  const named = Boolean(input.displayName?.trim())
  let subtitle = ''
  if (named && handle && roleLabel) {
    subtitle = input.handleAndRole
      .replaceAll('{handle}', handle)
      .replaceAll('{role}', roleLabel)
  } else if (named && handle) {
    subtitle = handle
  } else if (roleLabel) {
    subtitle = roleLabel
  } else if (!headline && !authorName) {
    subtitle = input.postId
  }
  return {
    title: headline || input.postNoun,
    authorName: authorName ?? '',
    subtitle,
  }
}
