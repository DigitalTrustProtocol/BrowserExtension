/**
 * Match AttentionX overlay chrome to X's theme — not the OS preference.
 * X sets `color-scheme` / `data-theme` on <html> independently of
 * prefers-color-scheme, so Canvas-based Shadow DOM would otherwise paint light.
 */

export type PageColorScheme = 'light' | 'dark'

function luminanceFromCssColor(color: string): number | undefined {
  const match = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i)
  if (!match) return undefined
  const r = Number(match[1]) / 255
  const g = Number(match[2]) / 255
  const b = Number(match[3]) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Read the theme X is actually rendering. */
export function readPageColorScheme(
  doc: Document = document,
): PageColorScheme {
  const html = doc.documentElement
  const attr =
    html.getAttribute('data-theme') ??
    html.getAttribute('data-color-mode') ??
    html.getAttribute('data-bs-theme')
  if (attr === 'dark' || attr === 'light') return attr

  const scheme = (
    html.style.colorScheme ||
    getComputedStyle(html).colorScheme ||
    ''
  ).toLowerCase()
  if (scheme.includes('dark') && !scheme.includes('light')) return 'dark'
  if (scheme.includes('light') && !scheme.includes('dark')) return 'light'

  const body = doc.body
  if (body) {
    const lum = luminanceFromCssColor(getComputedStyle(body).backgroundColor)
    if (lum !== undefined) return lum < 0.45 ? 'dark' : 'light'
  }

  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Apply page theme onto a host so Shadow DOM `Canvas` / `color-scheme` match X. */
export function applyPageColorScheme(
  el: HTMLElement,
  scheme: PageColorScheme = readPageColorScheme(),
): PageColorScheme {
  el.style.colorScheme = scheme
  el.dataset.axColorScheme = scheme
  return scheme
}
