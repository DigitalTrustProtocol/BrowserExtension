import i18n from 'i18next'
import {
  BACKGROUND_API_VERSION,
  type PublishResult,
} from '../../shared/contracts'
import { publishValueForVerdict, trustDescriptor } from '../trust-helpers'
import { descriptorKey, sendMessage, trustStore } from '../trust-store'
import type { ArticleTargets, Target, Verdict } from '../types'
import { TONE_COLORS } from './signals'

const BAR_STYLE = `
  :host { color-scheme: light dark; }
  .bar {
    position: absolute;
    top: 6px;
    right: 12px;
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: 999px;
    background: color-mix(in srgb, Canvas 90%, #1d9bf0 10%);
    border: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
    color: CanvasText;
    font: 11px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
    opacity: 0;
    pointer-events: none;
    transition: opacity .12s ease;
  }
  :host([data-visible="true"]) .bar { opacity: 1; pointer-events: auto; }
  button {
    border: 0;
    border-radius: 999px;
    padding: 4px 8px;
    cursor: pointer;
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: 600;
    white-space: nowrap;
  }
  button:hover:not(:disabled) {
    background: color-mix(in srgb, currentColor 14%, transparent);
  }
  button:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 1px; }
  button.trust { color: ${TONE_COLORS.trust}; }
  button.distrust { color: ${TONE_COLORS.misleading}; }
  button:disabled { opacity: .35; cursor: not-allowed; }
  button[aria-pressed="true"] { background: color-mix(in srgb, currentColor 20%, transparent); }
`

export interface HoverBar {
  host: HTMLElement
  setTargets(targets: ArticleTargets): void
  destroy(): void
}

/**
 * Quick trust / distrust buttons that fade in over the top-right of a post.
 * Absolutely positioned, so revealing them never shifts X's layout.
 */
export function createHoverBar(article: HTMLElement): HoverBar {
  const hadInlinePosition = article.style.position !== ''
  if (getComputedStyle(article).position === 'static') {
    article.style.position = 'relative'
  }

  const host = document.createElement('div')
  host.dataset.attentionxHoverbar = 'true'
  host.dataset.visible = 'false'
  host.style.cssText =
    'position:absolute;inset:0;pointer-events:none;z-index:3;'
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>${BAR_STYLE}</style>
    <div class="bar" role="toolbar" aria-label="${i18n.t('content.card.quickActions')}">
      <button type="button" class="trust" data-target="profile" data-verdict="trust" title="${i18n.t('content.trustAuthor')}">${i18n.t('content.card.trustAuthorShort')}</button>
      <button type="button" class="distrust" data-target="profile" data-verdict="misleading" title="${i18n.t('content.card.distrustAuthor')}">${i18n.t('content.card.distrustAuthorShort')}</button>
      <button type="button" class="trust" data-target="post" data-verdict="trust" title="${i18n.t('content.trustPost')}">${i18n.t('content.card.trustPostShort')}</button>
      <button type="button" class="distrust" data-target="post" data-verdict="misleading" title="${i18n.t('content.misleadingPost')}">${i18n.t('content.card.distrustPostShort')}</button>
    </div>
  `

  let targets: ArticleTargets | undefined
  let busy = false

  const show = () => {
    host.dataset.visible = 'true'
  }
  const hide = () => {
    host.dataset.visible = 'false'
  }
  const onFocusOut = (event: FocusEvent) => {
    if (!host.contains(event.relatedTarget as Node)) hide()
  }

  article.addEventListener('mouseenter', show)
  article.addEventListener('mouseleave', hide)
  host.addEventListener('focusin', show)
  host.addEventListener('focusout', onFocusOut)

  async function publishQuick(target: Target, verdict: Verdict): Promise<void> {
    const descriptor = trustDescriptor(target)
    const value = publishValueForVerdict(verdict)
    if (!descriptor || !value || busy) return
    busy = true
    syncButtons()
    try {
      await sendMessage<PublishResult>({
        type: 'PUBLISH_TRUST_STATEMENT',
        version: BACKGROUND_API_VERSION,
        subject: descriptor.subject,
        value,
        context: descriptor.context,
        ...(target.handle ? { hintHandle: target.handle } : {}),
      })
      trustStore.invalidate([descriptorKey(descriptor)])
    } catch (error) {
      console.info('AttentionX quick trust publish failed', error)
    } finally {
      busy = false
      syncButtons()
    }
  }

  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      'button[data-target][data-verdict]',
    )
    if (!button || button.disabled || !targets) return
    event.preventDefault()
    event.stopPropagation()
    const target =
      button.dataset.target === 'profile'
        ? targets.profileTarget
        : targets.postTarget
    void publishQuick(target, button.dataset.verdict as Verdict)
  })

  function syncButtons(): void {
    for (const button of root.querySelectorAll<HTMLButtonElement>('button')) {
      const needsProfileId =
        button.dataset.target === 'profile' && !targets?.profileTarget.twitterId
      button.disabled = busy || !targets || needsProfileId
    }
  }

  article.append(host)
  syncButtons()

  return {
    host,
    setTargets(next) {
      targets = next
      syncButtons()
    },
    destroy() {
      article.removeEventListener('mouseenter', show)
      article.removeEventListener('mouseleave', hide)
      host.remove()
      if (!hadInlinePosition) article.style.removeProperty('position')
    },
  }
}
