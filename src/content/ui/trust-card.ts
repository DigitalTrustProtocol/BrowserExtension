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
import type { Target, TrustDescriptor, Verdict } from '../types'
import { TONE_COLORS } from './signals'

const CARD_STYLE = `
  :host { color-scheme: light dark; }
  * { box-sizing: border-box; }
  .card {
    --ax-accent: #1d9bf0;
    --ax-trust: ${TONE_COLORS.trust};
    --ax-question: ${TONE_COLORS.question};
    --ax-alert: ${TONE_COLORS.misleading};
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    border-radius: 12px;
    background: color-mix(in srgb, Canvas 94%, var(--ax-accent) 6%);
    color: CanvasText;
    font: 12px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    padding: 10px 11px;
    min-width: 220px;
  }
  .card.compact { min-width: 0; padding: 8px 9px; }
  .title { font-weight: 700; margin-bottom: 3px; }
  .verdict { margin-bottom: 6px; opacity: .85; }
  .verdict.tone-trust { color: var(--ax-trust); opacity: 1; }
  .verdict.tone-question { color: var(--ax-question); opacity: 1; }
  .verdict.tone-misleading { color: var(--ax-alert); opacity: 1; }
  .meta { opacity: .6; font-size: 10px; margin-bottom: 8px; min-height: 12px; }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  button {
    border: 0;
    border-radius: 999px;
    padding: 5px 11px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    background: color-mix(in srgb, currentColor 10%, transparent);
    color: inherit;
  }
  button:hover:not(:disabled) {
    background: color-mix(in srgb, currentColor 18%, transparent);
  }
  button:focus-visible { outline: 2px solid var(--ax-accent); outline-offset: 1px; }
  button.trust { color: var(--ax-trust); }
  button.distrust { color: var(--ax-alert); }
  button.cancel { opacity: .7; }
  button:disabled { opacity: .35; cursor: not-allowed; }
  button[aria-pressed="true"] { outline: 2px solid currentColor; outline-offset: 1px; }
  .message { min-height: 13px; margin-top: 6px; opacity: .6; font-size: 10px; }
`

function verdictLine(
  summary: TrustSummary,
  variant: 'author' | 'post',
): string {
  if (summary.resolution === 'none') {
    return variant === 'author'
      ? i18n.t('content.card.noAuthorEvidence')
      : i18n.t('content.card.noPostEvidence')
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

export interface TrustCardOptions {
  target: Target
  variant: 'author' | 'post'
  compact?: boolean
  onPublished?: () => void
}

/**
 * The single trust surface reused by the popover, X's hover card and the
 * profile header. Reads from the shared store and publishes via the background.
 */
export class TrustCard {
  readonly host: HTMLElement
  readonly #root: ShadowRoot
  readonly #variant: 'author' | 'post'
  #target: Target
  #descriptor?: TrustDescriptor
  #unsubscribe?: () => void
  #summary: TrustSummary = emptyTrustSummary()
  #busy = false
  readonly #onPublished?: () => void

  constructor(options: TrustCardOptions) {
    this.#target = options.target
    this.#variant = options.variant
    this.#onPublished = options.onPublished

    this.host = document.createElement('div')
    this.host.dataset.attentionxTrustCard = options.variant
    this.#root = this.host.attachShadow({ mode: 'open' })
    this.#root.innerHTML = `
      <style>${CARD_STYLE}</style>
      <section class="card${options.compact ? ' compact' : ''}" aria-label="${i18n.t('content.panelLabel')}">
        <div class="title"></div>
        <div class="verdict"></div>
        <div class="meta"></div>
        <div class="actions">
          <button type="button" class="trust" data-verdict="trust">${i18n.t('content.card.trust')}</button>
          <button type="button" class="distrust" data-verdict="misleading">${i18n.t('content.card.distrust')}</button>
          <button type="button" class="cancel" data-action="cancel">${i18n.t('content.card.cancel')}</button>
        </div>
        <div class="message" role="status"></div>
      </section>
    `
    this.#root.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(
        'button[data-verdict], button[data-action]',
      )
      if (!button || button.disabled) return
      event.preventDefault()
      event.stopPropagation()
      if (button.dataset.action === 'cancel') void this.#cancel()
      else void this.#publish(button.dataset.verdict as Verdict)
    })

    this.setTarget(options.target)
  }

  setTarget(target: Target): void {
    this.#target = target
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    this.#descriptor = trustDescriptor(target)
    this.#summary = emptyTrustSummary()

    if (this.#descriptor) {
      const key = descriptorKey(this.#descriptor)
      const cached = trustStore.get(key)
      if (cached) this.#summary = summarizeTrust(cached)
      this.#unsubscribe = trustStore.subscribe(key, (result) => {
        this.#summary = result ? summarizeTrust(result) : emptyTrustSummary()
        this.#paint()
      })
      trustStore.request(key, this.#descriptor)
    }
    this.#paint()
  }

  destroy(): void {
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    this.host.remove()
  }

  #paint(): void {
    const title = this.#root.querySelector('.title')
    if (title) {
      title.textContent =
        this.#variant === 'author'
          ? `@${this.#target.handle ?? this.#target.id}`
          : i18n.t('content.post')
    }

    const verdict = this.#root.querySelector('.verdict')
    if (verdict) {
      verdict.className = `verdict tone-${this.#summary.tone}`
      verdict.textContent =
        !this.#descriptor && this.#variant === 'author'
          ? i18n.t('content.profileUnresolved')
          : verdictLine(this.#summary, this.#variant)
    }

    const meta = this.#root.querySelector('.meta')
    if (meta) {
      const bits: string[] = []
      if (this.#summary.direct === 1) bits.push(i18n.t('content.card.youTrust'))
      if (this.#summary.direct === -1) {
        bits.push(i18n.t('content.card.youDistrust'))
      }
      if (this.#summary.paths > 0) {
        bits.push(
          i18n.t('content.evidencePaths', { count: this.#summary.paths }),
        )
      }
      if (this.#summary.truncated) bits.push(i18n.t('content.truncatedHint'))
      meta.textContent = bits.join(' · ')
    }

    for (const button of this.#root.querySelectorAll<HTMLButtonElement>(
      'button[data-verdict], button[data-action]',
    )) {
      const isCancel = button.dataset.action === 'cancel'
      button.disabled =
        this.#busy ||
        !this.#descriptor ||
        (isCancel && this.#summary.direct === undefined)
      if (button.dataset.verdict) {
        const pressed =
          (button.dataset.verdict === 'trust' && this.#summary.direct === 1) ||
          (button.dataset.verdict === 'misleading' &&
            this.#summary.direct === -1)
        button.setAttribute('aria-pressed', String(pressed))
      }
    }
  }

  #setMessage(message: string): void {
    const el = this.#root.querySelector('.message')
    if (el) el.textContent = message
  }

  async #publish(verdict: Verdict): Promise<void> {
    const descriptor = this.#descriptor
    const value = publishValueForVerdict(verdict)
    if (!descriptor || !value) {
      this.#setMessage(i18n.t('content.resolveProfileFirst'))
      return
    }
    this.#busy = true
    this.#paint()
    this.#setMessage(i18n.t('content.publishing'))
    try {
      const result = await sendMessage<PublishResult>({
        type: 'PUBLISH_TRUST_STATEMENT',
        version: BACKGROUND_API_VERSION,
        subject: descriptor.subject,
        value,
        context: descriptor.context,
        ...(this.#target.handle ? { hintHandle: this.#target.handle } : {}),
      })
      trustStore.invalidate([descriptorKey(descriptor)])
      this.#setMessage(
        i18n.t('content.publishSuccess', {
          delivered: result.deliveredTo,
          attempted: result.attemptedRelays,
        }),
      )
      this.#onPublished?.()
    } catch (error) {
      this.#setMessage(
        error instanceof Error ? error.message : i18n.t('content.publishError'),
      )
    } finally {
      this.#busy = false
      this.#paint()
    }
  }

  async #cancel(): Promise<void> {
    const descriptor = this.#descriptor
    if (!descriptor) {
      this.#setMessage(i18n.t('content.resolveProfileFirst'))
      return
    }
    this.#busy = true
    this.#paint()
    this.#setMessage(i18n.t('content.cancelling'))
    try {
      const result = await sendMessage<PublishResult>({
        type: 'CANCEL_TRUST_STATEMENT',
        version: BACKGROUND_API_VERSION,
        subject: descriptor.subject,
        context: descriptor.context,
      })
      trustStore.invalidate([descriptorKey(descriptor)])
      this.#setMessage(
        i18n.t('content.cancelSuccess', {
          delivered: result.deliveredTo,
          attempted: result.attemptedRelays,
        }),
      )
      this.#onPublished?.()
    } catch (error) {
      this.#setMessage(
        error instanceof Error ? error.message : i18n.t('content.publishError'),
      )
    } finally {
      this.#busy = false
      this.#paint()
    }
  }
}
