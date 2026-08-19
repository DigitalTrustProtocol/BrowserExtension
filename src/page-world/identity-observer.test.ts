import { describe, expect, it } from 'vitest'
import {
  OBSERVER_LIMITS,
  collectProfileBannersFromUrls,
  extractObservedXBioCandidates,
  extractObservedXIdentities,
  inspectFetchResponse,
  inspectXhrResponse,
  operationNameFromUrl,
} from './identity-observer'
import { isAllowedXOperation, sanitizeObservedXIdentity } from '../shared/observed-x-identity'
import {
  tweetDetailFixture,
  tweetDetailConversationFixture,
  tweetDetailBioNpubFixture,
  homeTimeline2026Fixture,
  unrelatedJsonFixture,
} from './__fixtures__/tweet-detail'

describe('page-world identity observer', () => {
  it('allowlists operation names parsed from GraphQL URLs', () => {
    expect(
      operationNameFromUrl(
        'https://x.com/i/api/graphql/hash/TweetDetail?variables=x',
      ),
    ).toBe('TweetDetail')
    expect(
      operationNameFromUrl('https://x.com/i/api/graphql/hash/AccountSettings'),
    ).toBeUndefined()
    expect(isAllowedXOperation('UserByScreenName')).toBe(true)
    expect(isAllowedXOperation('TweetResultsByRestIds')).toBe(true)
    expect(isAllowedXOperation('Bookmarks')).toBe(false)
    expect(isAllowedXOperation('Likes')).toBe(false)
    expect(isAllowedXOperation('CreateTweet')).toBe(false)
  })

  it('extracts only paired, normalized identity tuples from a fixture', () => {
    expect(
      extractObservedXIdentities(
        tweetDetailFixture,
        'TweetDetail',
        1_700_000_000_000,
      ),
    ).toEqual([
      {
        twitterId: '11348282',
        handle: 'nasa',
        observedAt: 1_700_000_000_000,
        sourceOperation: 'TweetDetail',
        postIds: ['2080659774136291424'],
        displayName: 'NASA',
        iconPath: 'profile_images/11348282/nasa',
        bannerPath: 'profile_banners/11348282/1700000000',
      },
    ])
    expect(
      JSON.stringify(
        extractObservedXIdentities(
          tweetDetailFixture,
          'TweetDetail',
          1_700_000_000_000,
        ),
      ),
    ).not.toContain('must-not-be-forwarded')
  })

  it('extracts a profile banner stem from UserByScreenName, not the avatar', () => {
    const observations = extractObservedXIdentities(
      {
        data: {
          user: {
            result: {
              __typename: 'User',
              rest_id: '44196397',
              legacy: {
                screen_name: 'elonmusk',
                name: 'Elon Musk',
                profile_image_url_https:
                  'https://pbs.twimg.com/profile_images/44196397/avatar_normal.jpg',
                profile_banner_url:
                  'https://pbs.twimg.com/profile_banners/44196397/1774145451/600x200',
              },
            },
          },
        },
      },
      'UserByScreenName',
      1_700_000_000_000,
    )
    expect(observations).toEqual([
      {
        twitterId: '44196397',
        handle: 'elonmusk',
        observedAt: 1_700_000_000_000,
        sourceOperation: 'UserByScreenName',
        displayName: 'Elon Musk',
        iconPath: 'profile_images/44196397/avatar',
        bannerPath: 'profile_banners/44196397/1774145451',
      },
    ])
    expect(JSON.stringify(observations)).not.toContain('profile_images/44196397/avatar_400x400')
  })

  it('sanitizes bannerPath stems and drops avatar URLs as covers', () => {
    expect(
      sanitizeObservedXIdentity({
        twitterId: '44196397',
        handle: 'elonmusk',
        observedAt: 1,
        sourceOperation: 'UserByScreenName',
        bannerPath:
          'https://pbs.twimg.com/profile_banners/44196397/1774145451/1500x500',
        iconPath:
          'https://pbs.twimg.com/profile_images/44196397/avatar_normal.jpg',
      }),
    ).toMatchObject({
      bannerPath: 'profile_banners/44196397/1774145451',
      iconPath: 'profile_images/44196397/avatar',
    })
    expect(
      sanitizeObservedXIdentity({
        twitterId: '44196397',
        handle: 'elonmusk',
        observedAt: 1,
        sourceOperation: 'UserByScreenName',
        bannerPath: 'profile_images/44196397/avatar',
      })?.bannerPath,
    ).toBeUndefined()
  })

  it('collects banner stems from public img URLs by twitterId', () => {
    const banners = collectProfileBannersFromUrls([
      'https://pbs.twimg.com/profile_banners/44196397/1774145451/600x200',
      'https://pbs.twimg.com/profile_images/44196397/avatar_normal.jpg',
      'https://pbs.twimg.com/profile_banners/11348282/1/1500x500 1500w, https://pbs.twimg.com/profile_banners/11348282/1/600x200 600w',
    ])
    expect(banners.get('44196397')).toBe('profile_banners/44196397/1774145451')
    expect(banners.get('11348282')).toBe('profile_banners/11348282/1')
    expect(banners.size).toBe(2)
    expect(
      collectProfileBannersFromUrls([
        'background-image: url("https://pbs.twimg.com/profile_banners/44196397/1774145451/600x200")',
      ]).get('44196397'),
    ).toBe('profile_banners/44196397/1774145451')
  })

  it('extracts reply authors from TweetDetail VerticalConversation modules', () => {
    const observations = extractObservedXIdentities(
      tweetDetailConversationFixture,
      'TweetDetail',
      1_700_000_000_000,
    ).sort((a, b) => a.twitterId.localeCompare(b.twitterId))

    expect(observations).toEqual([
      {
        twitterId: '11348282',
        handle: 'nasa',
        observedAt: 1_700_000_000_000,
        sourceOperation: 'TweetDetail',
        postIds: ['2080659774136291424'],
      },
      {
        twitterId: '44196397',
        handle: 'commenterone',
        observedAt: 1_700_000_000_000,
        sourceOperation: 'TweetDetail',
        postIds: ['2080659774136291999'],
        displayName: 'Commenter',
      },
      {
        twitterId: '783214',
        handle: 'nested_reply',
        observedAt: 1_700_000_000_000,
        sourceOperation: 'TweetDetail',
        postIds: ['2080659774136292000'],
      },
    ])
    expect(JSON.stringify(observations)).not.toContain('must-not-be-forwarded')
  })

  it('extracts identities from the 2026 schema with legacy null and core screen_name', () => {
    expect(
      extractObservedXIdentities(
        homeTimeline2026Fixture,
        'HomeTimeline',
        1_700_000_000_000,
      ),
    ).toEqual([
      {
        twitterId: '11348282',
        handle: 'nasa',
        observedAt: 1_700_000_000_000,
        sourceOperation: 'HomeTimeline',
        postIds: ['2080659774136291424'],
        displayName: 'NASA',
      },
    ])
    expect(
      JSON.stringify(
        extractObservedXIdentities(
          homeTimeline2026Fixture,
          'HomeTimeline',
          1_700_000_000_000,
        ),
      ),
    ).not.toContain('must-not-be-forwarded')
  })

  it('ignores unpaired identities and non-allowlisted operations', () => {
    expect(
      extractObservedXIdentities(unrelatedJsonFixture, 'TweetDetail'),
    ).toEqual([])
    expect(
      extractObservedXIdentities(tweetDetailFixture, 'CreateTweet'),
    ).toEqual([])
  })

  it('does not let quoted users inherit the outer post ID', () => {
    const observations = extractObservedXIdentities(
      {
        __typename: 'Tweet',
        rest_id: '111',
        legacy: { full_text: 'outer' },
        core: {
          user_results: {
            result: {
              rest_id: '1',
              legacy: { screen_name: 'outer_user' },
            },
          },
        },
        quoted_status_result: {
          result: {
            __typename: 'Tweet',
            rest_id: '222',
            legacy: { full_text: 'inner' },
            core: {
              user_results: {
                result: {
                  rest_id: '2',
                  legacy: { screen_name: 'inner_user' },
                },
              },
            },
          },
        },
      },
      'TweetDetail',
      1_700_000_000_000,
    )

    expect(observations.find(({ handle }) => handle === 'outer_user')?.postIds).toEqual([
      '111',
    ])
    expect(observations.find(({ handle }) => handle === 'inner_user')?.postIds).toEqual([
      '222',
    ])
  })

  it('emits Bio sightings without npub and never leaks the description', () => {
    const candidates = extractObservedXBioCandidates(
      tweetDetailFixture,
      'TweetDetail',
      1_700_000_000_000,
    )
    expect(candidates.length).toBeGreaterThan(0)
    for (const c of candidates) {
      expect(c.npubCount).toBe(0)
      expect(c.npub).toBeUndefined()
    }
    const serialized = JSON.stringify(candidates)
    expect(serialized).not.toContain('must-not-be-forwarded')
  })

  it('extracts a structured Bio npub candidate and discards the raw bio text', () => {
    const candidates = extractObservedXBioCandidates(
      tweetDetailBioNpubFixture,
      'TweetDetail',
      1_700_000_000_000,
    )
    expect(candidates).toEqual([
      {
        twitterId: '11348282',
        handle: 'nasa',
        npub: `npub1${'q'.repeat(60)}`,
        npubCount: 1,
        postId: '2080659774136291424',
        postCreatedAt: Date.parse('Wed Oct 10 20:19:24 +0000 2018'),
        observedAt: 1_700_000_000_000,
      },
    ])
    const serialized = JSON.stringify(candidates)
    expect(serialized).not.toContain('Space agency')
    expect(serialized).not.toContain('must-not-be-forwarded')
  })

  it('extracts Bio npubs from bare UserByScreenName user nodes', () => {
    const payload = {
      data: {
        user: {
          result: {
            __typename: 'User',
            rest_id: '99',
            legacy: {
              screen_name: 'bob',
              description: `hello npub1${'q'.repeat(60)}`,
            },
          },
        },
      },
    }
    const candidates = extractObservedXBioCandidates(
      payload,
      'UserByScreenName',
      1_700_000_000_000,
    )
    expect(candidates).toEqual([
      {
        twitterId: '99',
        handle: 'bob',
        npub: `npub1${'q'.repeat(60)}`,
        npubCount: 1,
        observedAt: 1_700_000_000_000,
      },
    ])
  })

  it('ignores Bio candidates from non-allowlisted operations', () => {
    expect(
      extractObservedXBioCandidates(tweetDetailBioNpubFixture, 'CreateTweet'),
    ).toEqual([])
  })

  it('inspects a cloned successful JSON fetch response', async () => {
    const body = JSON.stringify(tweetDetailFixture)
    const response = new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })

    expect(await inspectFetchResponse(response, 'TweetDetail')).toHaveLength(1)
    expect(await response.text()).toBe(body)
  })

  it('ignores unsuccessful or non-JSON fetch responses', async () => {
    const body = JSON.stringify(tweetDetailFixture)
    const failed = new Response(body, {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
    const html = new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })

    expect(await inspectFetchResponse(failed, 'TweetDetail')).toEqual([])
    expect(await inspectFetchResponse(html, 'TweetDetail')).toEqual([])
  })

  it('stops reading an oversized fetch clone incrementally', async () => {
    let pulls = 0
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1
          if (pulls > 10) {
            controller.close()
            return
          }
          controller.enqueue(
            new Uint8Array(Math.floor(OBSERVER_LIMITS.maxResponseBytes / 2) + 1),
          )
        },
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    )

    expect(await inspectFetchResponse(response, 'TweetDetail')).toEqual([])
    expect(pulls).toBeLessThan(10)
    await response.body?.cancel()
  })

  it('inspects only successful JSON XHR data without changing it', () => {
    const body = JSON.stringify(tweetDetailFixture)
    const xhr = {
      status: 200,
      responseType: '',
      responseText: body,
      getResponseHeader(name: string) {
        return name.toLowerCase() === 'content-type'
          ? 'application/json; charset=utf-8'
          : null
      },
    } as XMLHttpRequest

    expect(inspectXhrResponse(xhr, 'TweetDetail')).toHaveLength(1)
    expect(xhr.responseText).toBe(body)
  })
})
