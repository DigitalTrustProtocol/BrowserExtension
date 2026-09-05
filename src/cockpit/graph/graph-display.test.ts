import { describe, expect, it } from 'vitest'
import type { XIdentityDisplay, XPostDisplay } from '../../shared/contracts'
import { buildXProfileIconUrl } from '../../shared/x-profile-display'
import {
  applyXDisplayToGraphNode,
  applyXPostDisplayToGraphNode,
  collapseBoundPubkeyAliases,
  labelFromXIdentityDisplay,
  labelsFromXIdentityDisplay,
  labelsFromXPostDisplay,
  lookupByGraphNodeId,
  findGraphVizNode,
  nodeNeedsXPostEnrichment,
  nodeNeedsXProfileEnrichment,
  pictureFromXIdentityDisplay,
  postIdFromGraphNode,
  rootNeedsSignedInXProfile,
  unidentifiedKindForGraphNode,
  hydrateGraphDataChrome,
  ingestNeighborhoodChrome,
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
    const subject = { type: 'i' as const, value: 'user:id:42' }
    expect(
      nodeNeedsXProfileEnrichment({
        id: 12,
        kind: 'twitter_id',
        label: 'X · 42',
        subject,
      }),
    ).toBe('42')
    expect(
      nodeNeedsXProfileEnrichment({
        id: 12,
        kind: 'twitter_id',
        label: 'NASA',
        subject,
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
        { id: 'i:user:id:1', label: 'Unknown' },
        display,
      ),
    ).toEqual({
      id: 'i:user:id:1',
      label: 'Digital Trust Protocol',
      subtitle: '@trustprotocol',
      picture: buildXProfileIconUrl('profile_images/1/a'),
    })
    expect(
      applyXDisplayToGraphNode(
        { id: 'p:root', label: 'You', isRoot: true },
        display,
        { keepLabel: true },
      ),
    ).toEqual({
      id: 'p:root',
      label: 'You',
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
    const subject = { type: 'i' as const, value: 'post:id:99' }
    expect(postIdFromGraphNode({ subject })).toBe('99')
    expect(
      postIdFromGraphNode({
        subject: { type: 'i', value: 'user:id:99' },
      }),
    ).toBeUndefined()

    expect(
      nodeNeedsXPostEnrichment({
        id: 99,
        kind: 'post',
        label: 'Post · 99',
        subject,
      }),
    ).toBe('99')
    expect(
      nodeNeedsXPostEnrichment({
        id: 99,
        kind: 'post',
        label: 'Hello world',
        subtitle: '@alice',
        subject,
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
          id: 7,
          kind: 'twitter_id',
          label: 'X · 13298072',
          unidentifiedKind: 'x-id' as const,
          subject: { type: 'i' as const, value: 'user:id:13298072' },
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
      id: 7,
      kind: 'twitter_id',
      label: 'Tesla',
      subtitle: '@Tesla',
      picture,
      subject: { type: 'i', value: 'user:id:13298072' },
    })
    expect(hydrateGraphDataChrome(hydrated, {
      xByTwitterId: new Map([['13298072', display]]),
      xByPubkey: new Map(),
      profileByPubkey: new Map(),
      postById: new Map(),
    })).toBe(hydrated)
  })

  it('keeps the root label You while applying signed-in X chrome', () => {
    const display: XIdentityDisplay = {
      displayName: 'Digital Trust Protocol',
      handle: 'trustprotocol',
      iconPath: 'profile_images/1/a',
    }
    const hydrated = hydrateGraphDataChrome(
      {
        nodes: [
          {
            id: 0,
            kind: 'pubkey',
            label: 'You',
            isRoot: true,
            subject: { type: 'p' as const, value: 'rootpk' },
          },
        ],
      },
      {
        xByTwitterId: new Map(),
        xByPubkey: new Map(),
        profileByPubkey: new Map(),
        postById: new Map(),
        rootXDisplay: display,
      },
    )
    expect(hydrated.nodes[0]).toMatchObject({
      id: 0,
      label: 'You',
      isRoot: true,
      subtitle: '@trustprotocol',
      picture: buildXProfileIconUrl('profile_images/1/a'),
    })
  })

  it('collapses bound hop authors onto the matching user:id node', () => {
    const elonPk = 'a'.repeat(64)
    const data = collapseBoundPubkeyAliases(
      {
        nodes: [
          {
            id: 0,
            kind: 'pubkey',
            depth: 0,
            label: 'You',
            isRoot: true,
            subject: { type: 'p', value: 'rootpk' },
          },
          {
            id: 1,
            kind: 'pubkey',
            depth: 1,
            label: 'Elon Musk',
            subtitle: '@elonmusk',
            unidentifiedKind: 'external',
            subject: { type: 'p', value: elonPk },
          },
          {
            id: 2,
            kind: 'twitter_id',
            depth: 2,
            label: 'Elon Musk',
            subtitle: '@elonmusk',
            isFocus: true,
            subject: { type: 'i', value: 'user:id:44196397' },
          },
        ],
        links: [
          {
            id: 'path:root:elon',
            source: 0,
            target: 1,
            value: 1,
            context: 'identity',
            eventId: 'root-elon',
            depth: 1,
          },
          {
            id: 'ev:elon:elon-user',
            source: 1,
            target: 2,
            value: 1,
            context: 'identity',
            eventId: 'elon-self',
            depth: 2,
          },
        ],
      },
      {
        xByTwitterId: new Map(),
        xByPubkey: new Map([
          [
            elonPk,
            { twitterId: '44196397', displayName: 'Elon Musk', handle: 'elonmusk' },
          ],
        ]),
        profileByPubkey: new Map(),
        postById: new Map(),
      },
    )
    expect(data.nodes.map((node) => node.id).sort()).toEqual([0, 2])
    const elon = data.nodes.find((node) => node.id === 2)
    expect(elon?.isFocus).toBe(true)
    expect(elon?.kind).toBe('twitter_id')
    expect(elon?.depth).toBe(1)
    expect(elon?.collapsedFromIds).toEqual([1])
    expect(data.links).toHaveLength(1)
    expect(data.links[0]).toMatchObject({
      source: 0,
      target: 2,
    })
  })

  it('leaves unbound pubkey hops and the root on their heap indexes', () => {
    const unbound = 'b'.repeat(64)
    const data = collapseBoundPubkeyAliases(
      {
        nodes: [
          {
            id: 0,
            kind: 'pubkey',
            depth: 0,
            label: 'You',
            isRoot: true,
            subject: { type: 'p', value: 'rootpk' },
          },
          {
            id: 1,
            kind: 'pubkey',
            depth: 1,
            label: 'external',
            unidentifiedKind: 'external',
            subject: { type: 'p', value: unbound },
          },
        ],
        links: [
          {
            id: 'path:root:unbound',
            source: 0,
            target: 1,
            value: 1,
            context: 'identity',
            eventId: 'root-unbound',
            depth: 1,
          },
        ],
      },
      {
        xByTwitterId: new Map(),
        xByPubkey: new Map(),
        profileByPubkey: new Map(),
        postById: new Map(),
      },
    )
    expect(data.nodes.map((node) => node.id)).toEqual([0, 1])
    expect(data.nodes[1]?.kind).toBe('pubkey')
  })

  it('looks up batch results by collapsed hop vis ids', () => {
    expect(
      lookupByGraphNodeId(
        { id: 2, collapsedFromIds: [1] },
        { 1: { resolution: 'trusted' as const } },
      ),
    ).toEqual({ resolution: 'trusted' })
  })

  it('finds a collapsed hop by its former vis id', () => {
    const nodes = [
      {
        id: 2,
        kind: 'twitter_id' as const,
        depth: 1,
        label: 'Elon',
        collapsedFromIds: [1],
      },
    ]
    expect(findGraphVizNode(nodes, 1)?.id).toBe(2)
    expect(findGraphVizNode(nodes, 2)?.id).toBe(2)
  })

  it('ingests neighborhood chrome by twitterId, pubkey, and postId', () => {
    const xByTwitterId = new Map<string, XIdentityDisplay>()
    const xByPubkey = new Map<string, XIdentityDisplay>()
    const postById = new Map<string, XPostDisplay>()
    const display: XIdentityDisplay = {
      twitterId: '16224',
      handle: 'neve',
      displayName: 'Neve',
    }
    const hex = 'aa'.repeat(32)
    ingestNeighborhoodChrome(
      { xByTwitterId, xByPubkey, postById },
      {
        identities: {
          '16224': display,
          [hex]: display,
        },
        posts: { '9': { headline: 'hello' } },
      },
    )
    expect(xByTwitterId.get('16224')).toEqual(display)
    expect(xByPubkey.get(hex)).toEqual(display)
    expect(postById.get('9')).toEqual({ headline: 'hello' })
  })
})
