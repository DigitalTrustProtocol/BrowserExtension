import { describe, expect, it } from 'vitest'
import {
  extractCreateTweetProof,
  isCreateTweetOperation,
} from './proof-capture'

const PROOF = 'Linking my account to Nostr: npub1abc'

describe('proof capture', () => {
  it('recognizes CreateTweet operations', () => {
    expect(isCreateTweetOperation('CreateTweet')).toBe(true)
    expect(isCreateTweetOperation('CreateNoteTweet')).toBe(true)
    expect(isCreateTweetOperation('TweetDetail')).toBe(false)
  })

  it('extracts a matching CreateTweet proof post and rejects mismatches', () => {
    const payload = {
      data: {
        create_tweet: {
          tweet_results: {
            result: {
              rest_id: '2080659774136291424',
              legacy: {
                full_text: `Before\n${PROOF}\nAfter`,
                id_str: '2080659774136291424',
              },
              core: {
                user_results: {
                  result: {
                    rest_id: '11348282',
                    legacy: { screen_name: 'NASA' },
                  },
                },
              },
            },
          },
        },
      },
    }

    expect(extractCreateTweetProof(payload, PROOF, 'nasa')).toEqual({
      postId: '2080659774136291424',
      fullText: `Before\n${PROOF}\nAfter`,
      handle: 'nasa',
      twitterId: '11348282',
    })
    expect(extractCreateTweetProof(payload, PROOF, 'other')).toBeUndefined()
    expect(
      extractCreateTweetProof(payload, 'different proof text', 'nasa'),
    ).toBeUndefined()
  })
})
