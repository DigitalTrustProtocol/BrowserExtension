import { t } from '../i18n'
import { starFillFromAverage } from '../rating-summary'
import type { TrustTone } from '../types'
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
    display: flex;
    align-items: center;
    align-self: center;
    justify-content: flex-start;
    line-height: 1;
    flex: 1 1 0%;
    min-width: 0;
    min-height: 0;
    width: auto;
    height: auto;
    max-height: 100%;
    margin: 0;
    padding: 0;
  }
  button {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    width: 20px;
    height: 20px;
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
  .controls {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  button svg { display: block; pointer-events: none; }
  button.star.has-score,
  button.score {
    opacity: 1;
  }
  button.score {
    width: auto;
    min-width: 0;
    height: 20px;
    padding: 0 2px 0 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  button.score[hidden] { display: none; }
  button.tone-trust { color: ${TONE_COLORS.trust}; }
  button.tone-question { color: ${TONE_COLORS.question}; }
  button.tone-misleading { color: ${TONE_COLORS.misleading}; }
  button.is-confirm {
    animation: ax-star-confirm .9s ease-out;
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
  @keyframes ax-star-confirm {
    0%, 100% { transform: scale(1); filter: brightness(1); }
    18% { transform: scale(1.45); filter: brightness(1.55); }
    36% { transform: scale(1); filter: brightness(1); }
    54% { transform: scale(1.28); filter: brightness(1.4); }
    72% { transform: scale(1); filter: brightness(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    button.is-confirm {
      animation: ax-star-confirm-reduced .35s ease-out;
    }
    @keyframes ax-star-confirm-reduced {
      0%, 100% { opacity: 1; }
      50% { opacity: .4; }
    }
  }
  @media (prefers-color-scheme: dark) {
    button.tone-neutral { color: rgb(113, 118, 123); }
  }
`
}

/** Same flex share as Reply / Repost / Like / Views. Icon stays at the start, so free space sits before Bookmark. Height stays the icon line. */
const ACTION_HOST_STYLE = [
  'display:flex',
  'flex:1 1 0%',
  'align-items:center',
  'align-self:center',
  'justify-content:flex-start',
  'min-width:0',
  'min-height:0',
  'height:auto',
  'max-height:100%',
  'margin:0',
  'padding:0',
  'line-height:1',
  'position:relative',
  'z-index:7',
  'pointer-events:auto',
].join(';')

export interface RatingStar {
  host: HTMLElement
  setScore(averageScore: number | null): void
  setTone(tone: TrustTone): void
  setLabel(label: string): void
  /** `busyLabel` replaces the default "Checking…" title while loading. */
  setLoading(loading: boolean, busyLabel?: string): void
  flashConfirm(): void
  destroy(): void
}

export function createRatingStar(options: {
  title: string
  onClick: (anchor: HTMLElement) => void
  /** Number beside the star. Opens the post panel; the glyph keeps `onClick`. */
  onScoreClick?: () => void
}): RatingStar {
  const host = document.createElement('span')
  host.dataset.attentionxChip = 'post'
  host.dataset.attentionxStar = 'true'
  host.style.cssText = ACTION_HOST_STYLE

  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>${starStyle()}</style>
    <span class="controls">
      <button type="button" class="score" hidden></button>
      <button type="button" class="star" title="${options.title}" aria-label="${options.title}">
        ${ratingStarIcon('none', 19)}
      </button>
    </span>
  `
  const scoreButton = root.querySelector('button.score') as HTMLButtonElement
  const button = root.querySelector('button.star') as HTMLButtonElement

  let currentScore: number | null = null
  let currentTone: TrustTone = 'neutral'
  let currentLabel = options.title
  let loading = false
  let busyLabel: string | undefined
  let spinnerVisible = false
  let confirming = false
  let loadingTimer: ReturnType<typeof setTimeout> | undefined
  let confirmTimer: ReturnType<typeof setTimeout> | undefined

  function paintScoreLabel(): void {
    if (currentScore === null) {
      scoreButton.hidden = true
      scoreButton.textContent = ''
      scoreButton.removeAttribute('aria-label')
      return
    }
    const rounded = String(Math.round(currentScore))
    scoreButton.hidden = false
    scoreButton.textContent = rounded
    scoreButton.setAttribute(
      'aria-label',
      `${t('content.card.openPanel')}: ${rounded}`,
    )
  }

  function paintButtonClasses(): void {
    const tone = `tone-${currentTone}`
    const classes = ['star', tone]
    if (currentScore !== null) classes.push('has-score')
    if (confirming) classes.push('is-confirm')
    button.className = classes.join(' ')
    scoreButton.className = `score ${tone}`
  }

  function paintStar(): void {
    const score = currentScore
    paintButtonClasses()
    paintScoreLabel()
    button.innerHTML =
      score === null
        ? ratingStarIcon('none', 19)
        : ratingStarIcon(starFillFromAverage(score), 19)
  }

  function clearConfirmTimer(): void {
    if (confirmTimer === undefined) return
    clearTimeout(confirmTimer)
    confirmTimer = undefined
  }

  function paintSpinner(): void {
    const label = busyLabel ?? t('content.checking')
    scoreButton.hidden = true
    button.className = 'star is-loading'
    button.innerHTML = starSpinnerIcon(19)
    button.title = label
    button.setAttribute('aria-label', label)
    button.setAttribute('aria-busy', 'true')
  }

  function clearLoadingTimer(): void {
    if (loadingTimer === undefined) return
    clearTimeout(loadingTimer)
    loadingTimer = undefined
  }

  function scoreClicked(event: Event): boolean {
    return event.composedPath().some(
      (node) => node instanceof Element && node.classList.contains('score'),
    )
  }

  function activate(event: Event): void {
    event.preventDefault()
    event.stopPropagation()
    if (loading) return
    if (scoreClicked(event)) {
      options.onScoreClick?.()
      return
    }
    options.onClick(host)
  }

  const onHostPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.stopPropagation()
  }
  // Inside the shadow, composedPath still names the score button. Clicks that
  // land on the host itself (X hit-testing) keep the glyph action.
  const onHostClick = (event: MouseEvent) => {
    if (event.target !== host) return
    activate(event)
  }
  root.addEventListener('click', activate)
  host.addEventListener('pointerdown', onHostPointerDown)
  host.addEventListener('click', onHostClick)

  return {
    host,
    setScore(averageScore) {
      currentScore = averageScore
      if (loading) return
      paintStar()
    },
    setTone(tone) {
      currentTone = tone
      if (loading) return
      paintButtonClasses()
    },
    setLabel(label) {
      currentLabel = label
      if (loading) return
      button.title = label
      button.setAttribute('aria-label', label)
    },
    setLoading(next, nextBusyLabel) {
      if (loading === next) {
        if (next && busyLabel !== nextBusyLabel) {
          busyLabel = nextBusyLabel
          if (spinnerVisible) paintSpinner()
        }
        return
      }
      loading = next
      busyLabel = next ? nextBusyLabel : undefined
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
      paintStar()
      button.title = currentLabel
      button.setAttribute('aria-label', currentLabel)
    },
    flashConfirm() {
      if (!host.isConnected || loading) return
      confirming = false
      button.classList.remove('is-confirm')
      void button.offsetWidth
      confirming = true
      paintStar()
      const onEnd = () => {
        confirming = false
        button.classList.remove('is-confirm')
        clearConfirmTimer()
      }
      button.addEventListener('animationend', onEnd, { once: true })
      clearConfirmTimer()
      confirmTimer = setTimeout(onEnd, 1000)
    },
    destroy() {
      clearLoadingTimer()
      clearConfirmTimer()
      root.removeEventListener('click', activate)
      host.removeEventListener('pointerdown', onHostPointerDown)
      host.removeEventListener('click', onHostClick)
      host.remove()
    },
  }
}
