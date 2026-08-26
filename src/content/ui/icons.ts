import type { StarFill } from '../rating-summary'
import { TONE_COLORS } from './signals'
import type { TrustTone } from '../types'

/** X.com Chirp stack (matches timeline UI typography). */
export const X_FONT =
  'Chirp, TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

const STROKE = `fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`

let preferActionIcons = true

/** Content-script preference for icon+text vs text-only trust buttons. */
export function setActionIconsEnabled(enabled: boolean): void {
  preferActionIcons = enabled
}

export function actionIconsEnabled(): boolean {
  return preferActionIcons
}

/** Compact stroke icons for Trust / Distrust / Neutral / retract actions. */
export function actionIcon(
  kind: 'trust' | 'distrust' | 'neutral' | 'delete',
  size = 16,
): string {
  const paths =
    kind === 'trust'
      ? `<path d="M12 3 5 6v5c0 4.4 2.9 7.6 7 10 4.1-2.4 7-5.6 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>`
      : kind === 'distrust'
        ? `<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5"/><path d="M12 17h.01"/>`
        : kind === 'neutral'
          ? `<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>`
          : `<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>`

  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" ${STROKE}>${paths}</svg>`
}

/** Header glyph: person for author trust, text lines for post trust. */
export function cardVariantIcon(
  variant: 'author' | 'post',
  size = 18,
): string {
  const paths =
    variant === 'author'
      ? `<circle cx="12" cy="8" r="3.5"/><path d="M5.5 19.5c1.2-3.2 3.5-4.8 6.5-4.8s5.3 1.6 6.5 4.8"/>`
      : `<path d="M5 7h14"/><path d="M5 12h14"/><path d="M5 17h10"/>`

  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" ${STROKE}>${paths}</svg>`
}

/**
 * Small AttentionX brand mark for chips. Neutral uses concentric circles;
 * trust / mixed / distrust swap the inner glyph so tone is readable without color.
 */
export function brandChipIcon(tone: TrustTone = 'neutral', size = 16): string {
  const tile =
    tone === 'trust'
      ? TONE_COLORS.trust
      : tone === 'question'
        ? TONE_COLORS.question
        : tone === 'misleading'
          ? TONE_COLORS.misleading
          : 'currentColor'

  const inner = chipInnerMark(tone)

  return `<svg viewBox="0 0 128 128" width="${size}" height="${size}" aria-hidden="true" data-tone="${tone}" xmlns="http://www.w3.org/2000/svg">
    <rect width="128" height="128" rx="28" fill="${tile}"/>
    ${inner}
  </svg>`
}

function chipInnerMark(tone: TrustTone): string {
  switch (tone) {
    case 'trust':
      return `<path d="M36 66l18 18 38-38" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`
    case 'question':
      return `<path d="M40 72q24-32 48 0" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round"/>`
    case 'misleading':
      return `<path d="M64 36v40" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round"/><circle cx="64" cy="94" r="7" fill="#ffffff"/>`
    case 'neutral':
      return `<circle cx="64" cy="64" r="38" fill="none" stroke="#ffffff" stroke-width="7" opacity="0.28"/>
    <circle cx="64" cy="64" r="24" fill="none" stroke="#ffffff" stroke-width="8"/>
    <circle cx="64" cy="64" r="11" fill="#ffffff"/>`
    default: {
      const _exhaustive: never = tone
      return _exhaustive
    }
  }
}

/** Network / graph glyph for opening the Application Graph page. */
export function graphLinkIcon(size = 16): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" ${STROKE}>
    <circle cx="6" cy="7" r="2.2"/>
    <circle cx="18" cy="7" r="2.2"/>
    <circle cx="12" cy="17" r="2.2"/>
    <path d="M8 8.2 10.4 15"/>
    <path d="M16 8.2 13.6 15"/>
    <path d="M8.2 7h7.6"/>
  </svg>`
}

const STAR_PATH =
  'M12 3.2 14.7 8.7l6.1.9-4.4 4.3 1 6.1L12 16.9 6.6 20l1-6.1L3.2 9.6l6.1-.9Z'

/** Outline star with none / left-half / full fill. */
export function ratingStarIcon(fill: StarFill, size = 16): string {
  const outline = `<path d="${STAR_PATH}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`
  switch (fill) {
    case 'none':
      return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${outline}</svg>`
    case 'full':
      return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${outline}<path d="${STAR_PATH}" fill="currentColor"/></svg>`
    case 'half':
      return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">
    <defs>
      <clipPath id="ax-star-half">
        <rect x="0" y="0" width="12" height="24"/>
      </clipPath>
    </defs>
    ${outline}
    <path d="${STAR_PATH}" fill="currentColor" clip-path="url(#ax-star-half)"/>
  </svg>`
    default: {
      const _exhaustive: never = fill
      return _exhaustive
    }
  }
}

/** Side-panel glyph for opening Notes. */
export function notesPanelIcon(size = 16): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" ${STROKE}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2"/>
    <path d="M10 4.5v15"/>
  </svg>`
}

/** Linear path glyph for opening trust path mode. */
export function pathLinkIcon(size = 16): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" ${STROKE}>
    <circle cx="5" cy="12" r="2.2"/>
    <circle cx="12" cy="6" r="2.2"/>
    <circle cx="19" cy="12" r="2.2"/>
    <path d="M6.8 10.6 10.2 7.4"/>
    <path d="M13.8 7.4 17.2 10.6"/>
  </svg>`
}

export interface ActionButtonLabels {
  trust: string
  distrust: string
  neutral: string
  delete: string
  trustHint: string
  distrustHint: string
  neutralHint: string
}

function attr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
}

/** Markup for Trust / Neutral / Distrust plus a centered retract control. */
export function trustActionButtonsHtml(
  labels: ActionButtonLabels,
  icons = preferActionIcons,
): string {
  const modeClass = icons ? ' with-icons' : ' text'
  const inner = (
    kind: 'trust' | 'distrust' | 'neutral' | 'delete',
    label: string,
  ) => (icons ? `${actionIcon(kind)}<span>${label}</span>` : label)
  return `
    <div class="ax-actions${modeClass}">
      <div class="ax-actions-row">
        <button type="button" class="trust" data-verdict="trust" title="${attr(labels.trustHint)}" aria-label="${attr(labels.trust)}">${inner('trust', labels.trust)}</button>
        <button type="button" class="neutral" data-verdict="neutral" title="${attr(labels.neutralHint)}" aria-label="${attr(labels.neutral)}">${inner('neutral', labels.neutral)}</button>
        <button type="button" class="distrust" data-verdict="misleading" title="${attr(labels.distrustHint)}" aria-label="${attr(labels.distrust)}">${inner('distrust', labels.distrust)}</button>
      </div>
      <button type="button" class="delete" data-action="delete" title="${attr(labels.delete)}" aria-label="${attr(labels.delete)}">${inner('delete', labels.delete)}</button>
    </div>
  `
}

/**
 * Shared CSS for outlined action buttons (X Follow-style pill outline).
 * `.with-icons` = icon + label; `.text` = label only.
 */
export function actionButtonCss(scope = ''): string {
  const s = scope ? `${scope} ` : ''
  return `
  ${s}.ax-actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: stretch;
    width: 100%;
  }
  ${s}.ax-actions-row {
    display: flex;
    flex-wrap: nowrap;
    gap: 10px;
    align-items: stretch;
    width: 100%;
  }
  ${s}.ax-actions button {
    margin: 0;
    box-sizing: border-box;
    min-height: 36px;
    padding: 0 10px;
    border: 1px solid color-mix(in srgb, currentColor 50%, transparent);
    border-radius: 9999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    cursor: pointer;
    background: transparent;
    color: inherit;
    opacity: 1;
    transition: background .1s ease, border-color .1s ease, opacity .1s ease;
    font-family: inherit;
    font-size: 14px;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
  }
  ${s}.ax-actions-row button {
    flex: 1 1 0;
    min-width: 0;
  }
  ${s}.ax-actions button:hover:not(:disabled) {
    background: color-mix(in srgb, currentColor 10%, transparent);
  }
  ${s}.ax-actions button:focus-visible {
    outline: 2px solid #1d9bf0;
    outline-offset: 1px;
  }
  ${s}.ax-actions button.trust {
    color: ${TONE_COLORS.trust};
    border-color: color-mix(in srgb, ${TONE_COLORS.trust} 55%, transparent);
  }
  ${s}.ax-actions button.distrust {
    color: ${TONE_COLORS.misleading};
    border-color: color-mix(in srgb, ${TONE_COLORS.misleading} 55%, transparent);
  }
  ${s}.ax-actions button.neutral {
    color: inherit;
    border-color: color-mix(in srgb, currentColor 50%, transparent);
    opacity: .85;
  }
  ${s}.ax-actions button.neutral:hover:not(:disabled) { opacity: 1; }
  ${s}.ax-actions button.delete {
    align-self: center;
    margin: 0;
    color: #dc2626;
    border-color: transparent;
    background: transparent;
    padding: 0 16px;
    opacity: 1;
  }
  ${s}.ax-actions button.delete:hover:not(:disabled) {
    background: color-mix(in srgb, #dc2626 12%, transparent);
  }
  ${s}.ax-actions button:disabled {
    opacity: .4;
    cursor: not-allowed;
  }
  ${s}.ax-actions button[aria-pressed="true"] {
    background: color-mix(in srgb, currentColor 14%, transparent);
    border-color: currentColor;
  }
  ${s}.ax-actions svg { display: block; flex-shrink: 0; }
  ${s}.ax-actions span { display: inline; }
  ${s}.ax-actions button[hidden] { display: none; }
`
}
