import { t } from '../i18n'
import { isDemoMode, onAppModeChange } from '../app-mode'
import {
  BACKGROUND_API_VERSION,
  type PublishResult,
} from '../../shared/contracts'
import { subjectNodeId } from '../../shared/graph-deeplink'
import { contextField } from '../../shared/trust-context'
import { openGraphPage } from '../open-graph-page'
import { publishValueForVerdict, trustDescriptor, cancelContextFromSummary } from '../trust-helpers'
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
import { applyPageColorScheme } from './theme'

const CARD_STYLE = `
  :host {
    color-scheme: light;
  }
  :host([data-ax-color-scheme="dark"]) {
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  .card {
    --ax-accent: #1d9bf0;
    --ax-trust: ${TONE_COLORS.trust};
    --ax-question: ${TONE_COLORS.question};
    --ax-alert: ${TONE_COLORS.misleading};
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    border-radius: 12px;
    /* Match X surfaces explicitly — OS prefers-color-scheme often disagrees with X. */
    background: #ffffff;
    color: #0f1419;
    font-family: ${X_FONT};
    font-size: 13px;
    line-height: 1.4;
    padding: 12px 12px 10px;
    min-width: 220px;
    max-width: min(280px, 85vw);
  }
  :host([data-ax-color-scheme="dark"]) .card {
    background: #16181c;
    color: #e7e9ea;
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
  .demo-notice {
    margin-top: 8px;
    padding: 6px 8px;
    border-radius: 8px;
    background: color-mix(in srgb, #0ea5e9 16%, transparent);
    color: #0369a1;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.35;
    white-space: pre-line;
  }
  :host([data-ax-color-scheme="dark"]) .demo-notice {
    color: #7dd3fc;
    background: color-mix(in srgb, #0ea5e9 22%, transparent);
  }
  .demo-notice[hidden] { display: none; }
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
  #unsubscribeMode?: () => void

  constructor(options: TrustCardOptions) {
    this.#target = options.target
    this.#variant = options.variant
    this.#title = options.title ? capCardTitle(options.title) : undefined
    this.#onPublished = options.onPublished

    this.host = document.createElement('div')
    this.host.dataset.attentionxTrustCard = options.variant
    applyPageColorScheme(this.host)
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
          <div class="demo-notice" hidden role="status"></div>
        </div>
        <div class="actions-section">
          ${trustActionButtonsHtml({
            trust: t('content.card.trust'),
            distrust: t('content.card.distrust'),
            neutral: t('content.card.neutral'),
            delete: t('content.card.delete'),
            trustHint: t('content.card.trustHint'),
            distrustHint: t('content.card.distrustHint'),
            neutralHint: t('content.card.neutralHint'),
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
        'button[data-verdict], button[data-action="delete"]',
      )
      if (!button || button.disabled) return
      event.preventDefault()
      event.stopPropagation()
      if (button.dataset.action === 'delete') void this.#delete()
      else void this.#publish(button.dataset.verdict as Verdict)
    })

    this.#unsubscribeMode = onAppModeChange(() => this.#paint())
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
    this.#unsubscribeMode?.()
    this.#unsubscribeMode = undefined
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

    const demoNotice = this.#root.querySelector<HTMLElement>('.demo-notice')
    if (demoNotice) {
      const demo = isDemoMode()
      demoNotice.hidden = !demo
      demoNotice.textContent = demo ? t('content.demoNotice') : ''
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
      if (this.#summary.direct === 0) bits.push(t('content.card.youNeutral'))
      if (this.#summary.paths > 0) {
        bits.push(
          t('content.evidencePaths', { count: this.#summary.paths }),
        )
      }
      if (this.#summary.truncated) bits.push(t('content.truncatedHint'))
      meta.textContent = bits.join(' · ')
    }

    for (const button of this.#root.querySelectorAll<HTMLButtonElement>(
      'button[data-verdict], button[data-action="delete"]',
    )) {
      const isDelete = button.dataset.action === 'delete'
      const pressed =
        (button.dataset.verdict === 'trust' && this.#summary.direct === 1) ||
        (button.dataset.verdict === 'misleading' &&
          this.#summary.direct === -1) ||
        (button.dataset.verdict === 'neutral' && this.#summary.direct === 0)
      if (button.dataset.verdict) {
        button.setAttribute('aria-pressed', String(pressed))
      }
      if (isDelete) {
        button.hidden = this.#summary.direct === undefined
      }
      button.disabled =
        this.#busy ||
        !this.#descriptor ||
        (isDelete && this.#summary.direct === undefined)
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
    this.#busy = true
    this.#paint()
    this.#setMessage(
      isDemoMode() ? t('content.demoPublishing') : t('content.publishing'),
    )
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
        result.localOnly || isDemoMode()
          ? t('content.demoPublishSuccess')
          : t('content.publishSuccess', {
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

  async #delete(): Promise<void> {
    const descriptor = this.#descriptor
    if (!descriptor) {
      this.#setMessage(t('content.resolveProfileFirst'))
      return
    }
    if (this.#summary.direct === undefined) return
    this.#busy = true
    this.#paint()
    this.#setMessage(
      isDemoMode() ? t('content.demoDeleting') : t('content.deleting'),
    )
    try {
      const result = await sendMessage<PublishResult>({
        type: 'CANCEL_TRUST_STATEMENT',
        version: BACKGROUND_API_VERSION,
        subject: descriptor.subject,
        ...contextField(cancelContextFromSummary(this.#summary)),
      })
      trustStore.invalidate([descriptorKey(descriptor)])
      this.#setMessage(
        result.localOnly || isDemoMode()
          ? t('content.demoDeleteSuccess')
          : t('content.deleteSuccess', {
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
