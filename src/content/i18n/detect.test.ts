/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import {
  detectXHostLanguage,
  readXHtmlLang,
  readXLangCookie,
} from './index'

describe('detectXHostLanguage', () => {
  it('reads html lang before the lang cookie', () => {
    document.documentElement.lang = 'da-DK'
    expect(readXHtmlLang(document)).toBe('da')
    expect(
      detectXHostLanguage(document, 'guest_id=1; lang=es; other=x'),
    ).toBe('da')
  })

  it('falls back to the lang cookie when html lang is missing', () => {
    document.documentElement.removeAttribute('lang')
    expect(readXHtmlLang(document)).toBeUndefined()
    expect(readXLangCookie('a=1; lang=pt-BR; b=2')).toBe('pt')
    expect(detectXHostLanguage(document, 'lang=de')).toBe('de')
  })

  it('returns undefined when neither signal is present', () => {
    document.documentElement.removeAttribute('lang')
    expect(detectXHostLanguage(document, 'guest_id=abc')).toBeUndefined()
  })
})
