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

const SCORE_STYLE = `
  :host {
    display: inline-flex;
    align-items: center;
    ${X_HEADLINE_FONT}
  }
  .score {
    margin: 0 0 0 6px;
    padding: 0;
    border: 0;
    background: transparent;
    ${X_HEADLINE_FONT}
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

export interface TrustScoreLabel {
  host: HTMLElement
  set(text: string | undefined, tone: TrustTone): void
  setOnOpenPath(handler: (() => void) | undefined): void
  destroy(): void
}

/** Inline trust score next to a name or action-bar chip. */
export function createTrustScoreLabel(): TrustScoreLabel {
  const host = document.createElement('span')
  host.dataset.attentionxScore = 'true'
  host.className = 'hidden'
  host.style.cssText =
    'display:inline-flex;align-items:center;position:relative;z-index:2;' +
    `font-family:${X_FONT};font-size:15px;font-weight:700;line-height:20px;`
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>${SCORE_STYLE}</style>
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
