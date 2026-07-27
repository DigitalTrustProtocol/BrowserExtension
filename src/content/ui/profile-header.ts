import { normalizeObservedHandle } from '../../shared/observed-x-identity'
import { profileTargetForHandle } from './profile-target'
import { TrustCard } from './trust-card'

const HOST_ATTR = 'data-attentionx-profile-header'

function currentProfileHandle(): string | undefined {
  const match = location.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/)
  if (!match?.[1]) return undefined
  return normalizeObservedHandle(match[1])
}

function findHeaderSlot(): HTMLElement | undefined {
  return (
    document.querySelector<HTMLElement>('[data-testid="userActions"]')
      ?.parentElement ??
    document
      .querySelector<HTMLElement>('[data-testid$="-follow"]')
      ?.closest<HTMLElement>('div') ??
    document.querySelector<HTMLElement>('[data-testid="UserName"]') ??
    undefined
  )
}

/** Mounts the full trust card beside the Follow button on a profile page. */
export class ProfileHeaderAugmentor {
  #card?: TrustCard
  #mount?: HTMLElement
  #handle?: string
  #enabled = false

  start(): void {
    this.#enabled = true
    this.sync()
  }

  stop(): void {
    this.#enabled = false
    this.#teardown()
  }

  sync(): void {
    if (!this.#enabled) return
    const handle = currentProfileHandle()
    if (!handle) {
      this.#teardown()
      return
    }
    if (this.#handle === handle && this.#mount?.isConnected) {
      this.#card?.setTarget(profileTargetForHandle(handle))
      return
    }

    const slot = findHeaderSlot()
    if (!slot) return

    this.#teardown()
    const mount = document.createElement('div')
    mount.setAttribute(HOST_ATTR, 'true')
    mount.style.cssText = 'margin: 8px 0 0;'
    this.#card = new TrustCard({
      target: profileTargetForHandle(handle),
      variant: 'author',
    })
    mount.append(this.#card.host)
    slot.append(mount)
    this.#mount = mount
    this.#handle = handle
  }

  #teardown(): void {
    this.#card?.destroy()
    this.#card = undefined
    this.#mount?.remove()
    this.#mount = undefined
    this.#handle = undefined
    for (const stale of document.querySelectorAll(`[${HOST_ATTR}]`)) {
      stale.remove()
    }
  }
}
