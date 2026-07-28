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

  let currentTone: TrustTone = 'neutral'
  let currentLabel = options.title
  let loading = false

  function paintIcon(): void {
    button.className = `tone-${currentTone}`
    button.innerHTML = brandChipIcon(currentTone, 16)
  }

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
      host.remove()
    },
  }
}
