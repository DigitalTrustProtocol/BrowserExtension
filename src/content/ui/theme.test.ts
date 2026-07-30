/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from 'vitest'
import { applyPageColorScheme, readPageColorScheme } from './theme'

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('style')
  document.body.replaceChildren()
  document.body.style.backgroundColor = ''
})

describe('readPageColorScheme', () => {
  it('prefers X data-theme over OS prefers-color-scheme', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    expect(readPageColorScheme()).toBe('dark')
  })

  it('reads color-scheme from the html style X sets', () => {
    document.documentElement.style.colorScheme = 'dark'
    expect(readPageColorScheme()).toBe('dark')
  })

  it('applies scheme onto hosts for Shadow DOM Canvas colors', () => {
    const host = document.createElement('div')
    applyPageColorScheme(host, 'dark')
    expect(host.style.colorScheme).toBe('dark')
    expect(host.dataset.axColorScheme).toBe('dark')
  })
})
