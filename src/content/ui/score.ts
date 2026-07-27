import type { TrustTone } from '../types'
import { TONE_COLORS } from './signals'

const SCORE_STYLE = `
  :host { display: inline-flex; align-items: center; line-height: 1; }
  .score {
    margin: 0 0 0 6px;
    padding: 0;
    font: 11px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
    font-weight: 600;
    white-space: nowrap;
    color: inherit;
    opacity: .72;
  }
  :host(.tone-trust) .score { color: ${TONE_COLORS.trust}; opacity: 1; }
  :host(.tone-question) .score { color: ${TONE_COLORS.question}; opacity: 1; }
  :host(.tone-misleading) .score { color: ${TONE_COLORS.misleading}; opacity: 1; }
  :host(.hidden) { display: none; }
`

export interface TrustScoreLabel {
  host: HTMLElement
  set(text: string | undefined, tone: TrustTone): void
  destroy(): void
}

/** Compact inline trust score next to a name or action-bar chip. */
export function createTrustScoreLabel(): TrustScoreLabel {
  const host = document.createElement('span')
  host.dataset.attentionxScore = 'true'
  host.className = 'hidden'
  host.style.cssText = 'display:inline-flex;align-items:center;line-height:1;'
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>${SCORE_STYLE}</style>
    <span class="score"></span>
  `
  const score = root.querySelector('.score') as HTMLElement

  return {
    host,
    set(text, tone) {
      if (!text) {
        host.className = 'hidden'
        score.textContent = ''
        return
      }
      host.className = `tone-${tone}`
      score.textContent = text
    },
    destroy() {
      host.remove()
    },
  }
}
