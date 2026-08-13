import { t } from '../i18n'
import { starFillFromAverage } from '../rating-summary'
import { CHIP_LOADING_DELAY_MS } from './chip'
import { ratingStarIcon, X_FONT } from './icons'
import { TONE_COLORS } from './signals'

function starSpinnerIcon(size: number): string {
  return `<svg class="spinner" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2"
      stroke-dasharray="24" stroke-dashoffset="6" stroke-linecap="round"/>
  </svg>`
}

function starStyle(): string {
  return `
  :host {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    flex: 0 0 auto;
    width: max-content;
    height: max-content;
    vertical-align: middle;
  }
  button {
    box-sizing: border-box;
    margin: 0;
    padding: 0 2px;
    border: 0;
    border-radius: 5px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 18px;
    cursor: pointer;
    background: transparent;
    color: rgb(83, 100, 113);
    opacity: .84;
    font-family: ${X_FONT};
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    overflow: visible;
    position: relative;
    z-index: 1;
  }
  button:hover { transform: scale(1.06); }
  button:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 1px; }
  button svg { display: block; pointer-events: none; }
  button.has-score {
    opacity: 1;
    color: ${TONE_COLORS.question};
  }
  button.is-loading {
    cursor: default;
    opacity: .72;
  }
  button.is-loading:hover { transform: none; }
  button.is-loading .spinner {
    display: block;
    animation: ax-star-spin .75s linear infinite;
  }
  @keyframes ax-star-spin { to { transform: rotate(360deg); } }
  .score {
    min-width: 1.25em;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  @media (prefers-color-scheme: dark) {
    button { color: rgb(113, 118, 123); }
    button.has-score { color: ${TONE_COLORS.question}; }
  }
`
}

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

export interface RatingStar {
  host: HTMLElement
  setScore(averageScore: number | null): void
  setLabel(label: string): void
  setLoading(loading: boolean): void
  destroy(): void
}

export function createRatingStar(options: {
  title: string
  onClick: (anchor: HTMLElement) => void
}): RatingStar {
  const host = document.createElement('span')
  host.dataset.attentionxChip = 'post'
  host.dataset.attentionxStar = 'true'
  host.style.cssText = OVERLAY_HOST_STYLE

  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>${starStyle()}</style>
    <button type="button" title="${options.title}" aria-label="${options.title}">
      ${ratingStarIcon('none', 14)}
    </button>
  `
  const button = root.querySelector('button') as HTMLButtonElement

  let currentScore: number | null = null
  let currentLabel = options.title
  let loading = false
  let spinnerVisible = false
  let loadingTimer: ReturnType<typeof setTimeout> | undefined

  function paintStar(): void {
    const score = currentScore
    button.classList.toggle('has-score', score !== null)
    if (score === null) {
      button.innerHTML = ratingStarIcon('none', 14)
      return
    }
    button.innerHTML = `<span class="score">${Math.round(score)}</span>${ratingStarIcon(starFillFromAverage(score), 14)}`
  }

  function paintSpinner(): void {
    button.className = 'is-loading'
    button.innerHTML = starSpinnerIcon(14)
    button.title = t('content.checking')
    button.setAttribute('aria-label', t('content.checking'))
    button.setAttribute('aria-busy', 'true')
  }

  function clearLoadingTimer(): void {
    if (loadingTimer === undefined) return
    clearTimeout(loadingTimer)
    loadingTimer = undefined
  }

  function activate(event: Event): void {
    event.preventDefault()
    event.stopPropagation()
    if (loading) return
    options.onClick(host)
  }

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
    setScore(averageScore) {
      currentScore = averageScore
      if (loading) return
      paintStar()
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
      button.className = currentScore !== null ? 'has-score' : ''
      paintStar()
      button.title = currentLabel
      button.setAttribute('aria-label', currentLabel)
    },
    destroy() {
      clearLoadingTimer()
      host.removeEventListener('pointerdown', onHostPointerDown)
      host.removeEventListener('click', onHostClick)
      host.remove()
    },
  }
}
