import { describe, expect, it } from 'vitest'
import {
  buildLinkingProofText,
  LINKING_PROOF_PREFIX,
} from '../shared/proof-composer'
import {
  buildProofSearchQuery,
  buildProofSearchQueryFromCriteria,
  buildProofSearchUrl,
  extractProofFromSearchTimeline,
  extractProofFromSearchTimelineWithCriteria,
  isSearchTimelineOperation,
  parseProofSearchPageMessage,
  parseProofSearchHostMessage,
  pickLatestProofPost,
  resolveProofSearchCriteria,
} from './proof-search'

const NPUB =
  'npub1aten0ysxqss2647qfte24kvy69s8zszweljf59te3kwcpv997nyqxrq4tx'
const PROOF = buildLinkingProofText(NPUB)

describe('proof search from SearchTimeline JSON', () => {
  it('builds a from:handle live search query', () => {
    expect(buildProofSearchQuery('Keutmann', PROOF)).toBe(
      `from:keutmann "${PROOF}"`,
    )
    expect(buildProofSearchUrl('Keutmann', PROOF)).toContain(
      'https://x.com/search?',
    )
    expect(isSearchTimelineOperation('SearchTimeline')).toBe(true)
    expect(isSearchTimelineOperation('HomeTimeline')).toBe(false)
  })

  it('resolves npub vs prefix search criteria', () => {
    expect(
      resolveProofSearchCriteria({
        expectedHandle: 'Keutmann',
        expectedNpub: NPUB,
      }),
    ).toEqual({
      expectedHandle: 'keutmann',
      searchPhrase: NPUB,
      matchText: PROOF,
      expectedNpub: NPUB,
    })
    expect(
      resolveProofSearchCriteria({ expectedHandle: 'keutmann' }),
    ).toEqual({
      expectedHandle: 'keutmann',
      searchPhrase: LINKING_PROOF_PREFIX,
      matchText: LINKING_PROOF_PREFIX,
    })
    expect(
      buildProofSearchQueryFromCriteria(
        resolveProofSearchCriteria({
          expectedHandle: 'keutmann',
          expectedNpub: NPUB,
        })!,
      ),
    ).toBe(`from:keutmann "${NPUB}"`)
  })

  it('parses run-proof-search page messages', () => {
    expect(
      parseProofSearchPageMessage({
        source: 'attentionx-proof-search',
        version: 1,
        type: 'run-proof-search',
        expectedNpub: NPUB,
        expectedHandle: 'keutmann',
      }),
    ).toMatchObject({
      type: 'run-proof-search',
      expectedHandle: 'keutmann',
      expectedNpub: NPUB,
    })
    expect(
      parseProofSearchPageMessage({
        source: 'attentionx-proof-search',
        version: 1,
        type: 'run-proof-search',
        expectedHandle: 'keutmann',
      }),
    ).toMatchObject({ type: 'run-proof-search', expectedHandle: 'keutmann' })
    expect(
      parseProofSearchPageMessage({
        source: 'attentionx-proof-search',
        version: 1,
        type: 'enable-proof-search',
        expectedProofText: PROOF,
        expectedHandle: 'keutmann',
      }),
    ).toBeUndefined()
  })

  it('parses proof-search-empty host messages', () => {
    expect(
      parseProofSearchHostMessage({
        source: 'attentionx-proof-search',
        version: 1,
        type: 'proof-search-empty',
        handle: 'keutmann',
        reason: 'no-matching-post',
        query: 'from:keutmann "npub1abc"',
      }),
    ).toEqual({
      source: 'attentionx-proof-search',
      version: 1,
      type: 'proof-search-empty',
      handle: 'keutmann',
      reason: 'no-matching-post',
      query: 'from:keutmann "npub1abc"',
    })
    expect(
      parseProofSearchHostMessage({
        source: 'attentionx-proof-search',
        version: 1,
        type: 'proof-search-found',
        postId: '1',
        handle: 'keutmann',
        fullText: PROOF,
      }),
    ).toMatchObject({ type: 'proof-search-found', postId: '1' })
  })

  it('picks the latest matching proof post', () => {
    expect(
      pickLatestProofPost([
        {
          postId: '100',
          handle: 'keutmann',
          fullText: PROOF,
        },
        {
          postId: '2081383361348599871',
          handle: 'keutmann',
          fullText: PROOF,
        },
        {
          postId: '200',
          handle: 'keutmann',
          fullText: PROOF,
        },
      ])?.postId,
    ).toBe('2081383361348599871')
  })

  it('extracts a matching proof post from SearchTimeline payload', () => {
    const payload = {
      data: {
        search_by_raw_query: {
          search_timeline: {
            timeline: {
              instructions: [
                {
                  entries: [
                    {
                      content: {
                        itemContent: {
                          tweet_results: {
                            result: {
                              rest_id: '100',
                              legacy: {
                                full_text: PROOF,
                                id_str: '100',
                              },
                            },
                          },
                        },
                      },
                    },
                    {
                      content: {
                        itemContent: {
                          tweet_results: {
                            result: {
                              rest_id: '2081383361348599871',
                              legacy: {
                                full_text: PROOF,
                                id_str: '2081383361348599871',
                              },
                              // No screen_name — SearchTimeline often omits usable
                              // user fields; from:handle already scoped the query.
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    }

    expect(extractProofFromSearchTimeline(payload, PROOF, 'keutmann')).toEqual({
      postId: '2081383361348599871',
      handle: 'keutmann',
      fullText: PROOF,
    })
    expect(
      extractProofFromSearchTimelineWithCriteria(payload, {
        expectedHandle: 'keutmann',
        searchPhrase: NPUB,
        matchText: PROOF,
      }),
    ).toMatchObject({ postId: '2081383361348599871' })
  })
})
