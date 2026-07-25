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
                            legacy: {
                              screen_name: 'NASA',
                              name: 'NASA',
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

export const unrelatedJsonFixture = {
  account: {
    rest_id: '42',
    legacy: {
      name: 'No screen name is paired with this ID',
    },
  },
  screen_name: 'not_paired',
}
