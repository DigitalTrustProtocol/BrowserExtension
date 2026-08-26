import {
  BACKGROUND_API_VERSION,
  type PublishResult,
} from '../../shared/contracts'
import {
  ATTENTIONX_TRUST_CONTENT_UI_LIMIT,
  sanitizeTrustContent,
} from '../../shared/trust-content'
import { isDemoMode, onAppModeChange } from '../app-mode'
import { t } from '../i18n'
import { openSidePanel } from '../open-side-panel'
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
  notesPanelIcon,
  X_FONT,
  trustActionButtonsHtml,
} from './icons'
import { capCardTitle } from './card-title'
import { formatTrustScore, TONE_COLORS } from './signals'
import { applyPageColorScheme } from './theme'

const DIALOG_STYLE = `
  :host {
    color-scheme: light;
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: block;
    pointer-events: auto;
  }
  :host([data-ax-color-scheme="dark"]) {
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
  }
  .panel {
    --ax-accent: #1d9bf0;
    --ax-trust: ${TONE_COLORS.trust};
    --ax-alert: ${TONE_COLORS.misleading};
    position: absolute;
    left: 50%;
    top: 12vh;
    transform: translateX(-50%);
    width: min(520px, calc(100vw - 24px));
    max-height: min(80vh, 640px);
    overflow: auto;
    border-radius: 16px;
    border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
    background: #ffffff;
    color: #0f1419;
    font-family: ${X_FONT};
    font-size: 15px;
    line-height: 1.4;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
    padding: 16px 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  :host([data-ax-color-scheme="dark"]) .panel {
    background: #16181c;
    color: #e7e9ea;
  }
  .header {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-width: 0;
  }
  .header-icon {
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 10%, transparent);
  }
  .header-text { min-width: 0; flex: 1; }
  .title {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    font-weight: 700;
    font-size: 17px;
    line-height: 1.25;
  }
  .title-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title-name.tone-trust {
    text-decoration: underline;
    text-decoration-color: ${TONE_COLORS.trust};
    text-underline-offset: 3px;
    text-decoration-thickness: 2px;
  }
  .title-name.tone-question {
    text-decoration: underline;
    text-decoration-color: ${TONE_COLORS.question};
    text-underline-offset: 3px;
    text-decoration-thickness: 2px;
  }
  .title-name.tone-misleading {
    text-decoration: underline;
    text-decoration-color: ${TONE_COLORS.misleading};
    text-underline-offset: 3px;
    text-decoration-thickness: 2px;
  }
  .title-verified {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    line-height: 0;
  }
  .title-verified:empty { display: none; }
  .title-verified svg {
    width: 18px;
    height: 18px;
    display: block;
  }
  .title-sep {
    flex-shrink: 0;
    opacity: 0.55;
    font-weight: 600;
  }
  .title-sep:empty { display: none; }
  .title-detail {
    flex-shrink: 0;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    font: inherit;
    font-weight: 600;
    font-size: 14px;
    opacity: 0.85;
    white-space: nowrap;
    color: inherit;
    cursor: pointer;
  }
  .title-detail[hidden] { display: none; }
  .title-detail:hover { text-decoration: underline; }
  .title-detail.tone-trust { color: ${TONE_COLORS.trust}; opacity: 1; }
  .title-detail.tone-question { color: ${TONE_COLORS.question}; opacity: 1; }
  .title-detail.tone-misleading { color: ${TONE_COLORS.misleading}; opacity: 1; }
  .subtitle {
    margin-top: 2px;
    font-size: 13px;
    opacity: 0.75;
  }
  .header-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
  .icon-btn {
    width: 32px;
    height: 32px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    background: transparent;
    color: inherit;
    cursor: pointer;
    display: inline-grid;
    place-items: center;
    padding: 0;
    opacity: 0.85;
  }
  .icon-btn:hover { opacity: 1; }
  .icon-btn[hidden] { display: none; }
  .verdict {
    font-size: 14px;
    font-weight: 600;
  }
  .verdict.tone-trust { color: var(--ax-trust); }
  .verdict.tone-misleading { color: var(--ax-alert); }
  .demo-notice {
    padding: 8px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, #f4212e 12%, transparent);
    color: inherit;
    font-size: 13px;
    line-height: 1.35;
    white-space: pre-line;
  }
  label.note-label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 6px;
  }
  textarea.note {
    width: 100%;
    min-height: 88px;
    resize: vertical;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
    background: transparent;
    color: inherit;
    font: inherit;
    padding: 12px;
  }
  textarea.note:focus {
    outline: 2px solid var(--ax-accent);
    outline-offset: 1px;
  }
  .note-meta {
    display: flex;
    justify-content: flex-end;
    font-size: 12px;
    opacity: 0.65;
    margin-top: 4px;
  }
  .actions-section { margin-top: 4px; }
  ${actionButtonCss()}
  .message {
    min-height: 1.2em;
    font-size: 13px;
    opacity: 0.85;
  }
  .footnote {
    font-size: 12px;
    opacity: 0.7;
    line-height: 1.35;
  }
  .footnote a {
    color: var(--ax-accent);
    text-decoration: none;
    cursor: pointer;
  }
  .footnote a:hover { text-decoration: underline; }
`

export interface TrustDialogOptions {
  target: Target
  variant: 'author' | 'post'
  title?: string
  /** Post dialog: author display name under the post title. */
  subtitle?: string
  /** Cloned X verified / affiliation badge for author dialogs. */
  verifiedBadge?: SVGElement
  /** Shown when reopening after a failed publish. */
  initialMessage?: string
  onPublished?: () => void
}

let activeDialog: TrustDialog | undefined

export function openTrustDialog(options: TrustDialogOptions): TrustDialog {
  activeDialog?.close()
  const dialog = new TrustDialog(options)
  activeDialog = dialog
  dialog.open()
  return dialog
}

export class TrustDialog {
  readonly host: HTMLElement
  readonly #root: ShadowRoot
  readonly #options: TrustDialogOptions
  readonly #variant: 'author' | 'post'
  readonly #target: Target
  readonly #title?: string
  readonly #subtitle?: string
  readonly #verifiedBadge?: SVGElement
  readonly #onPublished?: () => void
  #descriptor?: TrustDescriptor
  #unsubscribe?: () => void
  #unsubscribeMode?: () => void
  #summary: TrustSummary = emptyTrustSummary()
  #busy = false
  #previousFocus: HTMLElement | null = null
  #keydown?: (event: KeyboardEvent) => void

  constructor(options: TrustDialogOptions) {
    this.#options = options
    this.#target = options.target
    this.#variant = options.variant
    this.#title = options.title ? capCardTitle(options.title) : undefined
    this.#subtitle = options.subtitle?.trim() || undefined
    this.#verifiedBadge = options.verifiedBadge
      ? (options.verifiedBadge.cloneNode(true) as SVGElement)
      : undefined
    this.#onPublished = options.onPublished

    this.host = document.createElement('div')
    this.host.dataset.attentionxTrustDialog = options.variant
    applyPageColorScheme(this.host)
    this.#root = this.host.attachShadow({ mode: 'open' })
    this.#root.innerHTML = `
      <style>${DIALOG_STYLE}</style>
      <div class="backdrop" data-action="close"></div>
      <div
        class="panel"
        role="dialog"
        aria-modal="true"
        aria-label="${t('content.dialog.title')}"
      >
        <div class="header">
          <span class="header-icon">${cardVariantIcon(options.variant)}</span>
          <div class="header-text">
            <div class="title">
              <span class="title-name"></span>
              <span class="title-verified"></span>
              <span class="title-sep" aria-hidden="true"></span>
              <button type="button" class="title-detail" data-action="open-panel" hidden></button>
            </div>
            <div class="subtitle"></div>
          </div>
          <div class="header-actions">
            <button type="button" class="icon-btn" data-action="open-panel" title="${t('content.card.openPanel')}" aria-label="${t('content.card.openPanel')}" hidden>${notesPanelIcon(16)}</button>
            <button type="button" class="icon-btn" data-action="close" title="${t('content.dialog.close')}" aria-label="${t('content.dialog.close')}">✕</button>
          </div>
        </div>
        <div class="verdict"></div>
        <div class="demo-notice" hidden role="status"></div>
        <div>
          <label class="note-label" for="ax-trust-note">${t('content.dialog.noteLabel')}</label>
          <textarea
            id="ax-trust-note"
            class="note"
            maxlength="${ATTENTIONX_TRUST_CONTENT_UI_LIMIT}"
            rows="3"
            placeholder="${t('content.dialog.notePlaceholder')}"
          ></textarea>
          <div class="note-meta"><span class="count">0</span> / ${ATTENTIONX_TRUST_CONTENT_UI_LIMIT}</div>
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
        <div class="footnote" hidden></div>
      </div>
    `

    this.#root.addEventListener('click', (event) => {
      const el = (event.target as Element).closest<HTMLElement>(
        '[data-action], button[data-verdict]',
      )
      if (!el) return
      event.preventDefault()
      event.stopPropagation()
      if (el.dataset.action === 'close') {
        this.close()
        return
      }
      if (el.dataset.action === 'open-panel') {
        void this.#openPanel()
        return
      }
      if (el.dataset.action === 'open-outbox') {
        void this.#openOutbox()
        return
      }
      if (el instanceof HTMLButtonElement && el.dataset.verdict) {
        void this.#publish(el.dataset.verdict as Verdict)
        return
      }
      if (el.dataset.action === 'delete') {
        void this.#delete()
      }
    })

    const note = this.#root.querySelector<HTMLTextAreaElement>('textarea.note')
    note?.addEventListener('input', () => this.#paintCount())

    this.#unsubscribeMode = onAppModeChange(() => this.#paint())
    this.#bindTarget()
  }

  open(): void {
    this.#previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    document.documentElement.append(this.host)
    this.#keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        this.close()
      }
    }
    window.addEventListener('keydown', this.#keydown, true)
    this.#paint()
    if (this.#options.initialMessage) {
      this.#setMessage(this.#options.initialMessage)
    }
    queueMicrotask(() => {
      this.#root.querySelector<HTMLTextAreaElement>('textarea.note')?.focus()
    })
  }

  close(): void {
    if (activeDialog === this) activeDialog = undefined
    if (this.#keydown) {
      window.removeEventListener('keydown', this.#keydown, true)
    }
    this.#keydown = undefined
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    this.#unsubscribeMode?.()
    this.#unsubscribeMode = undefined
    this.host.remove()
    this.#previousFocus?.focus?.()
    this.#previousFocus = null
  }

  #bindTarget(): void {
    this.#unsubscribe?.()
    this.#descriptor = trustDescriptor(this.#target)
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

  #noteContent(): string {
    const raw =
      this.#root.querySelector<HTMLTextAreaElement>('textarea.note')?.value ??
      ''
    return sanitizeTrustContent(raw)
  }

  #paintCount(): void {
    const note =
      this.#root.querySelector<HTMLTextAreaElement>('textarea.note')
    const count = this.#root.querySelector('.count')
    if (!note || !count) return
    count.textContent = String([...note.value].length)
  }

  #paint(): void {
    const nameEl = this.#root.querySelector('.title-name')
    const verifiedEl = this.#root.querySelector('.title-verified')
    const sepEl = this.#root.querySelector('.title-sep')
    const detailEl = this.#root.querySelector<HTMLButtonElement>('.title-detail')
    const subtitle = this.#root.querySelector('.subtitle')

    if (this.#variant === 'author') {
      const name =
        this.#title ||
        (this.#target.handle
          ? `@${this.#target.handle}`
          : t('content.author'))
      if (nameEl) {
        nameEl.textContent = name
        const ambient =
          this.#summary.resolution !== 'none' ? this.#summary.tone : 'neutral'
        nameEl.className =
          ambient === 'neutral' ? 'title-name' : `title-name tone-${ambient}`
      }
      if (verifiedEl) {
        verifiedEl.replaceChildren()
        if (this.#verifiedBadge) {
          verifiedEl.append(this.#verifiedBadge.cloneNode(true))
        }
      }
      const detail = formatTrustScore(this.#summary)
      if (sepEl) sepEl.textContent = detail ? '·' : ''
      if (detailEl) {
        if (detail) {
          detailEl.hidden = false
          detailEl.disabled = !this.#descriptor
          detailEl.textContent = detail
          detailEl.className = `title-detail tone-${this.#summary.tone}`
          detailEl.title = t('content.card.openPanel')
          detailEl.setAttribute(
            'aria-label',
            `${t('content.card.openPanel')}: ${detail}`,
          )
        } else {
          detailEl.hidden = true
          detailEl.disabled = true
          detailEl.textContent = ''
          detailEl.className = 'title-detail'
          detailEl.removeAttribute('title')
          detailEl.setAttribute('aria-label', t('content.card.openPanel'))
        }
      }
      if (subtitle) {
        subtitle.textContent = this.#target.handle
          ? `@${this.#target.handle}`
          : t('content.profileUnresolved')
      }
    } else {
      if (nameEl) {
        nameEl.textContent = this.#title || t('content.post')
        nameEl.className = 'title-name'
      }
      if (verifiedEl) verifiedEl.replaceChildren()
      if (sepEl) sepEl.textContent = ''
      if (detailEl) {
        detailEl.hidden = true
        detailEl.disabled = true
        detailEl.textContent = ''
        detailEl.className = 'title-detail'
      }
      if (subtitle) {
        subtitle.textContent =
          this.#subtitle ||
          (this.#target.handle
            ? `@${this.#target.handle}`
            : t('content.dialog.postId', { id: this.#target.id }))
      }
    }
    const verdict = this.#root.querySelector<HTMLElement>('.verdict')
    const panelBtn = this.#root.querySelector<HTMLButtonElement>(
      '.header-actions [data-action="open-panel"]',
    )
    if (panelBtn) {
      panelBtn.hidden = !this.#descriptor
      panelBtn.disabled = !this.#descriptor
    }
    if (verdict) {
      // Author header already shows detail next to the name; skip the duplicate.
      if (this.#variant === 'author') {
        verdict.hidden = true
        verdict.textContent = ''
        verdict.className = 'verdict'
      } else {
        verdict.hidden = false
        verdict.className = `verdict tone-${this.#summary.tone}`
        if (!this.#descriptor) {
          verdict.textContent = t('content.profileUnresolved')
        } else if (this.#summary.direct === 1) {
          verdict.textContent = t('content.card.youTrust')
        } else if (this.#summary.direct === -1) {
          verdict.textContent = t('content.card.youDistrust')
        } else if (this.#summary.direct === 0) {
          verdict.textContent = t('content.card.youNeutral')
        } else {
          verdict.textContent = t(
            `content.resolution.${this.#summary.resolution}`,
          )
        }
      }
    }
    const demoNotice = this.#root.querySelector<HTMLElement>('.demo-notice')
    if (demoNotice) {
      const demo = isDemoMode()
      demoNotice.hidden = !demo
      demoNotice.textContent = demo ? t('content.demoNotice') : ''
    }
    const footnote = this.#root.querySelector<HTMLElement>('.footnote')
    if (footnote) {
      const demo = isDemoMode()
      footnote.hidden = demo
      if (!demo) {
        footnote.replaceChildren()
        footnote.append(
          document.createTextNode(`${t('content.dialog.holdNotice')} `),
        )
        const link = document.createElement('a')
        link.href = '#'
        link.dataset.action = 'open-outbox'
        link.textContent = t('content.dialog.openOutbox')
        footnote.append(link)
      }
    }
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>(
      'button[data-verdict], button[data-action="delete"]',
    )) {
      const isDelete = button.dataset.action === 'delete'
      const pressed =
        (button.dataset.verdict === 'trust' && this.#summary.direct === 1) ||
        (button.dataset.verdict === 'misleading' && this.#summary.direct === -1) ||
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
    this.#paintCount()
  }

  #setMessage(message: string): void {
    const el = this.#root.querySelector('.message')
    if (el) el.textContent = message
  }

  async #openPanel(): Promise<void> {
    const descriptor = this.#descriptor
    if (!descriptor) {
      this.#setMessage(t('content.resolveProfileFirst'))
      return
    }
    try {
      await openSidePanel({
        subject: descriptor.subject,
        context: descriptor.context,
      })
    } catch (error) {
      this.#setMessage(
        error instanceof Error ? error.message : t('content.rating.openPanelError'),
      )
    }
  }

  async #openOutbox(): Promise<void> {
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'OPEN_OUTBOX_PAGE',
        version: BACKGROUND_API_VERSION,
      })) as { ok?: boolean; error?: string }
      if (!response?.ok) {
        throw new Error(response?.error ?? t('content.dialog.openOutboxError'))
      }
    } catch (error) {
      this.#setMessage(
        error instanceof Error
          ? error.message
          : t('content.dialog.openOutboxError'),
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
    const content = this.#noteContent()
    const handle = this.#target.handle
    await this.#commit(descriptor, async () => {
      await sendMessage<PublishResult>({
        type: 'PUBLISH_TRUST_STATEMENT',
        version: BACKGROUND_API_VERSION,
        subject: descriptor.subject,
        value,
        context: descriptor.context,
        content,
        ...(handle ? { hintHandle: handle } : {}),
      })
    })
  }

  async #delete(): Promise<void> {
    const descriptor = this.#descriptor
    if (!descriptor) {
      this.#setMessage(t('content.resolveProfileFirst'))
      return
    }
    if (this.#summary.direct === undefined) return
    const content = this.#noteContent()
    await this.#commit(descriptor, async () => {
      await sendMessage<PublishResult>({
        type: 'CANCEL_TRUST_STATEMENT',
        version: BACKGROUND_API_VERSION,
        subject: descriptor.subject,
        context: descriptor.context,
        ...(content ? { content } : {}),
      })
    })
  }

  async #commit(
    descriptor: TrustDescriptor,
    run: () => Promise<void>,
  ): Promise<void> {
    if (this.#busy) return
    const key = descriptorKey(descriptor)
    const reopen: TrustDialogOptions = {
      ...this.#options,
      initialMessage: undefined,
    }
    this.#busy = true
    trustStore.beginMutation(key)
    this.close()
    try {
      await run()
      trustStore.invalidate([key])
      await trustStore.flushNow()
      try {
        this.#onPublished?.()
      } catch {
        /* chip flash must not surface as a publish error */
      }
    } catch (error) {
      openTrustDialog({
        ...reopen,
        initialMessage:
          error instanceof Error ? error.message : t('content.publishError'),
      })
    } finally {
      trustStore.endMutation(key)
    }
  }
}
