import type { TrustTone } from '../types'
import { t } from '../i18n'
import { X_FONT } from './icons'
import { TONE_COLORS } from './signals'

/** Matches X timeline author display name typography. */
const X_HEADLINE_FONT = `
  font-family: ${X_FONT};
  font-size: 15px;
  font-weight: 700;
  line-height: 20px;
  letter-spacing: normal;
  font-style: normal;
  -webkit-font-smoothing: antialiased;
`

/**
 * Timeline headline: 1px smaller than X name (15→14) and line-box capped
 * so inline insert does not grow the author row.
 */
const X_HEADLINE_COMPACT_FONT = `
  font-family: ${X_FONT};
  font-size: 14px;
  font-weight: 700;
  line-height: 16px;
  letter-spacing: normal;
  font-style: normal;
  -webkit-font-smoothing: antialiased;
`

function scoreStyle(compact: boolean): string {
  const font = compact ? X_HEADLINE_COMPACT_FONT : X_HEADLINE_FONT
  const marginStart = compact ? '3px' : '6px'
  return `
  :host {
    display: inline-flex;
    align-items: center;
    ${font}
  }
  .score {
    margin: 0 0 0 ${marginStart};
    padding: 0;
    border: 0;
    background: transparent;
    ${font}
    white-space: nowrap;
    color: inherit;
    opacity: .72;
    cursor: pointer;
  }
  .score:hover { text-decoration: underline; }
  :host(.tone-trust) .score { color: ${TONE_COLORS.trust}; opacity: 1; }
  :host(.tone-question) .score { color: ${TONE_COLORS.question}; opacity: 1; }
  :host(.tone-misleading) .score { color: ${TONE_COLORS.misleading}; opacity: 1; }
  :host(.hidden) { display: none; }
`
}

function hostCssText(compact: boolean): string {
  if (compact) {
    return [
      'display:inline-flex',
      'align-items:center',
      'align-self:center',
      'position:relative',
      'z-index:2',
      'margin:0',
      'padding:0',
      'max-height:16px',
      'height:16px',
      'line-height:16px',
      'vertical-align:middle',
      `font-family:${X_FONT}`,
      'font-size:14px',
      'font-weight:700',
    ].join(';')
  }
  return (
    'display:inline-flex;align-items:center;position:relative;z-index:2;' +
    `font-family:${X_FONT};font-size:15px;font-weight:700;line-height:20px;`
  )
}

export interface TrustScoreLabel {
  host: HTMLElement
  set(text: string | undefined, tone: TrustTone): void
  setOnOpenPath(handler: (() => void) | undefined): void
  destroy(): void
}

/** Inline trust score next to a name or action-bar chip. */
export function createTrustScoreLabel(options?: {
  /** Timeline headline: 14px / 16px line-box (1px under X name). */
  compact?: boolean
}): TrustScoreLabel {
  const compact = Boolean(options?.compact)
  const host = document.createElement('span')
  host.dataset.attentionxScore = 'true'
  host.className = 'hidden'
  host.style.cssText = hostCssText(compact)
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>${scoreStyle(compact)}</style>
    <button type="button" class="score" hidden title="${t('content.card.openPath')}" aria-label="${t('content.card.openPath')}"></button>
  `
  const score = root.querySelector('.score') as HTMLButtonElement
  let onOpenPath: (() => void) | undefined

  score.addEventListener('pointerdown', (event) => {
    event.stopPropagation()
  })
  score.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onOpenPath?.()
  })

  return {
    host,
    set(text, tone) {
      if (!text) {
        host.className = 'hidden'
        score.textContent = ''
        score.hidden = true
        return
      }
      host.className = `tone-${tone}`
      score.textContent = text
      score.hidden = false
      score.setAttribute(
        'aria-label',
        `${t('content.card.openPath')}: ${text}`,
      )
    },
    setOnOpenPath(handler) {
      onOpenPath = handler
    },
    destroy() {
      host.remove()
    },
  }
}
