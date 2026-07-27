import { TONE_COLORS } from './signals'
import type { TrustTone } from '../types'

/** X.com-like type stack for injected UI. */
export const X_FONT =
  'TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

const STROKE = `fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`

let preferActionIcons = true

/** Content-script preference for icon+text vs text-only trust buttons. */
export function setActionIconsEnabled(enabled: boolean): void {
  preferActionIcons = enabled
}

export function actionIconsEnabled(): boolean {
  return preferActionIcons
}

/** Compact stroke icons for Trust / Distrust / Cancel actions. */
export function actionIcon(
  kind: 'trust' | 'distrust' | 'cancel',
  size = 16,
): string {
  const paths =
    kind === 'trust'
      ? `<path d="M12 3 5 6v5c0 4.4 2.9 7.6 7 10 4.1-2.4 7-5.6 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>`
      : kind === 'distrust'
        ? `<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5"/><path d="M12 17h.01"/>`
        : `<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>`

  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" ${STROKE}>${paths}</svg>`
}

/**
 * Small AttentionX brand mark for chips. Neutral uses the teal tile; tone
 * variants recolor the tile so the verdict reads at a glance.
 */
export function brandChipIcon(tone: TrustTone = 'neutral', size = 16): string {
  const tile =
    tone === 'trust'
      ? TONE_COLORS.trust
      : tone === 'question'
        ? TONE_COLORS.question
        : tone === 'misleading'
          ? TONE_COLORS.misleading
          : '#0d9488'

  return `<svg viewBox="0 0 128 128" width="${size}" height="${size}" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <rect width="128" height="128" rx="28" fill="${tile}"/>
    <circle cx="64" cy="64" r="38" fill="none" stroke="#ffffff" stroke-width="7" opacity="0.28"/>
    <circle cx="64" cy="64" r="24" fill="none" stroke="#ffffff" stroke-width="8"/>
    <circle cx="64" cy="64" r="11" fill="#ffffff"/>
  </svg>`
}

export interface ActionButtonLabels {
  trust: string
  distrust: string
  cancel: string
}

/** Markup for Trust / Distrust / Cancel — icon+text or text-only. */
export function trustActionButtonsHtml(
  labels: ActionButtonLabels,
  icons = preferActionIcons,
): string {
  const modeClass = icons ? ' with-icons' : ' text'
  const inner = (kind: 'trust' | 'distrust' | 'cancel', label: string) =>
    icons ? `${actionIcon(kind)}<span>${label}</span>` : label
  return `
    <div class="ax-actions${modeClass}">
      <button type="button" class="trust" data-verdict="trust" title="${labels.trust}" aria-label="${labels.trust}">${inner('trust', labels.trust)}</button>
      <button type="button" class="distrust" data-verdict="misleading" title="${labels.distrust}" aria-label="${labels.distrust}">${inner('distrust', labels.distrust)}</button>
      <button type="button" class="cancel" data-action="cancel" title="${labels.cancel}" aria-label="${labels.cancel}">${inner('cancel', labels.cancel)}</button>
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
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  ${s}.ax-actions button {
    margin: 0;
    box-sizing: border-box;
    min-height: 32px;
    padding: 0 16px;
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
  ${s}.ax-actions button.cancel {
    color: inherit;
    border-color: color-mix(in srgb, currentColor 50%, transparent);
    opacity: .85;
  }
  ${s}.ax-actions button.cancel:hover:not(:disabled) { opacity: 1; }
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
`
}
