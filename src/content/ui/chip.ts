import type { TrustTone } from '../types'
import { brandChipIcon } from './icons'

const CHIP_STYLE = `
  :host { display: inline-flex; align-items: center; line-height: 1; }
  button {
    width: 18px;
    height: 18px;
    margin: 0 0 0 4px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    display: inline-grid;
    place-items: center;
    cursor: pointer;
    background: transparent;
    overflow: visible;
  }
  button:hover { transform: scale(1.08); }
  button:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 1px; }
  button svg { display: block; border-radius: 4px; }
  button.tone-neutral svg { opacity: .72; }
  button.tone-trust svg,
  button.tone-question svg,
  button.tone-misleading svg { opacity: 1; }
`

export interface TrustChip {
  host: HTMLElement
  setTone(tone: TrustTone): void
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
  host.style.cssText = `display:inline-flex;align-items:center;line-height:1;${
    marginEnd > 0 ? `margin-right:${marginEnd}px;` : ''
  }`
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>${CHIP_STYLE}</style>
    <button type="button" class="tone-neutral" title="${options.title}" aria-label="${options.title}">
      ${brandChipIcon('neutral', 16)}
    </button>
  `
  const button = root.querySelector('button') as HTMLButtonElement
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    options.onClick(host)
  })

  return {
    host,
    setTone(tone) {
      button.className = `tone-${tone}`
      button.innerHTML = brandChipIcon(tone, 16)
    },
    destroy() {
      host.remove()
    },
  }
}
