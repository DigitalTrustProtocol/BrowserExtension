import { isXProductHost } from './x-host-autoconnect'

/** Parse `post:id` digits from an X status URL path (`…/status/<digits>`). */
export function parseXStatusPostId(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!isXProductHost(parsed.hostname)) return null
    const match = parsed.pathname.match(/\/status\/(\d+)/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

const RESERVED_PROFILE_SEGMENTS = new Set([
  'home',
  'explore',
  'notifications',
  'messages',
  'i',
  'settings',
  'search',
  'compose',
  'login',
  'signup',
  'intent',
  'hashtag',
  'tos',
  'privacy',
])

/** Parse a profile handle from an X profile URL (`x.com/<handle>`). */
export function parseXProfileHandle(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!isXProductHost(parsed.hostname)) return null
    const segment = parsed.pathname.split('/').filter(Boolean)[0]
    if (!segment || RESERVED_PROFILE_SEGMENTS.has(segment.toLowerCase())) {
      return null
    }
    if (!/^[A-Za-z0-9_]{1,15}$/.test(segment)) return null
    return segment
  } catch {
    return null
  }
}
