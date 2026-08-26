import { describe, expect, it } from 'vitest'
import type { XIdentityDisplay, XPostDisplay } from '../../shared/contracts'
import { buildXProfileIconUrl } from '../../shared/x-profile-display'
import {
  applyXDisplayToGraphNode,
  applyXPostDisplayToGraphNode,
  labelFromXIdentityDisplay,
  labelsFromXIdentityDisplay,
  labelsFromXPostDisplay,
  nodeNeedsXPostEnrichment,
  nodeNeedsXProfileEnrichment,
  pictureFromXIdentityDisplay,
  postIdFromNodeId,
  rootNeedsSignedInXProfile,
  unidentifiedKindForGraphNode,
  hydrateGraphDataChrome,
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
    expect(
      pictureFromXIdentityDisplay({
        iconPath:
          'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n_normal.png',
      }),
    ).toBe(
      'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n_200x200.png',
    )
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

  it('parses post ids and applies xPosts chrome', () => {
    expect(postIdFromNodeId('i:post:id:99')).toBe('99')
    expect(postIdFromNodeId('i:user:id:99')).toBeUndefined()

    expect(
      nodeNeedsXPostEnrichment({
        id: 'i:post:id:99',
        kind: 'post',
        label: 'Post · 99',
      }),
    ).toBe('99')
    expect(
      nodeNeedsXPostEnrichment({
        id: 'i:post:id:99',
        kind: 'post',
        label: 'Hello world',
        subtitle: '@alice',
      }),
    ).toBeUndefined()

    const display: XPostDisplay = {
      headline: 'Hello world',
      authorHandle: 'alice',
      authorTwitterId: '42',
    }
    expect(labelsFromXPostDisplay(display)).toEqual({
      label: 'Hello world',
      subtitle: '@alice',
    })
    expect(
      applyXPostDisplayToGraphNode(
        { id: 'i:post:id:99', label: 'Post · 99' },
        display,
      ),
    ).toEqual({
      id: 'i:post:id:99',
      label: 'Hello world',
      subtitle: '@alice',
    })
  })

  it('classifies unidentified graph paints', () => {
    expect(
      unidentifiedKindForGraphNode({ kind: 'twitter_id' }),
    ).toBe('x-id')
    expect(
      unidentifiedKindForGraphNode({ kind: 'pubkey', isRoot: true }),
    ).toBeUndefined()
    expect(unidentifiedKindForGraphNode({ kind: 'pubkey' })).toBe('external')
    expect(
      applyXDisplayToGraphNode(
        {
          id: 'i:user:id:1',
          label: 'Unknown',
          unidentifiedKind: 'x-id' as const,
        },
        { displayName: 'NASA', handle: 'nasa' },
      ).unidentifiedKind,
    ).toBeUndefined()
  })

  it('reapplies cached avatars onto snapshot nodes after expand', () => {
    const display: XIdentityDisplay = {
      displayName: 'Tesla',
      handle: 'Tesla',
      iconPath:
        'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n_normal.png',
    }
    const picture = pictureFromXIdentityDisplay(display)
    const fresh = {
      nodes: [
        {
          id: 'i:user:id:13298072',
          kind: 'twitter_id',
          label: 'X · 13298072',
          unidentifiedKind: 'x-id' as const,
        },
      ],
    }
    const hydrated = hydrateGraphDataChrome(fresh, {
      xByTwitterId: new Map([['13298072', display]]),
      xByPubkey: new Map(),
      profileByPubkey: new Map(),
      postById: new Map(),
    })
    expect(hydrated.nodes[0]).toEqual({
      id: 'i:user:id:13298072',
      kind: 'twitter_id',
      label: 'Tesla',
      subtitle: '@Tesla',
      picture,
    })
    expect(hydrateGraphDataChrome(hydrated, {
      xByTwitterId: new Map([['13298072', display]]),
      xByPubkey: new Map(),
      profileByPubkey: new Map(),
      postById: new Map(),
    })).toBe(hydrated)
  })
})
