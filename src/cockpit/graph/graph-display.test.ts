import { describe, expect, it } from 'vitest'
import {
  labelFromXIdentityDisplay,
  labelsFromXIdentityDisplay,
  nodeNeedsXProfileEnrichment,
  pictureFromXIdentityDisplay,
  twitterIdFromNodeId,
} from './graph-display'

describe('graph display helpers', () => {
  it('parses twitter id node ids', () => {
    expect(twitterIdFromNodeId('i:ext:twitter_id:11348282')).toBe('11348282')
    expect(twitterIdFromNodeId('p:abc')).toBeUndefined()
  })

  it('builds labels from display name or handle', () => {
    expect(labelFromXIdentityDisplay({ displayName: 'NASA' })).toBe('NASA')
    expect(labelFromXIdentityDisplay({ handle: 'nasa' })).toBe('@nasa')
    expect(labelFromXIdentityDisplay({})).toBeUndefined()
    expect(labelsFromXIdentityDisplay({ displayName: 'NASA', handle: 'nasa' })).toEqual({
      label: 'NASA',
      subtitle: '@nasa',
    })
  })

  it('builds profile image urls from icon paths', () => {
    expect(
      pictureFromXIdentityDisplay({
        iconPath: 'profile_images/11348282/nasa',
      }),
    ).toBe('https://pbs.twimg.com/profile_images/11348282/nasa_200x200.jpg')
  })

  it('detects nodes that still use the default X label', () => {
    expect(
      nodeNeedsXProfileEnrichment({
        id: 'i:ext:twitter_id:42',
        kind: 'twitter_id',
        label: 'X · 42',
      }),
    ).toBe('42')
    expect(
      nodeNeedsXProfileEnrichment({
        id: 'i:ext:twitter_id:42',
        kind: 'twitter_id',
        label: 'NASA',
      }),
    ).toBeUndefined()
  })
})
