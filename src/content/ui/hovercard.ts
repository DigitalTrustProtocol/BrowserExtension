import i18n from 'i18next'
import {
  BACKGROUND_API_VERSION,
  type PublishResult,
} from '../../shared/contracts'
import { publishValueForVerdict, trustDescriptor } from '../trust-helpers'
import { descriptorKey, sendMessage, trustStore } from '../trust-store'
import {
  emptyTrustSummary,
  summarizeTrust,
  type TrustSummary,
} from '../trust-summary'
import type { Target, Verdict } from '../types'
import { handleFromProfileHref, profileTargetForHandle } from './profile-target'
import {
  actionButtonCss,
  X_FONT,
  trustActionButtonsHtml,
} from './icons'
import { TONE_COLORS } from './signals'

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
      padding: 8px 10px;
      border-radius: 12px;
      border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
      background: color-mix(in srgb, Canvas 94%, #1d9bf0 6%);
      color: inherit;
      font-family: ${X_FONT};
      font-size: 13px;
      line-height: 1.4;
      box-sizing: border-box;
    }
    [${HOST_ATTR}] .ax-verdict { margin-bottom: 6px; opacity: .85; font-size: 13px; }
    [${HOST_ATTR}] .ax-verdict.tone-trust { color: ${TONE_COLORS.trust}; opacity: 1; }
    [${HOST_ATTR}] .ax-verdict.tone-question { color: ${TONE_COLORS.question}; opacity: 1; }
    [${HOST_ATTR}] .ax-verdict.tone-misleading { color: ${TONE_COLORS.misleading}; opacity: 1; }
    [${HOST_ATTR}] .ax-meta { opacity: .6; font-size: 13px; margin-bottom: 8px; min-height: 12px; }
    ${actionButtonCss(`[${HOST_ATTR}]`)}
    [${HOST_ATTR}] .ax-message { min-height: 13px; margin-top: 6px; opacity: .6; font-size: 13px; }
  `
  ;(document.head ?? document.documentElement).append(style)
}

function verdictText(summary: TrustSummary): string {
  if (summary.resolution === 'none') {
    return i18n.t('content.card.noAuthorEvidence')
  }
  const parts = [i18n.t(`content.resolution.${summary.resolution}`)]
  if (summary.trustCount > 0 || summary.distrustCount > 0) {
    parts.push(
      i18n.t('content.card.networkCounts', {
        trust: summary.trustCount,
        distrust: summary.distrustCount,
      }),
    )
  }
  if (summary.degree !== undefined) {
    parts.push(i18n.t('content.card.degree', { count: summary.degree }))
  }
  return parts.join(' · ')
}

function createTrustStrip(target: Target): {
  host: HTMLElement
  destroy(): void
} {
  const host = document.createElement('div')
  host.setAttribute(HOST_ATTR, 'true')
  host.innerHTML = `
    <div class="ax-verdict"></div>
    <div class="ax-meta"></div>
    ${trustActionButtonsHtml({
      trust: i18n.t('content.card.trust'),
      distrust: i18n.t('content.card.distrust'),
      cancel: i18n.t('content.card.cancel'),
    })}
    <div class="ax-message" role="status"></div>
  `

  let summary = emptyTrustSummary()
  let busy = false
  const descriptor = trustDescriptor(target)
  let unsubscribe: (() => void) | undefined

  const paint = () => {
    const verdict = host.querySelector('.ax-verdict')
    if (verdict) {
      verdict.className = `ax-verdict tone-${summary.tone}`
      verdict.textContent = !descriptor
        ? i18n.t('content.profileUnresolved')
        : verdictText(summary)
    }
    const meta = host.querySelector('.ax-meta')
    if (meta) {
      const bits: string[] = []
      if (summary.direct === 1) bits.push(i18n.t('content.card.youTrust'))
      if (summary.direct === -1) bits.push(i18n.t('content.card.youDistrust'))
      if (summary.paths > 0) {
        bits.push(i18n.t('content.evidencePaths', { count: summary.paths }))
      }
      meta.textContent = bits.join(' · ')
    }
    for (const button of host.querySelectorAll<HTMLButtonElement>('button')) {
      const isCancel = button.dataset.action === 'cancel'
      const pressed =
        (button.dataset.verdict === 'trust' && summary.direct === 1) ||
        (button.dataset.verdict === 'misleading' && summary.direct === -1)
      if (button.dataset.verdict) {
        button.setAttribute('aria-pressed', String(pressed))
      }
      button.disabled =
        busy ||
        !descriptor ||
        (isCancel ? summary.direct === undefined : pressed)
    }
  }

  const setMessage = (message: string) => {
    const el = host.querySelector('.ax-message')
    if (el) el.textContent = message
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

  host.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      'button[data-verdict], button[data-action]',
    )
    if (!button || button.disabled) return
    // Stop X Follow handlers; do not touch pointerenter/leave.
    event.preventDefault()
    event.stopPropagation()

    void (async () => {
      if (!descriptor) {
        setMessage(i18n.t('content.resolveProfileFirst'))
        return
      }
      busy = true
      paint()
      try {
        if (button.dataset.action === 'cancel') {
          setMessage(i18n.t('content.cancelling'))
          const result = await sendMessage<PublishResult>({
            type: 'CANCEL_TRUST_STATEMENT',
            version: BACKGROUND_API_VERSION,
            subject: descriptor.subject,
            context: descriptor.context,
          })
          trustStore.invalidate([descriptorKey(descriptor)])
          setMessage(
            i18n.t('content.cancelSuccess', {
              delivered: result.deliveredTo,
              attempted: result.attemptedRelays,
            }),
          )
        } else {
          const verdict = button.dataset.verdict as Verdict
          // Avoid republishing an identical active statement (would only bump created_at).
          if (
            (verdict === 'trust' && summary.direct === 1) ||
            (verdict === 'misleading' && summary.direct === -1)
          ) {
            return
          }
          const value = publishValueForVerdict(verdict)
          if (!value) return
          setMessage(i18n.t('content.publishing'))
          const result = await sendMessage<PublishResult>({
            type: 'PUBLISH_TRUST_STATEMENT',
            version: BACKGROUND_API_VERSION,
            subject: descriptor.subject,
            value,
            context: descriptor.context,
            ...(target.handle ? { hintHandle: target.handle } : {}),
          })
          trustStore.invalidate([descriptorKey(descriptor)])
          setMessage(
            i18n.t('content.publishSuccess', {
              delivered: result.deliveredTo,
              attempted: result.attemptedRelays,
            }),
          )
        }
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : i18n.t('content.publishError'),
        )
      } finally {
        busy = false
        paint()
      }
    })()
  })

  return {
    host,
    destroy() {
      unsubscribe?.()
      host.remove()
    },
  }
}

/**
 * Embeds the full trust strip inside X's hover-safe content root (the same
 * subtree as Follow). That expands the card's interactive area for free:
 * X keeps the card open via DOM containment, not a frozen pixel polygon.
 */
export class HoverCardAugmentor {
  #observer?: MutationObserver
  #enabled = false
  #strip?: { host: HTMLElement; destroy(): void }
  #card?: HTMLElement
  #scanRaf = 0

  start(): void {
    if (this.#enabled) return
    this.#enabled = true
    ensureStyles()
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
    this.#teardown()
    document.getElementById(STYLE_ID)?.remove()
  }

  #scheduleScan(): void {
    if (this.#scanRaf) return
    this.#scanRaf = requestAnimationFrame(() => {
      this.#scanRaf = 0
      this.#scan()
    })
  }

  #teardown(): void {
    this.#strip?.destroy()
    this.#strip = undefined
    this.#card = undefined
    for (const stale of document.querySelectorAll(`[${HOST_ATTR}]`)) {
      stale.remove()
    }
  }

  #scan(): void {
    if (!this.#enabled) return

    if (this.#strip && !this.#strip.host.isConnected) this.#teardown()

    const card = document.querySelector<HTMLElement>('[data-testid="HoverCard"]')
    if (!card?.isConnected) {
      this.#teardown()
      return
    }
    if (this.#card === card && this.#strip?.host.isConnected) return

    const handle = resolveHandle(card)
    const safeRoot = findHoverSafeRoot(card)
    if (!handle || !safeRoot) return

    this.#teardown()
    const strip = createTrustStrip(profileTargetForHandle(handle))
    // Append inside the safe root — same containment tree as Follow.
    safeRoot.append(strip.host)
    this.#strip = strip
    this.#card = card
  }
}
