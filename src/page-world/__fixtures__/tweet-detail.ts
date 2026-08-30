export const tweetDetailFixture = {
  data: {
    threaded_conversation_with_injections_v2: {
      instructions: [
        {
          entries: [
            {
              content: {
                itemContent: {
                  tweet_results: {
                    result: {
                      __typename: 'Tweet',
                      rest_id: '2080659774136291424',
                      legacy: {
                        full_text: 'Public post text that must never be emitted.',
                      },
                      core: {
                        user_results: {
                          result: {
                            __typename: 'User',
                            rest_id: '11348282',
                            is_blue_verified: true,
                            legacy: {
                              screen_name: 'NASA',
                              name: 'NASA',
                              verified: true,
                              verified_type: 'Government',
                              profile_image_url_https:
                                'https://pbs.twimg.com/profile_images/11348282/nasa_normal.jpg',
                              profile_banner_url:
                                'https://pbs.twimg.com/profile_banners/11348282/1700000000',
                              description:
                                'Profile text that must never be emitted.',
                            },
                            private_data: {
                              token: 'must-not-be-forwarded',
                            },
                          },
                        },
                      },
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
}

/**
 * Realistic TweetDetail reply shape: VerticalConversation module with
 * item → itemContent → TweetWithVisibilityResults → tweet → user.
 * Deeper than a focal TimelineItem; maxDepth must reach the reply author.
 */
export const tweetDetailConversationFixture = {
  data: {
    threaded_conversation_with_injections_v2: {
      instructions: [
        {
          type: 'TimelineAddEntries',
          entries: [
            {
              entryId: 'tweet-2080659774136291424',
              content: {
                __typename: 'TimelineTimelineItem',
                itemContent: {
                  __typename: 'TimelineTweet',
                  tweet_results: {
                    result: {
                      __typename: 'Tweet',
                      rest_id: '2080659774136291424',
                      legacy: {
                        full_text: 'Focal post text that must never be emitted.',
                      },
                      core: {
                        user_results: {
                          result: {
                            __typename: 'User',
                            rest_id: '11348282',
                            legacy: { screen_name: 'NASA' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            {
              entryId: 'conversationthread-2080659774136291999',
              content: {
                __typename: 'TimelineTimelineModule',
                displayType: 'VerticalConversation',
                items: [
                  {
                    entryId:
                      'conversationthread-2080659774136291999-tweet-2080659774136291999',
                    item: {
                      itemContent: {
                        __typename: 'TimelineTweet',
                        tweet_results: {
                          result: {
                            __typename: 'TweetWithVisibilityResults',
                            tweet: {
                              __typename: 'Tweet',
                              rest_id: '2080659774136291999',
                              legacy: {
                                full_text:
                                  'Reply text that must never be emitted.',
                              },
                              core: {
                                user_results: {
                                  result: {
                                    __typename: 'User',
                                    rest_id: '44196397',
                                    legacy: null,
                                    core: {
                                      screen_name: 'CommenterOne',
                                      name: 'Commenter',
                                    },
                                    private_data: {
                                      token: 'must-not-be-forwarded',
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                  {
                    entryId:
                      'conversationthread-2080659774136291999-tweet-2080659774136292000',
                    item: {
                      itemContent: {
                        __typename: 'TimelineTweet',
                        tweet_results: {
                          result: {
                            __typename: 'Tweet',
                            rest_id: '2080659774136292000',
                            legacy: {
                              full_text:
                                'Nested reply text that must never be emitted.',
                            },
                            core: {
                              user_results: {
                                result: {
                                  __typename: 'User',
                                  rest_id: '783214',
                                  legacy: { screen_name: 'nested_reply' },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  },
}

/** X 2026 schema: legacy is null and identity fields live under core. */
export const homeTimeline2026Fixture = {
  data: {
    home: {
      home_timeline_urt: {
        instructions: [
          {
            type: 'TimelineAddEntries',
            entries: [
              {
                content: {
                  itemContent: {
                    tweet_results: {
                      result: {
                        __typename: 'Tweet',
                        rest_id: '2080659774136291424',
                        legacy: null,
                        full_text: 'Public post text that must never be emitted.',
                        core: {
                          user_results: {
                            result: {
                              __typename: 'User',
                              rest_id: '11348282',
                              legacy: {
                                screen_name: null,
                                name: null,
                                description:
                                  'Profile text that must never be emitted.',
                              },
                              core: {
                                screen_name: 'NASA',
                                name: 'NASA',
                              },
                              private_data: {
                                token: 'must-not-be-forwarded',
                              },
                            },
                          },
                        },
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
}

/** Author bio carries a single discoverable npub alongside private data. */
export const tweetDetailBioNpubFixture = {
  data: {
    threaded_conversation_with_injections_v2: {
      instructions: [
        {
          entries: [
            {
              content: {
                itemContent: {
                  tweet_results: {
                    result: {
                      __typename: 'Tweet',
                      rest_id: '2080659774136291424',
                      legacy: {
                        full_text: 'Public post text that must never be emitted.',
                        created_at: 'Wed Oct 10 20:19:24 +0000 2018',
                      },
                      core: {
                        user_results: {
                          result: {
                            __typename: 'User',
                            rest_id: '11348282',
                            legacy: {
                              screen_name: 'NASA',
                              name: 'NASA',
                              description: `Space agency. Nostr: npub1${'q'.repeat(60)}`,
                            },
                            private_data: {
                              token: 'must-not-be-forwarded',
                            },
                          },
                        },
                      },
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
}

export const unrelatedJsonFixture = {
  account: {
    rest_id: '42',
    legacy: {
      name: 'No screen name is paired with this ID',
    },
  },
  screen_name: 'not_paired',
}
