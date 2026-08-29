import { describe, expect, it } from 'vitest'
import { menuPathEquals, parseMenuPath } from './menu-path.ts'

describe('parseMenuPath', () => {
  it('splits nested Users and Bindings paths', () => {
    expect(parseMenuPath(null)).toEqual([])
    expect(parseMenuPath('settings')).toEqual([])
    expect(parseMenuPath('users')).toEqual(['users'])
    expect(parseMenuPath('users/abc/security')).toEqual([
      'users',
      'abc',
      'security',
    ])
    expect(parseMenuPath('bindings/123')).toEqual(['bindings', '123'])
    expect(parseMenuPath('graph')).toEqual(['graph'])
  })
})

describe('menuPathEquals', () => {
  it('matches the deep-link stack exactly', () => {
    expect(menuPathEquals(['bindings', '1'], 'bindings/1')).toBe(true)
    expect(menuPathEquals(['bindings'], 'bindings/1')).toBe(false)
  })
})
