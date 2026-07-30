import { t } from '../i18n'
import type { TrustTone } from '../types'
import { brandChipIcon } from './icons'

function chipSpinnerIcon(size = 16): string {
  return `<svg class="spinner" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2"
      stroke-dasharray="24" stroke-dashoffset="6" stroke-linecap="round"/>
  </svg>`
}

const CHIP_STYLE = `
  :host {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: center;
    line-height: 1;
    flex: 0 0 auto;
    width: max-content;
    max-width: max-content;
    height: max-content;
    max-height: max-content;
    vertical-align: middle;
  }
  button {
    box-sizing: border-box;
    width: 28px;
    height: 28px;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 6px;
    display: inline-grid;
    place-items: center;
    cursor: pointer;
    background: transparent;
    overflow: visible;
    position: relative;
    z-index: 1;
  }
  button:hover { transform: scale(1.08); }
  button:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 1px; }
  button svg { display: block; border-radius: 4px; pointer-events: none; }
  button.tone-neutral {
    color: rgb(83, 100, 113);
    opacity: .72;
  }
  @media (prefers-color-scheme: dark) {
    button.tone-neutral { color: rgb(113, 118, 123); }
  }
  button.tone-trust svg,
  button.tone-question svg,
  button.tone-misleading svg { opacity: 1; }
  button.is-loading {
    cursor: default;
    opacity: .72;
  }
  button.is-loading:hover { transform: none; }
  button.is-loading .spinner {
    display: block;
    animation: ax-chip-spin .75s linear infinite;
  }
  @keyframes ax-chip-spin { to { transform: rotate(360deg); } }
`

export interface TrustChip {
  host: HTMLElement
  setTone(tone: TrustTone): void
  setLabel(label: string): void
  setLoading(loading: boolean): void
  destroy(): void
}

/**
 * AttentionX brand chip on the author name row or post action bar.
 * Uses a small extension mark; tone recolors the tile.
 */
export function createTrustChip(options: {
  title: string
  onClick: (anchor: HTMLElement) => void
  /** Extra space before the next sibling (e.g. bookmark). */
  marginEnd?: number
}): TrustChip {
  const host = document.createElement('span')
  host.dataset.attentionxChip = 'true'
  const marginEnd = options.marginEnd ?? 0
  // Shrink-wrap to the button. X flex headers were stretching this span to
  // 100px+, so most clicks hit empty host area while the listener lived only
  // on the shadow button.
  host.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    'align-self:center',
    'line-height:1',
    'position:relative',
    'z-index:7',
    'flex:0 0 auto',
    'flex-grow:0',
    'flex-shrink:0',
    'width:max-content',
    'max-width:max-content',
    'height:max-content',
    'max-height:max-content',
    'vertical-align:middle',
    'pointer-events:auto',
    marginEnd > 0 ? `margin-right:${marginEnd}px` : '',
  ]
    .filter(Boolean)
    .join(';')

  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>${CHIP_STYLE}</style>
    <button type="button" class="tone-neutral" title="${options.title}" aria-label="${options.title}">
      ${brandChipIcon('neutral', 16)}
    </button>
  `
  const button = root.querySelector('button') as HTMLButtonElement

  let currentTone: TrustTone = 'neutral'
  let currentLabel = options.title
  let loading = false

  function paintIcon(): void {
    button.className = `tone-${currentTone}`
    button.innerHTML = brandChipIcon(currentTone, 16)
  }

  function activate(event: Event): void {
    event.preventDefault()
    event.stopPropagation()
    if (loading) return
    options.onClick(host)
  }

  // Host-level listeners: document.elementFromPoint often returns this span,
  // not the shadow button, so button-only handlers miss clicks.
  const onHostPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.stopPropagation()
  }
  const onHostClick = (event: MouseEvent) => {
    activate(event)
  }
  host.addEventListener('pointerdown', onHostPointerDown)
  host.addEventListener('click', onHostClick)

  return {
    host,
    setTone(tone) {
      currentTone = tone
      if (loading) return
      paintIcon()
    },
    setLabel(label) {
      currentLabel = label
      if (loading) return
      button.title = label
      button.setAttribute('aria-label', label)
    },
    setLoading(next) {
      if (loading === next) return
      loading = next
      if (next) {
        button.className = 'tone-neutral is-loading'
        button.innerHTML = chipSpinnerIcon(16)
        button.title = t('content.checking')
        button.setAttribute('aria-label', t('content.checking'))
        button.setAttribute('aria-busy', 'true')
        return
      }
      button.removeAttribute('aria-busy')
      paintIcon()
      button.title = currentLabel
      button.setAttribute('aria-label', currentLabel)
    },
    destroy() {
      host.removeEventListener('pointerdown', onHostPointerDown)
      host.removeEventListener('click', onHostClick)
      host.remove()
    },
  }
}
