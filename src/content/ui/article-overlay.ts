/**
 * Zero-reflow article overlay: gutter (patterned bar + hit strip) and selected
 * ticks. Does not mutate X node `style`. The post star is an action-bar flex
 * slot, not parked here. Score + chip stay in the User-Name flex row.
 */

import { t } from '../i18n'
import type { TrustTone } from '../types'
import { TONE_COLORS } from './signals'

export const OVERLAY_ATTR = 'data-attentionx-overlay'
export const GUTTER_ATTR = 'data-attentionx-gutter'
export const OVERLAY_STYLE_ID = 'attentionx-overlay'
export const POST_SELECTED_ATTR = 'data-attentionx-post-selected'

const OVERLAY_STYLE_TEXT = `
article:has(> [${OVERLAY_ATTR}]) {
  position: relative;
}
[${OVERLAY_ATTR}] {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 7;
  overflow: visible;
}
article[${POST_SELECTED_ATTR}] > [${OVERLAY_ATTR}] {
  background-image:
    linear-gradient(currentColor, currentColor),
    linear-gradient(currentColor, currentColor),
    linear-gradient(currentColor, currentColor),
    linear-gradient(currentColor, currentColor),
    linear-gradient(currentColor, currentColor),
    linear-gradient(currentColor, currentColor),
    linear-gradient(currentColor, currentColor),
    linear-gradient(currentColor, currentColor);
  background-size:
    10px 2px, 2px 10px,
    10px 2px, 2px 10px,
    10px 2px, 2px 10px,
    10px 2px, 2px 10px;
  background-position:
    4px 4px, 4px 4px,
    calc(100% - 4px) 4px, calc(100% - 4px) 4px,
    4px calc(100% - 4px), 4px calc(100% - 12px),
    calc(100% - 4px) calc(100% - 4px), calc(100% - 4px) calc(100% - 12px);
  background-repeat: no-repeat;
  color: rgb(83, 100, 113);
}
@media (prefers-color-scheme: dark) {
  article[${POST_SELECTED_ATTR}] > [${OVERLAY_ATTR}] {
    color: rgb(113, 118, 123);
  }
}
`

const GUTTER_HOST_STYLE = [
  'display:block',
  'position:absolute',
  'left:0',
  'top:0',
  'bottom:0',
  'width:12px',
  'z-index:8',
  'pointer-events:auto',
  'margin:0',
  'padding:0',
].join(';')

const OVERLAY_HOST_STYLE = [
  'position:absolute',
  'inset:0',
  'pointer-events:none',
  'z-index:7',
  'overflow:visible',
  'display:block',
  'margin:0',
  'padding:0',
].join(';')

function gutterStyle(): string {
  return `
  :host { display: block; width: 12px; height: 100%; }
  button {
    box-sizing: border-box;
    position: relative;
    width: 12px;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    color: inherit;
  }
  button:focus-visible { outline: 2px solid #1d9bf0; outline-offset: -2px; }
  .bar {
    position: absolute;
    left: 0;
    top: 8px;
    bottom: 8px;
    width: 3px;
    border-radius: 1px;
    pointer-events: none;
  }
  button.tone-neutral .bar { display: none; }
  button.tone-trust .bar { background: ${TONE_COLORS.trust}; }
  button.tone-question .bar {
    width: 3px;
    background: repeating-linear-gradient(
      to bottom,
      ${TONE_COLORS.question} 0 5px,
      transparent 5px 9px
    );
  }
  button.tone-misleading .bar {
    width: 5px;
    background: linear-gradient(
      to right,
      ${TONE_COLORS.misleading} 0 2px,
      transparent 2px 3px,
      ${TONE_COLORS.misleading} 3px 5px
    );
  }
  button:hover .bar { filter: brightness(1.15); }
  button.tone-trust:hover .bar { width: 4px; }
  button.tone-question:hover .bar { width: 4px; }
  button.tone-misleading:hover .bar { width: 6px; }
  button.is-selected { cursor: default; }
`
}

export function ensureOverlayStylesheet(): void {
  if (document.getElementById(OVERLAY_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = OVERLAY_STYLE_ID
  style.textContent = OVERLAY_STYLE_TEXT
  ;(document.head ?? document.documentElement).append(style)
}

export function removeOverlayStylesheet(): void {
  document.getElementById(OVERLAY_STYLE_ID)?.remove()
}

/** Last-child overlay host. Out of flow — does not change article box size. */
export function ensureArticleOverlay(article: HTMLElement): HTMLElement {
  ensureOverlayStylesheet()
  let overlay = article.querySelector<HTMLElement>(`:scope > [${OVERLAY_ATTR}]`)
  if (!overlay) {
    overlay = document.createElement('span')
    overlay.setAttribute(OVERLAY_ATTR, 'true')
    overlay.style.cssText = OVERLAY_HOST_STYLE
  }
  if (article.lastElementChild !== overlay) {
    article.append(overlay)
  }
  return overlay
}

export interface GutterControl {
  host: HTMLElement
  setTone(tone: TrustTone): void
  setSelected(selected: boolean): void
  destroy(): void
}

export function createGutterControl(options: {
  onClick: () => void
}): GutterControl {
  const host = document.createElement('span')
  host.setAttribute(GUTTER_ATTR, 'true')
  host.style.cssText = GUTTER_HOST_STYLE
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>${gutterStyle()}</style>
    <button type="button" class="gutter tone-neutral" title="${t('content.gutter.openPost')}" aria-label="${t('content.gutter.openPost')}" aria-pressed="false">
      <span class="bar"></span>
    </button>
  `
  const button = root.querySelector('button') as HTMLButtonElement
  let currentTone: TrustTone = 'neutral'
  let selected = false

  function paint(): void {
    const classes = [`gutter`, `tone-${currentTone}`]
    if (selected) classes.push('is-selected')
    button.className = classes.join(' ')
    button.setAttribute('aria-pressed', String(selected))
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.stopPropagation()
  }
  const onClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    options.onClick()
  }
  host.addEventListener('pointerdown', onPointerDown)
  host.addEventListener('click', onClick)

  return {
    host,
    setTone(tone) {
      currentTone = tone
      paint()
    },
    setSelected(next) {
      selected = next
      paint()
    },
    destroy() {
      host.removeEventListener('pointerdown', onPointerDown)
      host.removeEventListener('click', onClick)
      host.remove()
    },
  }
}

let selectedArticle: HTMLElement | undefined

export function selectArticlePost(article: HTMLElement): void {
  if (selectedArticle && selectedArticle !== article) {
    delete selectedArticle.dataset.attentionxPostSelected
  }
  selectedArticle = article
  article.dataset.attentionxPostSelected = 'true'
}

export function clearArticlePostSelection(article: HTMLElement): void {
  if (article.dataset.attentionxPostSelected !== undefined) {
    delete article.dataset.attentionxPostSelected
  }
  if (selectedArticle === article) selectedArticle = undefined
}

