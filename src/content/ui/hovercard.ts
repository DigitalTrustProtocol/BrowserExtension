import { t } from '../i18n'
import { isDemoMode, onAppModeChange } from '../app-mode'
import { trustDescriptor } from '../trust-helpers'
import { descriptorKey, trustStore } from '../trust-store'
import {
  emptyTrustSummary,
  summarizeTrust,
  type TrustSummary,
} from '../trust-summary'
import type { Target } from '../types'
import { handleFromProfileHref, profileTargetForHandle } from './profile-target'
import { X_FONT } from './icons'
import { readDisplayName, TONE_COLORS } from './signals'
import { openTrustDialog } from './trust-dialog'
import { cloneAuthorVerifiedBadge } from './hide'

const HOST_ATTR = 'data-attentionx-hovercard'
const STYLE_ID = 'attentionx-hovercard-style'

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

function findAction(card: HTMLElement): HTMLElement | undefined {
  return (
    card.querySelector<HTMLElement>('[data-testid$="-follow"]') ??
    card.querySelector<HTMLElement>('[data-testid$="-unfollow"]') ??
    card.querySelector<HTMLElement>('[data-testid$="-subscribe"]') ??
    card.querySelector<HTMLElement>('[data-testid$="-unsubscribe"]') ??
    card.querySelector<HTMLElement>('[data-testid="userActions"] button') ??
    card.querySelector<HTMLElement>('button[role="button"]') ??
    undefined
  )
}

/**
 * The HoverCard child that contains Follow/avatar/bio — the subtree X uses for
 * mouseleave containment. Content appended here stays "inside" the card.
 */
function findHoverSafeRoot(card: HTMLElement): HTMLElement | undefined {
  const action = findAction(card)
  if (!action) return undefined
  let el: HTMLElement | null = action
  while (el && el.parentElement && el.parentElement !== card) {
    el = el.parentElement
  }
  return el ?? undefined
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    [${HOST_ATTR}] {
      display: block;
      margin: 8px 12px 12px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
      background: color-mix(in srgb, Canvas 94%, #1d9bf0 6%);
      color: inherit;
      font-family: ${X_FONT};
      font-size: 13px;
      line-height: 1.4;
      box-sizing: border-box;
    }
    [${HOST_ATTR}] .ax-body {
      margin: 0 0 8px;
    }
    [${HOST_ATTR}] .ax-verdict {
      margin: 0;
      opacity: .85;
      font-size: 13px;
      line-height: 1.35;
      font-weight: 400;
    }
    [${HOST_ATTR}] .ax-verdict.tone-trust { color: ${TONE_COLORS.trust}; opacity: 1; }
    [${HOST_ATTR}] .ax-verdict.tone-question { color: ${TONE_COLORS.question}; opacity: 1; }
    [${HOST_ATTR}] .ax-verdict.tone-misleading { color: ${TONE_COLORS.misleading}; opacity: 1; }
    [${HOST_ATTR}] .ax-meta {
      margin: 4px 0 0;
      font-size: 12px;
      opacity: .7;
    }
    [${HOST_ATTR}] .ax-demo-notice {
      margin: 6px 0 0;
      font-size: 12px;
      opacity: .85;
      line-height: 1.35;
      white-space: pre-line;
    }
    [${HOST_ATTR}] .ax-open-dialog {
      margin: 0;
      box-sizing: border-box;
      min-height: 32px;
      width: 100%;
      padding: 0 16px;
      border: 1px solid color-mix(in srgb, ${TONE_COLORS.trust} 55%, transparent);
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      background: transparent;
      color: ${TONE_COLORS.trust};
      font-family: inherit;
      font-size: 14px;
      font-weight: 700;
      line-height: 1;
    }
    [${HOST_ATTR}] .ax-open-dialog:hover:not(:disabled) {
      background: color-mix(in srgb, ${TONE_COLORS.trust} 12%, transparent);
    }
    [${HOST_ATTR}] .ax-open-dialog:disabled {
      opacity: .4;
      cursor: not-allowed;
    }
  `
  document.documentElement.append(style)
}

function verdictText(summary: TrustSummary): string {
  if (summary.direct === 1) return t('content.card.youTrust')
  if (summary.direct === -1) return t('content.card.youDistrust')
  const parts = [t(`content.resolution.${summary.resolution}`)]
  if (summary.trustCount > 0 || summary.distrustCount > 0) {
    parts.push(
      t('content.card.networkCounts', {
        trust: summary.trustCount,
        distrust: summary.distrustCount,
      }),
    )
  }
  if (summary.degree !== undefined) {
    parts.push(t('content.card.degree', { count: summary.degree }))
  }
  return parts.join(' · ')
}

function createTrustStrip(
  target: Target,
  card: HTMLElement,
): {
  host: HTMLElement
  destroy(): void
} {
  const host = document.createElement('div')
  host.setAttribute(HOST_ATTR, 'true')
  host.innerHTML = `
    <div class="ax-body">
      <div class="ax-verdict"></div>
      <div class="ax-meta"></div>
      <div class="ax-demo-notice" hidden role="status"></div>
    </div>
    <button type="button" class="ax-open-dialog">${t('content.dialog.trustUser')}</button>
  `

  let summary = emptyTrustSummary()
  const descriptor = trustDescriptor(target)
  let unsubscribe: (() => void) | undefined

  const paint = () => {
    const verdict = host.querySelector('.ax-verdict')
    if (verdict) {
      verdict.className = `ax-verdict tone-${summary.tone}`
      verdict.textContent = !descriptor
        ? t('content.profileUnresolved')
        : verdictText(summary)
    }
    const demoNotice = host.querySelector<HTMLElement>('.ax-demo-notice')
    if (demoNotice) {
      const demo = isDemoMode()
      demoNotice.hidden = !demo
      demoNotice.textContent = demo ? t('content.demoNotice') : ''
    }
    const meta = host.querySelector('.ax-meta')
    if (meta) {
      const bits: string[] = []
      if (summary.paths > 0) {
        bits.push(t('content.evidencePaths', { count: summary.paths }))
      }
      meta.textContent = bits.join(' · ')
    }
    const button = host.querySelector<HTMLButtonElement>('.ax-open-dialog')
    if (button) button.disabled = !descriptor
  }

  if (descriptor) {
    const key = descriptorKey(descriptor)
    const cached = trustStore.get(key)
    if (cached) summary = summarizeTrust(cached)
    unsubscribe = trustStore.subscribe(key, (result) => {
      summary = result ? summarizeTrust(result) : emptyTrustSummary()
      paint()
    })
    trustStore.request(key, descriptor)
  }
  paint()

  const unsubscribeMode = onAppModeChange(() => paint())

  host.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      '.ax-open-dialog',
    )
    if (!button || button.disabled) return
    event.preventDefault()
    event.stopPropagation()
    const displayName = readDisplayName(card)
    const verifiedBadge = cloneAuthorVerifiedBadge(card)
    openTrustDialog({
      target,
      variant: 'author',
      title: displayName || (target.handle ? `@${target.handle}` : undefined),
      ...(verifiedBadge ? { verifiedBadge } : {}),
    })
  })

  return {
    host,
    destroy() {
      unsubscribe?.()
      unsubscribeMode()
      host.remove()
    },
  }
}

/**
 * Embeds the full trust strip inside X's hover-safe content root (the same
 * subtree Follow lives in) so mouseleave still treats the strip as inside.
 */
export class HoverCardAugmentor {
  #enabled = false
  #observer?: MutationObserver
  #mounted?: { card: HTMLElement; destroy(): void }

  start(): void {
    this.setEnabled(true)
  }

  stop(): void {
    this.setEnabled(false)
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled
    if (!enabled) {
      this.#tearDown()
      this.#observer?.disconnect()
      this.#observer = undefined
      return
    }
    ensureStyles()
    this.#scan()
    if (!this.#observer) {
      this.#observer = new MutationObserver(() => this.#scan())
      this.#observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      })
    }
  }

  destroy(): void {
    this.setEnabled(false)
  }

  #tearDown(): void {
    this.#mounted?.destroy()
    this.#mounted = undefined
  }

  #scan(): void {
    if (!this.#enabled) return
    const card = document.querySelector<HTMLElement>('[data-testid="HoverCard"]')
    if (!card) {
      this.#tearDown()
      return
    }
    if (this.#mounted?.card === card) return
    this.#tearDown()
    const handle = resolveHandle(card)
    if (!handle) return
    const root = findHoverSafeRoot(card)
    if (!root) return
    const strip = createTrustStrip(profileTargetForHandle(handle), card)
    root.append(strip.host)
    this.#mounted = { card, destroy: () => strip.destroy() }
  }
}
