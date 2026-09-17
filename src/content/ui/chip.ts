import { t } from '../i18n'
import type { TrustTone } from '../types'
import { brandChipIcon } from './icons'

/** Delay before swapping the brand mark for a spinner (avoids flash on fast trust). */
export const CHIP_LOADING_DELAY_MS = 160

function chipSpinnerIcon(size: number): string {
  return `<svg class="spinner" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2"
      stroke-dasharray="24" stroke-dashoffset="6" stroke-linecap="round"/>
  </svg>`
}

function chipStyle(buttonSize: number): string {
  return `
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
    width: ${buttonSize}px;
    height: ${buttonSize}px;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 5px;
    display: inline-grid;
    place-items: center;
    cursor: pointer;
    background: transparent;
    overflow: visible;
    position: relative;
    z-index: 1;
  }
  button:hover { transform: scale(1.06); }
  button:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 1px; }
  button svg { display: block; border-radius: 3px; pointer-events: none; }
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
}

export type TrustChipVariant = 'inline' | 'overlay'
export type TrustChipRole = 'author' | 'post'

export interface TrustChip {
  host: HTMLElement
  setTone(tone: TrustTone): void
  setLabel(label: string): void
  setLoading(loading: boolean): void
  destroy(): void
}

/** Neutral absolute host — callers set top/left/right/transform for placement. */
const OVERLAY_HOST_STYLE = [
  'display:inline-flex',
  'align-items:center',
  'justify-content:center',
  'line-height:1',
  'position:absolute',
  'z-index:7',
  'width:max-content',
  'max-width:max-content',
  'height:max-content',
  'max-height:max-content',
  'pointer-events:auto',
].join(';')

/** Default inline (profile / hovercard) — larger tap target. */
const INLINE_HOST_STYLE = [
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
  'margin:0',
  'vertical-align:middle',
  'pointer-events:auto',
].join(';')

/**
 * Timeline headline inline: fits inside X's ~20px name line (no vertical
 * margin, height capped) so insertBefore does not grow the cell.
 */
function compactInlineHostStyle(buttonSize: number): string {
  return [
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
    `width:${buttonSize}px`,
    `height:${buttonSize}px`,
    `max-width:${buttonSize}px`,
    `max-height:${buttonSize}px`,
    'margin:0',
    'margin-inline:3px',
    'padding:0',
    'vertical-align:middle',
    'pointer-events:auto',
  ].join(';')
}

/** Headline line-box budget on X (display name ~15px / 20px line-height). */
export const HEADLINE_CHIP_SIZE = 16

/**
 * AttentionX brand chip.
 * - `overlay`: absolute, does not affect flex/layout height (post action bar)
 * - `inline` + `compact`: timeline headline insert within line-height
 * - `inline` default: profile / hovercard
 */
export function createTrustChip(options: {
  title: string
  onClick: (anchor: HTMLElement) => void
  /** Absolute badge that does not affect flex/layout height. */
  variant?: TrustChipVariant
  /**
   * Timeline headline: 16×16 with zero vertical margin so the name row
   * line-box does not grow after insert.
   */
  compact?: boolean
  /** Distinguishes author vs post chip in the headline. */
  role?: TrustChipRole
}): TrustChip {
  const variant = options.variant ?? 'inline'
  const compact = Boolean(options.compact) && variant === 'inline'
  const role = options.role ?? 'author'
  const buttonSize =
    variant === 'overlay' ? 18 : compact ? HEADLINE_CHIP_SIZE : 28
  const iconSize = variant === 'overlay' || compact ? 14 : 16

  const host = document.createElement('span')
  host.dataset.attentionxChip = role
  host.style.cssText =
    variant === 'overlay'
      ? OVERLAY_HOST_STYLE
      : compact
        ? compactInlineHostStyle(buttonSize)
        : INLINE_HOST_STYLE

  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>${chipStyle(buttonSize)}</style>
    <button type="button" class="tone-neutral" title="${options.title}" aria-label="${options.title}">
      ${brandChipIcon('neutral', iconSize)}
    </button>
  `
  const button = root.querySelector('button') as HTMLButtonElement

  let currentTone: TrustTone = 'neutral'
  let currentLabel = options.title
  let loading = false
  /** True only after the delayed spinner paint actually ran. */
  let spinnerVisible = false
  let loadingTimer: ReturnType<typeof setTimeout> | undefined

  function paintIcon(): void {
    button.className = `tone-${currentTone}`
    button.innerHTML = brandChipIcon(currentTone, iconSize)
  }

  function paintSpinner(): void {
    button.className = 'tone-neutral is-loading'
    button.innerHTML = chipSpinnerIcon(iconSize)
    button.title = t('content.checking')
    button.setAttribute('aria-label', t('content.checking'))
    button.setAttribute('aria-busy', 'true')
  }

  function clearLoadingTimer(): void {
    if (loadingTimer === undefined) return
    clearTimeout(loadingTimer)
    loadingTimer = undefined
  }

  // Host-level capture: document.elementFromPoint often returns this span,
  // not the shadow button. Activate on pointerdown so X cannot swallow click.
  let suppressClick = false
  let suppressTimer: ReturnType<typeof setTimeout> | undefined
  const onHostPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.stopImmediatePropagation()
    if (loading) return
    suppressClick = true
    if (suppressTimer !== undefined) clearTimeout(suppressTimer)
    suppressTimer = setTimeout(() => {
      suppressTimer = undefined
      suppressClick = false
    }, 400)
    options.onClick(host)
  }
  const onHostClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    if (suppressClick) return
    if (loading) return
    options.onClick(host)
  }
  host.addEventListener('pointerdown', onHostPointerDown, true)
  host.addEventListener('click', onHostClick, true)

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
        // Keep the brand mark until the delay elapses — fast trust batches
        // resolve in ~40–100ms and would otherwise flash icon→spinner→icon.
        clearLoadingTimer()
        loadingTimer = setTimeout(() => {
          loadingTimer = undefined
          if (!loading) return
          spinnerVisible = true
          paintSpinner()
        }, CHIP_LOADING_DELAY_MS)
        return
      }
      clearLoadingTimer()
      if (spinnerVisible) {
        spinnerVisible = false
        button.removeAttribute('aria-busy')
      }
      paintIcon()
      button.title = currentLabel
      button.setAttribute('aria-label', currentLabel)
    },
    destroy() {
      clearLoadingTimer()
      if (suppressTimer !== undefined) clearTimeout(suppressTimer)
      host.removeEventListener('pointerdown', onHostPointerDown, true)
      host.removeEventListener('click', onHostClick, true)
      host.remove()
    },
  }
}
