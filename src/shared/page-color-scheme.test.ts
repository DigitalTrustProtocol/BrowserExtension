import { describe, expect, it } from 'vitest'
import {
  resolveGraphColorScheme,
  systemColorScheme,
} from './page-color-scheme'

describe('resolveGraphColorScheme', () => {
  it('honors explicit light and dark preferences', () => {
    expect(resolveGraphColorScheme('light', 'dark', 'dark')).toBe('light')
    expect(resolveGraphColorScheme('dark', 'light', 'light')).toBe('dark')
  })

  it('uses X theme when preference is auto', () => {
    expect(resolveGraphColorScheme('auto', 'dark', 'light')).toBe('dark')
    expect(resolveGraphColorScheme('auto', 'light', 'dark')).toBe('light')
  })

  it('falls back to system when auto and X theme unknown', () => {
    expect(resolveGraphColorScheme('auto', undefined, 'dark')).toBe('dark')
    expect(resolveGraphColorScheme('auto', undefined, 'light')).toBe('light')
  })
})

describe('systemColorScheme', () => {
  it('reads prefers-color-scheme from matchMedia', () => {
    const dark = systemColorScheme(
      () => ({ matches: true }) as MediaQueryList,
    )
    const light = systemColorScheme(
      () => ({ matches: false }) as MediaQueryList,
    )
    expect(dark).toBe('dark')
    expect(light).toBe('light')
  })
})
