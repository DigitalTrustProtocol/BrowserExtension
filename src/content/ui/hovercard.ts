import { handleFromProfileHref, profileTargetForHandle } from './profile-target'
import { TrustCard } from './trust-card'

const HOST_ATTR = 'data-attentionx-hovercard'

/** Reserved / non-profile first path segments seen in X hover-card links. */
const NON_PROFILE_SEGMENTS = new Set([
  'i',
  'home',
  'explore',
  'search',
  'notifications',
  'messages',
  'settings',
  'compose',
])

function resolveHandle(card: HTMLElement): string | undefined {
  for (const link of card.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
    const handle = handleFromProfileHref(link.getAttribute('href'))
    if (handle && !NON_PROFILE_SEGMENTS.has(handle)) return handle
  }
  return undefined
}

function looksLikeProfileCard(candidate: HTMLElement): boolean {
  if (candidate.matches('[data-testid="HoverCard"]')) return true
  if (candidate.querySelector('[data-testid="HoverCard"]')) return true
  return Boolean(
    candidate.querySelector('[data-testid="UserName"]') ??
      candidate.querySelector('[data-testid="User-Name"]'),
  )
}

/**
 * Appends a compact trust card to X's own user hover card, so trust info shows
 * up where the operator already hovers.
 */
export class HoverCardAugmentor {
  #observer?: MutationObserver
  #enabled = false
  #card?: TrustCard
  #mount?: HTMLElement

  start(): void {
    if (this.#enabled) return
    this.#enabled = true
    this.#observer = new MutationObserver(() => this.#scan())
    this.#observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    })
    this.#scan()
  }

  stop(): void {
    this.#enabled = false
    this.#observer?.disconnect()
    this.#observer = undefined
    this.#teardown()
  }

  #teardown(): void {
    this.#card?.destroy()
    this.#card = undefined
    this.#mount?.remove()
    this.#mount = undefined
    for (const stale of document.querySelectorAll(`[${HOST_ATTR}]`)) {
      stale.remove()
    }
  }

  #scan(): void {
    if (!this.#enabled) return

    if (this.#mount && !this.#mount.isConnected) this.#teardown()

    for (const candidate of document.querySelectorAll<HTMLElement>(
      '[data-testid="HoverCard"], div[role="dialog"]',
    )) {
      if (!candidate.isConnected) continue
      if (candidate.querySelector(`[${HOST_ATTR}]`)) return
      if (!looksLikeProfileCard(candidate)) continue
      const handle = resolveHandle(candidate)
      if (!handle) continue

      this.#teardown()
      const mount = document.createElement('div')
      mount.setAttribute(HOST_ATTR, 'true')
      mount.style.cssText = 'margin: 4px 12px 12px;'
      this.#card = new TrustCard({
        target: profileTargetForHandle(handle),
        variant: 'author',
        compact: true,
      })
      mount.append(this.#card.host)
      candidate.append(mount)
      this.#mount = mount
      return
    }
  }
}
