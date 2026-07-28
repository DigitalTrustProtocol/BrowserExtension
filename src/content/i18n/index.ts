import { CONTENT_EN } from './fallback-en'

const DEFAULT_LANG = 'en'

/** Locales that ship a `locales/{code}.json` in the extension package. */
const LOADABLE_LANGS = new Set([
  'en',
  'es',
  'pt',
  'de',
  'fr',
  'it',
  'da',
])

let currentLang = DEFAULT_LANG
let currentStrings: Record<string, string> = { ...CONTENT_EN }
const listeners = new Set<() => void>()

function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template
  let out = template
  for (const [key, value] of Object.entries(params)) {
    out = out.replaceAll(`{${key}}`, String(value))
  }
  return out
}

/**
 * Translate a content-page key. Falls back to embedded English, then the key.
 */
export function t(
  key: string,
  params?: Record<string, string | number>,
): string {
  const str = currentStrings[key] ?? CONTENT_EN[key] ?? key
  return interpolate(str, params)
}

export function getContentLanguage(): string {
  return currentLang
}

/** Notify when locale strings change (after async load or host-language change). */
export function onContentLocaleChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notifyLocaleChange(): void {
  for (const listener of listeners) listener()
}

function languageOnly(tag: string): string {
  const base = tag.trim().toLowerCase().split(/[-_]/)[0]
  return base || DEFAULT_LANG
}

function resolveLoadableLang(preferred: string | undefined): string {
  if (!preferred) return DEFAULT_LANG
  const code = languageOnly(preferred)
  return LOADABLE_LANGS.has(code) ? code : DEFAULT_LANG
}

/** Read X UI language from `<html lang>` when present and non-empty. */
export function readXHtmlLang(
  doc: ParentNode & { documentElement?: HTMLElement } = document,
): string | undefined {
  const raw =
    doc.documentElement?.getAttribute?.('lang') ??
    (doc.documentElement as HTMLElement | undefined)?.lang
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  return languageOnly(raw)
}

/** Read X UI language from the `lang` cookie when present. */
export function readXLangCookie(cookie = document.cookie): string | undefined {
  if (!cookie) return undefined
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name !== 'lang') continue
    const value = rest.join('=').trim()
    if (!value) return undefined
    return languageOnly(decodeURIComponent(value))
  }
  return undefined
}

/**
 * Detect X.com display language: `<html lang>` first, then `lang` cookie.
 * Returns undefined when neither is available.
 */
export function detectXHostLanguage(
  doc: ParentNode & { documentElement?: HTMLElement } = document,
  cookie = typeof document !== 'undefined' ? document.cookie : '',
): string | undefined {
  return readXHtmlLang(doc) ?? readXLangCookie(cookie)
}

function detectPreferredLanguage(): string {
  return (
    detectXHostLanguage() ??
    (typeof navigator !== 'undefined' ? navigator.language : DEFAULT_LANG) ??
    DEFAULT_LANG
  )
}

async function fetchLocale(
  lang: string,
): Promise<Record<string, string> | undefined> {
  try {
    const url = chrome.runtime.getURL(`locales/${lang}.json`)
    const resp = await fetch(url)
    if (!resp.ok) return undefined
    const data = (await resp.json()) as Record<string, string>
    return data && typeof data === 'object' ? data : undefined
  } catch {
    return undefined
  }
}

/**
 * Apply a language: merge locale JSON over embedded English so missing
 * `content.*` keys stay English.
 * @returns true when visible strings may have changed
 */
async function applyLanguage(lang: string): Promise<boolean> {
  const nextLang = resolveLoadableLang(lang)
  const loaded = await fetchLocale(nextLang)
  const nextStrings = loaded
    ? { ...CONTENT_EN, ...pickContentKeys(loaded) }
    : { ...CONTENT_EN }

  const changed =
    nextLang !== currentLang || !shallowEqual(currentStrings, nextStrings)
  currentLang = nextLang
  currentStrings = nextStrings
  return changed
}

function pickContentKeys(
  catalog: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(catalog)) {
    if (key.startsWith('content.') && typeof value === 'string') {
      out[key] = value
    }
  }
  return out
}

function shallowEqual(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const keys = Object.keys(CONTENT_EN)
  for (const key of keys) {
    if ((a[key] ?? CONTENT_EN[key]) !== (b[key] ?? CONTENT_EN[key])) {
      return false
    }
  }
  return true
}

/**
 * Start with embedded English (sync). Then load X (or browser) locale JSON.
 * Resolves true if strings changed after load (callers should re-paint).
 */
export async function initContentI18n(): Promise<boolean> {
  currentStrings = { ...CONTENT_EN }
  currentLang = DEFAULT_LANG

  const changed = await applyLanguage(detectPreferredLanguage())
  if (changed) notifyLocaleChange()
  return changed
}

/**
 * Watch X `<html lang>` changes (SPA language switch) and re-apply locale.
 */
export function watchXHostLanguage(onChanged: () => void): () => void {
  if (typeof MutationObserver === 'undefined' || !document.documentElement) {
    return () => undefined
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void applyLanguage(detectPreferredLanguage()).then((changed) => {
        if (!changed) return
        notifyLocaleChange()
        onChanged()
      })
    }, 50)
  }

  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['lang'],
  })

  return () => {
    if (timer !== undefined) clearTimeout(timer)
    observer.disconnect()
  }
}

/** Test helper: reset to embedded English without fetching. */
export function resetContentI18nForTests(): void {
  currentLang = DEFAULT_LANG
  currentStrings = { ...CONTENT_EN }
}
