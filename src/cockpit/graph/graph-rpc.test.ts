import { describe, expect, it } from 'vitest'
import { viewerXDisplaySource } from './graph-rpc'

describe('viewerXDisplaySource', () => {
  it('uses the impersonated twitterId when present', () => {
    expect(
      viewerXDisplaySource({
        origin: 'impersonation',
        twitterId: '44196397',
      }),
    ).toEqual({ kind: 'impersonation', twitterId: '44196397' })
  })

  it('falls back to the signed-in operator otherwise', () => {
    expect(viewerXDisplaySource({ origin: 'impersonation' })).toEqual({
      kind: 'operator',
    })
    expect(
      viewerXDisplaySource({ origin: 'operator', twitterId: '1' }),
    ).toEqual({ kind: 'operator' })
    expect(viewerXDisplaySource(null)).toEqual({ kind: 'operator' })
  })
})
