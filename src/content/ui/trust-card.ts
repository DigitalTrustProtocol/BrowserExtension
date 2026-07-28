import { t } from '../i18n'
import {
  BACKGROUND_API_VERSION,
  type PublishResult,
} from '../../shared/contracts'
import { subjectNodeId } from '../../shared/graph-deeplink'
import { openGraphPage } from '../open-graph-page'
import { publishValueForVerdict, trustDescriptor } from '../trust-helpers'
import { descriptorKey, sendMessage, trustStore } from '../trust-store'
import {
  emptyTrustSummary,
  summarizeTrust,
  type TrustSummary,
} from '../trust-summary'
import type { Target, TrustDescriptor, Verdict } from '../types'
import {
  actionButtonCss,
  cardVariantIcon,
  graphLinkIcon,
  X_FONT,
  trustActionButtonsHtml,
} from './icons'
import { capCardTitle } from './card-title'
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
    font-family: ${X_FONT};
    font-size: 13px;
    line-height: 1.4;
    padding: 12px 12px 10px;
    min-width: 220px;
    max-width: min(280px, 85vw);
  }
  .card.compact { min-width: 0; padding: 10px 10px 8px; }
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .header-icon {
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 10%, transparent);
    color: inherit;
    opacity: .85;
  }
  .header-icon svg { display: block; }
  .graph-link {
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin-left: auto;
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    opacity: .8;
    padding: 0;
  }
  .graph-link:hover { opacity: 1; }
  .graph-link svg { display: block; }
  .title {
    font-weight: 700;
    font-size: 15px;
    line-height: 1.25;
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .body {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  }
  .verdict {
    margin: 0;
    opacity: .85;
    font-size: 13px;
    line-height: 1.35;
    font-weight: 400;
  }
  .verdict.tone-trust { color: var(--ax-trust); opacity: 1; }
  .verdict.tone-question { color: var(--ax-question); opacity: 1; }
  .verdict.tone-misleading { color: var(--ax-alert); opacity: 1; }
  .meta {
    margin-top: 4px;
    opacity: .6;
    font-size: 12px;
    line-height: 1.35;
    min-height: 0;
  }
  .meta:empty { display: none; }
  .actions-section {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  }
  ${actionButtonCss()}
  .message {
    min-height: 0;
    margin-top: 8px;
    opacity: .6;
    font-size: 12px;
    line-height: 1.35;
  }
  .message:empty { display: none; }
`

function verdictLine(
  summary: TrustSummary,
  variant: 'author' | 'post',
): string {
  if (summary.resolution === 'none') {
    return variant === 'author'
      ? t('content.card.noAuthorEvidence')
      : t('content.card.noPostEvidence')
  }
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

export interface TrustCardOptions {
  target: Target
  variant: 'author' | 'post'
  /**
   * Popup headline: display name for authors, post snippet / media name / id
   * for posts. Always capped for layout.
   */
  title?: string
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
  readonly #title?: string
  #descriptor?: TrustDescriptor
  #unsubscribe?: () => void
  #summary: TrustSummary = emptyTrustSummary()
  #busy = false
  readonly #onPublished?: () => void

  constructor(options: TrustCardOptions) {
    this.#target = options.target
    this.#variant = options.variant
    this.#title = options.title ? capCardTitle(options.title) : undefined
    this.#onPublished = options.onPublished

    this.host = document.createElement('div')
    this.host.dataset.attentionxTrustCard = options.variant
    this.#root = this.host.attachShadow({ mode: 'open' })
    this.#root.innerHTML = `
      <style>${CARD_STYLE}</style>
      <section class="card${options.compact ? ' compact' : ''}" aria-label="${t('content.panelLabel')}">
        <div class="header">
          <span class="header-icon">${cardVariantIcon(options.variant)}</span>
          <div class="title"></div>
          <button type="button" class="graph-link" data-action="open-graph" title="${t('content.card.openGraph')}" aria-label="${t('content.card.openGraph')}">${graphLinkIcon(16)}</button>
        </div>
        <div class="body">
          <div class="verdict"></div>
          <div class="meta"></div>
        </div>
        <div class="actions-section">
          ${trustActionButtonsHtml({
            trust: t('content.card.trust'),
            distrust: t('content.card.distrust'),
            cancel: t('content.card.cancel'),
          })}
        </div>
        <div class="message" role="status"></div>
      </section>
    `
    this.#root.addEventListener('click', (event) => {
      const graphBtn = (event.target as Element).closest<HTMLButtonElement>(
        'button[data-action="open-graph"]',
      )
      if (graphBtn) {
        event.preventDefault()
        event.stopPropagation()
        void this.#openGraph()
        return
      }
      const button = (event.target as Element).closest<HTMLButtonElement>(
        'button[data-verdict], button[data-action="cancel"]',
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
      const fallback =
        this.#variant === 'author'
          ? `@${this.#target.handle ?? this.#target.id}`
          : capCardTitle(this.#target.id, 14) || t('content.post')
      const text = this.#title || fallback
      title.textContent = text
      title.setAttribute('title', text)
    }

    const verdict = this.#root.querySelector('.verdict')
    if (verdict) {
      verdict.className = `verdict tone-${this.#summary.tone}`
      verdict.textContent =
        !this.#descriptor && this.#variant === 'author'
          ? t('content.profileUnresolved')
          : verdictLine(this.#summary, this.#variant)
    }

    const meta = this.#root.querySelector('.meta')
    if (meta) {
      const bits: string[] = []
      if (this.#summary.direct === 1) bits.push(t('content.card.youTrust'))
      if (this.#summary.direct === -1) {
        bits.push(t('content.card.youDistrust'))
      }
      if (this.#summary.paths > 0) {
        bits.push(
          t('content.evidencePaths', { count: this.#summary.paths }),
        )
      }
      if (this.#summary.truncated) bits.push(t('content.truncatedHint'))
      meta.textContent = bits.join(' · ')
    }

    for (const button of this.#root.querySelectorAll<HTMLButtonElement>(
      'button[data-verdict], button[data-action="cancel"]',
    )) {
      const isCancel = button.dataset.action === 'cancel'
      const pressed =
        (button.dataset.verdict === 'trust' && this.#summary.direct === 1) ||
        (button.dataset.verdict === 'misleading' &&
          this.#summary.direct === -1)
      if (button.dataset.verdict) {
        button.setAttribute('aria-pressed', String(pressed))
      }
      button.disabled =
        this.#busy ||
        !this.#descriptor ||
        (isCancel ? this.#summary.direct === undefined : pressed)
    }
  }

  #setMessage(message: string): void {
    const el = this.#root.querySelector('.message')
    if (el) el.textContent = message
  }

  async #openGraph(): Promise<void> {
    const descriptor = this.#descriptor
    if (!descriptor) {
      this.#setMessage(t('content.resolveProfileFirst'))
      return
    }
    try {
      await openGraphPage({
        mode: 'graph',
        focus: subjectNodeId(descriptor.subject),
        subject: descriptor.subject,
        context: descriptor.context,
      })
    } catch (error) {
      this.#setMessage(
        error instanceof Error ? error.message : t('content.card.openGraphError'),
      )
    }
  }

  async #publish(verdict: Verdict): Promise<void> {
    const descriptor = this.#descriptor
    const value = publishValueForVerdict(verdict)
    if (!descriptor || !value) {
      this.#setMessage(t('content.resolveProfileFirst'))
      return
    }
    // Avoid republishing an identical active statement (would only bump created_at).
    if (
      (verdict === 'trust' && this.#summary.direct === 1) ||
      (verdict === 'misleading' && this.#summary.direct === -1)
    ) {
      return
    }
    this.#busy = true
    this.#paint()
    this.#setMessage(t('content.publishing'))
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
        t('content.publishSuccess', {
          delivered: result.deliveredTo,
          attempted: result.attemptedRelays,
        }),
      )
      this.#onPublished?.()
    } catch (error) {
      this.#setMessage(
        error instanceof Error ? error.message : t('content.publishError'),
      )
    } finally {
      this.#busy = false
      this.#paint()
    }
  }

  async #cancel(): Promise<void> {
    const descriptor = this.#descriptor
    if (!descriptor) {
      this.#setMessage(t('content.resolveProfileFirst'))
      return
    }
    this.#busy = true
    this.#paint()
    this.#setMessage(t('content.cancelling'))
    try {
      const result = await sendMessage<PublishResult>({
        type: 'CANCEL_TRUST_STATEMENT',
        version: BACKGROUND_API_VERSION,
        subject: descriptor.subject,
        context: descriptor.context,
      })
      trustStore.invalidate([descriptorKey(descriptor)])
      this.#setMessage(
        t('content.cancelSuccess', {
          delivered: result.deliveredTo,
          attempted: result.attemptedRelays,
        }),
      )
      this.#onPublished?.()
    } catch (error) {
      this.#setMessage(
        error instanceof Error ? error.message : t('content.publishError'),
      )
    } finally {
      this.#busy = false
      this.#paint()
    }
  }
}
