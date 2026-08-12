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
