import { describe, expect, it } from 'vitest'
import type { XIdentityDisplay } from '../../shared/contracts'
import { buildXProfileIconUrl } from '../../shared/x-profile-display'
import {
  applyXDisplayToGraphNode,
  labelFromXIdentityDisplay,
  labelsFromXIdentityDisplay,
  nodeNeedsXProfileEnrichment,
  pictureFromXIdentityDisplay,
  rootNeedsSignedInXProfile,
} from './graph-display'

describe('graph display helpers', () => {
  it('builds labels from display name or handle', () => {
    expect(labelFromXIdentityDisplay({ displayName: 'NASA' })).toBe('NASA')
    expect(labelFromXIdentityDisplay({ handle: 'nasa' })).toBe('@nasa')
    expect(labelFromXIdentityDisplay({})).toBeUndefined()
    expect(
      labelsFromXIdentityDisplay({ displayName: 'NASA', handle: 'nasa' }),
    ).toEqual({
      label: 'NASA',
      subtitle: '@nasa',
    })
  })

  it('builds profile image URLs from icon paths', () => {
    expect(
      pictureFromXIdentityDisplay({
        iconPath: 'profile_images/11348282/nasa',
      }),
    ).toBe(buildXProfileIconUrl('profile_images/11348282/nasa'))
  })

  it('detects nodes that still use the default X label', () => {
    expect(
      nodeNeedsXProfileEnrichment({
        id: 'i:user:id:42',
        kind: 'twitter_id',
        label: 'X · 42',
      }),
    ).toBe('42')
    expect(
      nodeNeedsXProfileEnrichment({
        id: 'i:user:id:42',
        kind: 'twitter_id',
        label: 'NASA',
      }),
    ).toBeUndefined()
  })

  it('applies xIdentities chrome onto graph nodes', () => {
    const display: XIdentityDisplay = {
      displayName: 'Digital Trust Protocol',
      handle: 'trustprotocol',
      iconPath: 'profile_images/1/a',
    }
    expect(
      applyXDisplayToGraphNode(
        { id: 'p:root', label: 'You', isRoot: true },
        display,
      ),
    ).toEqual({
      id: 'p:root',
      label: 'Digital Trust Protocol',
      isRoot: true,
      subtitle: '@trustprotocol',
      picture: buildXProfileIconUrl('profile_images/1/a'),
    })
  })

  it('detects when the root node still needs signed-in X profile chrome', () => {
    expect(rootNeedsSignedInXProfile({ isRoot: true })).toBe(true)
    expect(
      rootNeedsSignedInXProfile({
        isRoot: true,
        subtitle: '@trustprotocol',
        picture: 'https://pbs.twimg.com/profile_images/1/a_200x200.jpg',
      }),
    ).toBe(false)
    expect(rootNeedsSignedInXProfile({})).toBe(false)
  })
})
