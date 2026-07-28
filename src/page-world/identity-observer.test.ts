import { describe, expect, it } from 'vitest'
import {
  OBSERVER_LIMITS,
  extractObservedXIdentities,
  inspectFetchResponse,
  inspectXhrResponse,
  operationNameFromUrl,
} from './identity-observer'
import { isAllowedXOperation } from '../shared/observed-x-identity'
import {
  tweetDetailFixture,
  tweetDetailConversationFixture,
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
