import { describe, expect, it } from 'vitest'
import {
  isXProductHost,
  shouldOneTimeAutoConnectXHost,
} from './x-host-autoconnect'

describe('x-host-autoconnect', () => {
  it('recognizes x and twitter hosts', () => {
    expect(isXProductHost('x.com')).toBe(true)
    expect(isXProductHost('www.twitter.com')).toBe(true)
    expect(isXProductHost('primal.net')).toBe(false)
  })

  it('auto-connects only once while disconnected', () => {
    expect(shouldOneTimeAutoConnectXHost('x.com', [], false)).toBe(true)
    expect(shouldOneTimeAutoConnectXHost('x.com', ['x.com'], false)).toBe(
      false,
    )
    expect(shouldOneTimeAutoConnectXHost('x.com', [], true)).toBe(false)
    expect(shouldOneTimeAutoConnectXHost('primal.net', [], false)).toBe(false)
  })
})
