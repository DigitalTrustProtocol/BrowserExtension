import { describe, expect, it } from 'vitest'
import { DEFAULT_TRUST_FILTERS } from './x-augmentation'
import {
  anyHideTrustFilterActive,
  backfillFilteredTimeline,
  collectTimelineTweetSubjects,
  countTimelineContentEntries,
  filterTimelineGraphqlPayload,
  isTimelineCursorEntry,
  isTimelineJsonFilterOperation,
  mergeTimelineJsonFilterResolutions,
  postTimelineFilterResolution,
  processTimelineGraphqlPayload,
  readTimelineBottomCursor,
  readTimelineEntryTweetRef,
  resolutionKey,
  shouldHideTimelineJsonItem,
} from './timeline-json-filter'

const homePayload = {
  data: {
    home: {
      home_timeline_urt: {
        instructions: [
          {
            type: 'TimelineAddEntries',
            entries: [
              {
                entryId: 'tweet-1',
                content: {
                  itemContent: {
                    tweet_results: {
                      result: {
                        __typename: 'Tweet',
                        rest_id: '111',
                        core: {
                          user_results: {
                            result: { __typename: 'User', rest_id: '1' },
                          },
                        },
                      },
                    },
                  },
                },
              },
              {
                entryId: 'tweet-2',
                content: {
                  itemContent: {
                    tweet_results: {
                      result: {
                        __typename: 'Tweet',
                        rest_id: '222',
                        core: {
                          user_results: {
                            result: { __typename: 'User', rest_id: '2' },
                          },
                        },
                      },
                    },
                  },
                },
              },
              {
                entryId: 'promoted-3',
                content: {
                  itemContent: {
                    promotedMetadata: { impression_id: 'x' },
                    tweet_results: {
                      result: {
                        __typename: 'Tweet',
                        rest_id: '333',
                        core: {
                          user_results: {
                            result: { __typename: 'User', rest_id: '3' },
                          },
                        },
                      },
                    },
                  },
                },
              },
              {
                entryId: 'cursor-bottom-0',
                content: { __typename: 'TimelineTimelineCursor' },
              },
            ],
          },
        ],
      },
    },
  },
}

describe('timeline-json-filter', () => {
  it('recognizes feed operations', () => {
    expect(isTimelineJsonFilterOperation('HomeTimeline')).toBe(true)
    expect(isTimelineJsonFilterOperation('HomeLatestTimeline')).toBe(true)
    expect(isTimelineJsonFilterOperation('UserTweets')).toBe(true)
    expect(isTimelineJsonFilterOperation('TweetDetail')).toBe(false)
    expect(isTimelineJsonFilterOperation('CreateTweet')).toBe(false)
  })

  it('treats collapse actions as inactive for JSON hide', () => {
    expect(
      anyHideTrustFilterActive({
        ...DEFAULT_TRUST_FILTERS,
        distrusted: 'collapseAll',
      }),
    ).toBe(false)
    expect(
      anyHideTrustFilterActive({
        ...DEFAULT_TRUST_FILTERS,
        distrusted: 'hideAll',
      }),
    ).toBe(true)
  })

  it('hides by hide actions only', () => {
    expect(
      shouldHideTimelineJsonItem({
        filters: { ...DEFAULT_TRUST_FILTERS, trusted: 'collapseAll' },
        authorResolution: 'trusted',
        promoted: false,
      }),
    ).toBe(false)
    expect(
      shouldHideTimelineJsonItem({
        filters: { ...DEFAULT_TRUST_FILTERS, trusted: 'hideUser' },
        authorResolution: 'trusted',
        promoted: false,
      }),
    ).toBe(true)
    expect(
      shouldHideTimelineJsonItem({
        filters: { ...DEFAULT_TRUST_FILTERS, trusted: 'hideAll' },
        authorResolution: 'trusted',
        promoted: true,
      }),
    ).toBe(false)
  })

  it('reads tweet refs and cursors from entries', () => {
    const entries =
      homePayload.data.home.home_timeline_urt.instructions[0]!.entries
    expect(readTimelineEntryTweetRef(entries[0])).toEqual({
      postId: '111',
      userId: '1',
      promoted: false,
    })
    expect(readTimelineEntryTweetRef(entries[2])?.promoted).toBe(true)
    expect(isTimelineCursorEntry(entries[3])).toBe(true)
  })

  it('filters home timeline entries by resolution map', () => {
    const { payload, removed } = filterTimelineGraphqlPayload(homePayload, {
      filters: { ...DEFAULT_TRUST_FILTERS, trusted: 'hideAll' },
      resolutions: {
        [resolutionKey('user', '1')]: 'trusted',
        [resolutionKey('post', '111')]: 'none',
        [resolutionKey('user', '2')]: 'none',
        [resolutionKey('post', '222')]: 'none',
        [resolutionKey('user', '3')]: 'trusted',
        [resolutionKey('post', '333')]: 'none',
      },
    })
    expect(removed).toBe(1)
    const entries = (
      payload as typeof homePayload
    ).data.home.home_timeline_urt.instructions[0]!.entries
    expect(entries.map((e) => e.entryId)).toEqual([
      'tweet-2',
      'promoted-3',
      'cursor-bottom-0',
    ])
  })

  it('treats missing resolutions as no evidence', () => {
    const { removed } = filterTimelineGraphqlPayload(homePayload, {
      filters: { ...DEFAULT_TRUST_FILTERS, none: 'hideAll' },
      resolutions: {},
    })
    // Organic tweets (not promoted) hide; promoted + cursor stay.
    expect(removed).toBe(2)
  })

  it('strips all organics when every dropdown is Hide all', () => {
    const { removed, payload } = filterTimelineGraphqlPayload(homePayload, {
      filters: {
        trusted: 'hideAll',
        mixed: 'hideAll',
        distrusted: 'hideAll',
        none: 'hideAll',
      },
      resolutions: {},
    })
    expect(removed).toBe(2)
    const entries = (
      payload as typeof homePayload
    ).data.home.home_timeline_urt.instructions[0]!.entries
    expect(entries.map((e) => e.entryId)).toEqual([
      'promoted-3',
      'cursor-bottom-0',
    ])
  })

  it('merges cursor pages and backfills until min items', () => {
    const makePage = (
      top: string,
      bottom: string,
      promotedId: string,
      restId: string,
    ) => ({
      data: {
        home: {
          home_timeline_urt: {
            instructions: [
              {
                type: 'TimelineAddEntries',
                entries: [
                  {
                    entryId: `cursor-top-${top}`,
                    content: {
                      __typename: 'TimelineTimelineCursor',
                      cursorType: 'Top',
                      value: top,
                    },
                  },
                  {
                    entryId: `promoted-tweet-${promotedId}`,
                    content: {
                      itemContent: {
                        promotedMetadata: { impression_id: promotedId },
                        tweet_results: {
                          result: {
                            __typename: 'Tweet',
                            rest_id: restId,
                            core: {
                              user_results: {
                                result: {
                                  __typename: 'User',
                                  rest_id: '9',
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                  {
                    entryId: `cursor-bottom-${bottom}`,
                    content: {
                      __typename: 'TimelineTimelineCursor',
                      cursorType: 'Bottom',
                      value: bottom,
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    })

    const page1 = makePage('TOP', 'CUR1', 'a', '900')
    const page2 = makePage('TOP2', 'CUR2', 'b', '901')

    const hideAll = {
      trusted: 'hideAll' as const,
      mixed: 'hideAll' as const,
      distrusted: 'hideAll' as const,
      none: 'hideAll' as const,
    }
    const filtered = filterTimelineGraphqlPayload(page1, {
      filters: hideAll,
      resolutions: {},
    })
    expect(countTimelineContentEntries(filtered.payload)).toBe(1)
    expect(readTimelineBottomCursor(filtered.payload)).toBe('CUR1')

    const pages: Record<string, unknown> = { CUR1: page2 }
    const backfilled = backfillFilteredTimeline({
      payload: filtered.payload,
      removed: filtered.removed,
      filters: hideAll,
      resolutions: {},
      minItems: 2,
      maxPages: 3,
      fetchNextPage: (cursor) => pages[cursor],
    })
    expect(backfilled.pagesFetched).toBe(1)
    expect(countTimelineContentEntries(backfilled.payload)).toBe(2)
    expect(readTimelineBottomCursor(backfilled.payload)).toBe('CUR2')
    // Ads-only result is relabeled so X's virtualizer keeps the items.
    const ids = (
      backfilled.payload as typeof page1
    ).data.home.home_timeline_urt.instructions[0]!.entries.map(
      (e: { entryId: string }) => e.entryId,
    )
    expect(ids).toEqual([
      'cursor-top-TOP',
      'tweet-a',
      'tweet-b',
      'cursor-bottom-CUR2',
    ])
    expect(backfilled.demotedAds.length).toBeGreaterThan(0)
  })

  it('emits collapse decorate targets without removing entries', () => {
    const { payload, removed, collapse } = processTimelineGraphqlPayload(
      homePayload,
      {
        filters: { ...DEFAULT_TRUST_FILTERS, none: 'collapseAll' },
        resolutions: {},
      },
    )
    expect(removed).toBe(0)
    expect(
      (payload as typeof homePayload).data.home.home_timeline_urt.instructions[0]!
        .entries,
    ).toHaveLength(4)
    expect(collapse['111']?.basis).toBe('author')
    expect(collapse['222']?.basis).toBe('author')
    expect(collapse['333']).toBeUndefined()
  })

  it('collects subjects for trust resolve', () => {
    const subjects = collectTimelineTweetSubjects(homePayload)
    expect(subjects).toEqual(
      expect.arrayContaining([
        { kind: 'user', id: '1' },
        { kind: 'post', id: '111' },
        { kind: 'user', id: '2' },
        { kind: 'post', id: '222' },
      ]),
    )
    // Promoted entries are not collected — hide always skips ads.
    expect(subjects.some((s) => s.id === '3' || s.id === '333')).toBe(false)
  })
})

describe('postTimelineFilterResolution', () => {
  it('classifies a post rating with the custom red / green cuts', () => {
    expect(
      postTimelineFilterResolution({
        ratingScore: 71,
        ratingBand: { red: 25, green: 60 },
      }),
    ).toBe('trusted')
    expect(
      postTimelineFilterResolution({
        ratingScore: 71,
        ratingBand: { red: 25, green: 75 },
      }),
    ).toBe('mixed')
    expect(
      postTimelineFilterResolution({
        ratingScore: 20,
        ratingBand: { red: 40, green: 75 },
      }),
    ).toBe('distrusted')
  })

  it('falls back to post trust when there is no rating score', () => {
    expect(
      postTimelineFilterResolution({ trustResolution: 'trusted' }),
    ).toBe('trusted')
    expect(postTimelineFilterResolution({})).toBe('none')
  })
})

describe('mergeTimelineJsonFilterResolutions', () => {
  it('uses author trust and post rating against the same band', () => {
    expect(
      mergeTimelineJsonFilterResolutions({
        subjects: [
          { kind: 'user', id: '1' },
          { kind: 'post', id: '111' },
        ],
        trustByKey: {
          [resolutionKey('user', '1')]: { resolution: 'mixed' },
          [resolutionKey('post', '111')]: { resolution: 'trusted' },
        },
        ratingByKey: {
          [resolutionKey('post', '111')]: {
            averageScore: 30,
            followTrustRed: 40,
            followTrustThreshold: 70,
          },
        },
      }),
    ).toEqual({
      [resolutionKey('user', '1')]: 'mixed',
      [resolutionKey('post', '111')]: 'distrusted',
    })
  })
})
