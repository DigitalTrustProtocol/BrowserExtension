import type { TrustTone } from '../types'
import { TONE_COLORS } from './signals'

const CHIP_STYLE = `
  :host { display: inline-flex; align-items: center; line-height: 1; }
  button {
    width: 16px;
    height: 16px;
    margin: 0 0 0 4px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    display: inline-grid;
    place-items: center;
    cursor: pointer;
    background: transparent;
    color: CanvasText;
  }
  button:hover .dot { transform: scale(1.25); }
  button:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 1px; }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
    opacity: .38;
    transition: transform .1s ease;
  }
  button.tone-trust { color: ${TONE_COLORS.trust}; }
  button.tone-question { color: ${TONE_COLORS.question}; }
  button.tone-misleading { color: ${TONE_COLORS.misleading}; }
  button.tone-trust .dot,
  button.tone-question .dot,
  button.tone-misleading .dot { opacity: 1; }
`

export interface TrustChip {
  host: HTMLElement
  setTone(tone: TrustTone): void
  destroy(): void
}

/**
 * A dot-sized button that sits on the author name row or the action bar.
 * Sized to the line box so it never reflows X's layout.
 */
export function createTrustChip(options: {
  title: string
  onClick: (anchor: HTMLElement) => void
}): TrustChip {
  const host = document.createElement('span')
  host.dataset.attentionxChip = 'true'
  host.style.cssText = 'display:inline-flex;align-items:center;line-height:1;'
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>${CHIP_STYLE}</style>
    <button type="button" class="tone-neutral" title="${options.title}" aria-label="${options.title}">
      <span class="dot"></span>
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
    },
    destroy() {
      host.remove()
    },
  }
}
