import { describe, expect, it } from 'vitest'
import { isXProductHost } from './x-host-autoconnect'

describe('x product hosts', () => {
  it('recognizes x and twitter hosts', () => {
    expect(isXProductHost('x.com')).toBe(true)
    expect(isXProductHost('www.twitter.com')).toBe(true)
    expect(isXProductHost('primal.net')).toBe(false)
  })
})
