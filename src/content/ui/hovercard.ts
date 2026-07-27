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

/**
 * Appends a compact trust card to X's own user hover card.
 *
 * X closes the hover card when the pointer leaves it. Entering our trust strip
 * must not count as leaving — we keep a pointer lock and ping mouseover on the
 * host card so X's own hover state stays alive.
 */
export class HoverCardAugmentor {
  #observer?: MutationObserver
  #enabled = false
  #card?: TrustCard
  #mount?: HTMLElement
  #hoverCard?: HTMLElement
  #pointerInside = false
  #scanRaf = 0

  start(): void {
    if (this.#enabled) return
    this.#enabled = true
    this.#observer = new MutationObserver(() => this.#scheduleScan())
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
    if (this.#scanRaf) cancelAnimationFrame(this.#scanRaf)
    this.#scanRaf = 0
    this.#teardown(true)
  }

  #scheduleScan(): void {
    if (this.#scanRaf) return
    this.#scanRaf = requestAnimationFrame(() => {
      this.#scanRaf = 0
      this.#scan()
    })
  }

  #teardown(force = false): void {
    if (!force && this.#pointerInside) return
    this.#card?.destroy()
    this.#card = undefined
    this.#mount?.remove()
    this.#mount = undefined
    this.#hoverCard = undefined
    this.#pointerInside = false
    for (const stale of document.querySelectorAll(`[${HOST_ATTR}]`)) {
      stale.remove()
    }
  }

  #keepAlive = (): void => {
    this.#pointerInside = true
    // Nudge X's hover machinery so the card is not treated as abandoned.
    this.#hoverCard?.dispatchEvent(
      new MouseEvent('mouseover', { bubbles: true, cancelable: true }),
    )
  }

  #onPointerLeave = (event: PointerEvent): void => {
    const next = event.relatedTarget as Node | null
    if (next && this.#hoverCard?.contains(next)) return
    if (next && this.#mount?.contains(next)) return
    this.#pointerInside = false
  }

  #scan(): void {
    if (!this.#enabled) return

    if (this.#mount && !this.#mount.isConnected) {
      if (!this.#pointerInside) this.#teardown(true)
    }

    const cards = document.querySelectorAll<HTMLElement>(
      '[data-testid="HoverCard"]',
    )
    for (const candidate of cards) {
      if (!candidate.isConnected) continue
      if (candidate.querySelector(`[${HOST_ATTR}]`)) {
        this.#hoverCard = candidate
        return
      }
      const handle = resolveHandle(candidate)
      if (!handle) continue

      this.#teardown(true)
      const mount = document.createElement('div')
      mount.setAttribute(HOST_ATTR, 'true')
      mount.style.cssText =
        'margin: 4px 12px 12px; pointer-events: auto; position: relative; z-index: 1;'
      mount.addEventListener('pointerenter', this.#keepAlive)
      mount.addEventListener('pointermove', this.#keepAlive)
      mount.addEventListener('pointerleave', this.#onPointerLeave)
      // Keep the strip inside the card's hit area while the pointer travels
      // from the profile header down onto the trust controls.
      mount.addEventListener('mouseover', (event) => {
        event.stopPropagation()
        this.#keepAlive()
      })

      this.#card = new TrustCard({
        target: profileTargetForHandle(handle),
        variant: 'author',
        compact: true,
      })
      mount.append(this.#card.host)
      candidate.append(mount)
      this.#mount = mount
      this.#hoverCard = candidate
      return
    }

    if (!this.#pointerInside) this.#teardown()
  }
}
