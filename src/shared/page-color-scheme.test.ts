import { describe, expect, it } from 'vitest'
import {
  resolveExtensionColorScheme,
  resolveGraphColorScheme,
  systemColorScheme,
} from './page-color-scheme'

describe('resolveExtensionColorScheme', () => {
  it('uses X theme when known', () => {
    expect(resolveExtensionColorScheme('dark', 'light')).toBe('dark')
    expect(resolveExtensionColorScheme('light', 'dark')).toBe('light')
  })

  it('falls back to the OS preference when X theme is unknown', () => {
    expect(resolveExtensionColorScheme(undefined, 'dark')).toBe('dark')
    expect(resolveExtensionColorScheme(undefined, 'light')).toBe('light')
  })
})

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
