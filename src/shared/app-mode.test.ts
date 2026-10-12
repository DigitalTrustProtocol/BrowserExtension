import { describe, expect, it } from 'vitest'
import { isServerMode, parseAppMode } from './app-mode'

describe('parseAppMode', () => {
  it('accepts server and falls back to live', () => {
    expect(parseAppMode('server')).toBe('server')
    expect(parseAppMode('demo')).toBe('demo')
    expect(parseAppMode('production')).toBe('production')
    expect(parseAppMode('nope')).toBe('production')
    expect(isServerMode(parseAppMode('server'))).toBe(true)
  })
})
