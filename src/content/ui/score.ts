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

function scoreStyle(compact: boolean, rail: boolean): string {
  const font = compact ? X_HEADLINE_COMPACT_FONT : X_HEADLINE_FONT
  const railFont = `
  font-family: ${X_FONT};
  font-size: 12px;
  font-weight: 700;
  line-height: 16px;
  letter-spacing: normal;
  font-style: normal;
  -webkit-font-smoothing: antialiased;
`
  const usedFont = rail ? railFont : font
  const marginStart = rail ? '4px' : compact ? '3px' : '6px'
  return `
  :host {
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    text-decoration: none;
    ${usedFont}
  }
  .score {
    margin: 0 0 0 ${marginStart};
    padding: 0;
    border: 0;
    background: transparent;
    ${usedFont}
    ${compact || rail
      ? 'display: inline-flex; align-items: center; appearance: none; height: 14px; line-height: 1;'
      : ''}
    white-space: nowrap;
    color: inherit;
    opacity: .72;
    cursor: pointer;
    text-decoration: none;
  }
  .score:hover,
  .score:focus-visible {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  :host(.tone-trust) .score { color: ${TONE_COLORS.trust}; opacity: 1; }
  :host(.tone-question) .score { color: ${TONE_COLORS.question}; opacity: 1; }
  :host(.tone-misleading) .score { color: ${TONE_COLORS.misleading}; opacity: 1; }
  :host(.hidden) { display: none; }
`
}

function hostCssText(compact: boolean, rail: boolean): string {
  if (rail) {
    return [
      'display:inline-flex',
      'align-items:center',
      'align-self:center',
      'flex:0 0 auto',
      'position:relative',
      'z-index:2',
      'margin:0',
      'padding:0',
      'max-height:16px',
      'height:16px',
      'line-height:16px',
      'vertical-align:middle',
      'text-decoration:none',
      'pointer-events:auto',
      `font-family:${X_FONT}`,
      'font-size:12px',
      'font-weight:700',
    ].join(';')
  }
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
      'text-decoration:none',
      'pointer-events:auto',
      `font-family:${X_FONT}`,
      'font-size:14px',
      'font-weight:700',
    ].join(';')
  }
  return (
    'display:inline-flex;align-items:center;align-self:center;position:relative;z-index:2;' +
    'text-decoration:none;pointer-events:auto;' +
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
  /** Narrow UserRail: 12px degree-only, does not grow the name row. */
  rail?: boolean
}): TrustScoreLabel {
  const rail = Boolean(options?.rail)
  const compact = Boolean(options?.compact) || rail
  const host = document.createElement('span')
  host.dataset.attentionxScore = 'true'
  host.className = 'hidden'
  host.style.cssText = hostCssText(compact, rail)
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>${scoreStyle(compact, rail)}</style>
    <button type="button" class="score" hidden title="${t('content.card.openPanel')}" aria-label="${t('content.card.openPanel')}"></button>
  `
  const score = root.querySelector('.score') as HTMLButtonElement
  let onOpenPath: (() => void) | undefined

  // Host-level capture: document hit-testing often lands on this span, not
  // the shadow button. Activate on pointerdown so X cannot swallow the click.
  let suppressClick = false
  let suppressTimer: ReturnType<typeof setTimeout> | undefined
  const onHostPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.stopImmediatePropagation()
    suppressClick = true
    if (suppressTimer !== undefined) clearTimeout(suppressTimer)
    suppressTimer = setTimeout(() => {
      suppressTimer = undefined
      suppressClick = false
    }, 400)
    onOpenPath?.()
  }
  const onHostClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    if (suppressClick) return
    onOpenPath?.()
  }
  host.addEventListener('pointerdown', onHostPointerDown, true)
  host.addEventListener('click', onHostClick, true)

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
        `${t('content.card.openPanel')}: ${text}`,
      )
    },
    setOnOpenPath(handler) {
      onOpenPath = handler
    },
    destroy() {
      if (suppressTimer !== undefined) clearTimeout(suppressTimer)
      host.removeEventListener('pointerdown', onHostPointerDown, true)
      host.removeEventListener('click', onHostClick, true)
      host.remove()
    },
  }
}
