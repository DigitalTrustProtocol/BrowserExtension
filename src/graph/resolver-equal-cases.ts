/**
 * Graphs for the resolver-equality corpus. Numbers are filled by the
 * extension IndexResolver, not by hand.
 */

import type { FixtureCase, FixtureQuery, FixtureRecord } from './resolver-equal'

type Rec = FixtureRecord

function edge(
  id: string,
  from: string,
  to: string,
  value: number,
  extra: Partial<Rec> = {},
): Rec {
  return { id, from, to, value, ...extra }
}

function trustQuery(extra: Partial<FixtureQuery> = {}): FixtureQuery {
  return {
    root: '@root',
    subject: '@bob',
    subjectType: 'p',
    kind: 32009,
    context: 'identity',
    trustContext: 'identity',
    maxDepth: 4,
    threshold: 75,
    now: 100,
    format: 'default',
    ...extra,
  }
}

function withPath(query: FixtureQuery): FixtureQuery[] {
  return [query, { ...query, format: 'path' }]
}

function hopChain(length: number): Rec[] {
  const ids = ['@root', ...Array.from({ length }, (_, index) => `@h${index + 1}`)]
  const records: Rec[] = []
  for (let index = 0; index < length; index++) {
    const from = ids[index]!
    const to = ids[index + 1]!
    records.push(edge(`@c${length}-${index}`, from, to, 1))
  }
  return records
}

/** Authors @a @b @c @d at degree 1, then their statements about @alice. */
function peerVotes(votes: ReadonlyArray<readonly [string, number]>): Rec[] {
  const records: Rec[] = []
  for (const [author] of votes) {
    records.push(edge(`@root-${author.slice(1)}`, '@root', author, 1))
  }
  for (const [author, value] of votes) {
    records.push(edge(`@${author.slice(1)}-alice`, author, '@alice', value))
  }
  records.push(
    edge('@alice-post', '@alice', 'post:id:1', 1, { toType: 'i' }),
  )
  return records
}

export function resolverEqualCases(): FixtureCase[] {
  const cases: FixtureCase[] = []

  cases.push({
    id: 'missing-root',
    records: [edge('@e', '@alice', '@bob', 1)],
    queries: [trustQuery({ root: '@missing' })],
  })
  cases.push({
    id: 'missing-subject',
    records: [edge('@e', '@root', '@alice', 1)],
    queries: [trustQuery({ subject: '@missing' })],
  })
  cases.push({
    id: 'root-is-subject-no-incoming',
    records: [edge('@e', '@root', '@alice', 1)],
    queries: [trustQuery({ subject: '@root' })],
  })
  cases.push({
    id: 'root-is-subject-incoming-at-degree-2',
    records: [
      edge('@root-alice', '@root', '@alice', 1),
      edge('@alice-root', '@alice', '@root', 1),
    ],
    queries: withPath(trustQuery({ subject: '@root' })),
  })

  cases.push({
    id: 'direct-trust',
    records: [edge('@e', '@root', '@bob', 1)],
    queries: withPath(trustQuery()),
  })
  cases.push({
    id: 'direct-neutral',
    records: [edge('@e', '@root', '@bob', 0)],
    queries: withPath(trustQuery()),
  })
  cases.push({
    id: 'direct-distrust',
    records: [edge('@e', '@root', '@bob', -1)],
    queries: withPath(trustQuery()),
  })

  cases.push({
    id: 'degree-2-both-trust',
    records: [
      edge('@root-alice', '@root', '@alice', 1),
      edge('@root-carol', '@root', '@carol', 1),
      edge('@alice-bob', '@alice', '@bob', 1),
      edge('@carol-bob', '@carol', '@bob', 1),
    ],
    queries: withPath(trustQuery()),
  })
  cases.push({
    id: 'degree-2-trust-and-distrust',
    records: [
      edge('@root-alice', '@root', '@alice', 1),
      edge('@root-carol', '@root', '@carol', 1),
      edge('@alice-bob', '@alice', '@bob', 1),
      edge('@carol-bob', '@carol', '@bob', -1),
    ],
    queries: [trustQuery()],
  })
  cases.push({
    id: 'degree-2-trust-and-neutral',
    records: [
      edge('@root-alice', '@root', '@alice', 1),
      edge('@root-carol', '@root', '@carol', 1),
      edge('@alice-bob', '@alice', '@bob', 1),
      edge('@carol-bob', '@carol', '@bob', 0),
    ],
    queries: [trustQuery()],
  })
  cases.push({
    id: 'neutral-does-not-connect-farther-trust-does',
    records: [
      edge('@root-alice', '@root', '@alice', 1),
      edge('@alice-bob-neutral', '@alice', '@bob', 0),
      edge('@alice-carol', '@alice', '@carol', 1),
      edge('@carol-bob', '@carol', '@bob', 1),
    ],
    queries: [trustQuery()],
  })

  const threeOne = peerVotes([
    ['@a', 1],
    ['@b', 1],
    ['@c', 1],
    ['@d', -1],
  ])
  const twoOne = peerVotes([
    ['@a', 1],
    ['@b', 1],
    ['@d', -1],
  ])
  cases.push({
    id: 'threshold-75-three-trust-one-distrust-hops',
    records: threeOne,
    queries: [trustQuery({ subject: 'post:id:1', subjectType: 'i', threshold: 75 })],
  })
  cases.push({
    id: 'threshold-100-three-trust-one-distrust-blocks',
    records: threeOne,
    queries: [trustQuery({ subject: 'post:id:1', subjectType: 'i', threshold: 100 })],
  })
  cases.push({
    id: 'threshold-75-two-trust-one-distrust-blocks',
    records: twoOne,
    queries: [trustQuery({ subject: 'post:id:1', subjectType: 'i', threshold: 75 })],
  })
  cases.push({
    id: 'threshold-1-two-trust-one-distrust-hops',
    records: twoOne,
    queries: [trustQuery({ subject: 'post:id:1', subjectType: 'i', threshold: 1 })],
  })

  cases.push({
    id: 'distrust-does-not-extend',
    records: [
      edge('@root-alice', '@root', '@alice', -1),
      edge('@alice-post', '@alice', 'post:id:2', 1, { toType: 'i' }),
    ],
    queries: [trustQuery({ subject: 'post:id:2', subjectType: 'i' })],
  })
  cases.push({
    id: 'neutral-does-not-extend',
    records: [
      edge('@root-alice', '@root', '@alice', 0),
      edge('@alice-post', '@alice', 'post:id:3', 1, { toType: 'i' }),
    ],
    queries: [trustQuery({ subject: 'post:id:3', subjectType: 'i' })],
  })
  cases.push({
    id: 'rating-does-not-extend',
    records: [
      edge('@root-alice', '@root', '@alice', 80, { kind: 32014 }),
      edge('@alice-post', '@alice', 'post:id:4', 1, { toType: 'i' }),
    ],
    queries: [trustQuery({ subject: 'post:id:4', subjectType: 'i' })],
  })
  cases.push({
    id: 'unbound-user-id-is-terminal',
    mode: 'strict',
    records: [
      edge('@root-x', '@root', 'user:id:7', 1, { toType: 'i', hint: '@alice' }),
      edge('@alice-post', '@alice', 'post:id:7', 1, { toType: 'i' }),
    ],
    queries: [
      trustQuery({ subject: 'user:id:7', subjectType: 'i' }),
      trustQuery({ subject: 'post:id:7', subjectType: 'i' }),
    ],
  })

  for (const length of [1, 2, 3, 4, 5, 7] as const) {
    cases.push({
      id: `chain-${length}-max-depth-7`,
      records: hopChain(length),
      queries: [
        trustQuery({
          subject: `@h${length}`,
          maxDepth: 7,
          ...(length === 3 ? { format: 'default' } : {}),
        }),
        ...(length === 3
          ? [trustQuery({ subject: `@h${length}`, maxDepth: 7, format: 'path' })]
          : []),
      ],
    })
  }
  cases.push({
    id: 'chain-5-misses-at-max-depth-4',
    records: hopChain(5),
    queries: [trustQuery({ subject: '@h5', maxDepth: 4 })],
  })
  cases.push({
    id: 'chain-2-misses-at-max-depth-1',
    records: hopChain(2),
    queries: [trustQuery({ subject: '@h2', maxDepth: 1 })],
  })

  cases.push({
    id: 'nearest-trust-hides-farther-distrust',
    records: [
      edge('@root-bob', '@root', '@bob', 1),
      edge('@root-alice', '@root', '@alice', 1),
      edge('@alice-bob', '@alice', '@bob', -1),
    ],
    queries: [trustQuery()],
  })
  cases.push({
    id: 'nearest-distrust-hides-farther-trust',
    records: [
      edge('@root-bob', '@root', '@bob', -1),
      edge('@root-alice', '@root', '@alice', 1),
      edge('@alice-bob', '@alice', '@bob', 1),
    ],
    queries: [trustQuery()],
  })

  cases.push({
    id: 'context-exact',
    records: [edge('@e', '@root', '@bob', 1, { context: 'security:audit' })],
    queries: [trustQuery({ context: 'security:audit' })],
  })
  cases.push({
    id: 'context-parent',
    records: [edge('@e', '@root', '@bob', 1, { context: 'security' })],
    queries: [trustQuery({ context: 'security:audit' })],
  })
  cases.push({
    id: 'context-empty-bucket',
    records: [edge('@e', '@root', '@bob', 1, { context: '' })],
    queries: [trustQuery({ context: 'identity' })],
  })
  cases.push({
    id: 'context-exact-neutral-and-parent-trust',
    records: [
      edge('@exact', '@root', '@bob', 0, { context: 'security:audit' }),
      edge('@parent', '@root', '@bob', 1, { context: '' }),
    ],
    queries: [trustQuery({ context: 'security:audit' })],
  })

  cases.push({
    id: 'first-inserted-slot-wins',
    records: [
      edge('@neg', '@root', '@bob', -1, { createdAt: 10, scopeRank: 1 }),
      edge('@pos', '@root', '@bob', 1, { createdAt: 5, scopeRank: 2 }),
    ],
    queries: [trustQuery()],
  })

  cases.push({
    id: 'delete-drops-older-slot-keeps-newer',
    records: [
      edge('@old', '@root', '@bob', 1, { createdAt: 10 }),
      edge('@new', '@root', '@bob', 1, { createdAt: 40 }),
      {
        id: '@old-delete',
        slot: '@old',
        from: '@root',
        to: '@bob',
        delete: true,
        createdAt: 30,
      },
    ],
    queries: [trustQuery()],
  })

  cases.push({
    id: 'inactive-before-activate',
    records: [edge('@e', '@root', '@bob', 1, { activate: 200 })],
    queries: [trustQuery({ now: 100 })],
  })
  cases.push({
    id: 'inactive-after-expire',
    records: [edge('@e', '@root', '@bob', 1, { expire: 50 })],
    queries: [trustQuery({ now: 100 })],
  })
  cases.push({
    id: 'active-on-inclusive-bounds',
    records: [edge('@e', '@root', '@bob', 1, { activate: 100, expire: 100 })],
    queries: [trustQuery({ now: 100 })],
  })

  cases.push({
    id: 'self-loop',
    records: [edge('@e', '@root', '@root', 1)],
    queries: [trustQuery({ subject: '@root' })],
  })

  cases.push({
    id: 'rating-direct',
    records: [edge('@e', '@root', 'post:id:9', 80, { kind: 32014, toType: 'i' })],
    queries: [
      trustQuery({
        subject: 'post:id:9',
        subjectType: 'i',
        kind: 32014,
        context: '',
      }),
    ],
  })
  cases.push({
    id: 'rating-through-trust-hop',
    records: [
      edge('@root-alice', '@root', '@alice', 1),
      edge('@alice-rate', '@alice', 'post:id:9', 40, { kind: 32014, toType: 'i', context: '' }),
      edge('@foe-rate', '@foe', 'post:id:9', 100, { kind: 32014, toType: 'i', context: '' }),
      edge('@root-foe', '@root', '@foe', -1),
    ],
    queries: withPath(
      trustQuery({
        subject: 'post:id:9',
        subjectType: 'i',
        kind: 32014,
        context: '',
      }),
    ),
  })
  cases.push({
    id: 'rating-empty-context-visible-to-identity-query',
    records: [edge('@e', '@root', 'post:id:9', 70, { kind: 32014, toType: 'i', context: '' })],
    queries: [
      trustQuery({
        subject: 'post:id:9',
        subjectType: 'i',
        kind: 32014,
        context: 'identity',
      }),
    ],
  })

  cases.push({
    id: 'lenient-own-bio-binds',
    mode: 'lenient',
    ownEvidence: [{ i: 'user:id:42', pubkey: '@alice', source: 'bio' }],
    records: [
      edge('@on-x', '@root', 'user:id:42', 1, { toType: 'i' }),
      edge('@on-p', '@carol', '@alice', -1),
    ],
    queries: [trustQuery({ subject: 'user:id:42', subjectType: 'i' })],
  })
  cases.push({
    id: 'lenient-witness-binds-without-claim',
    mode: 'lenient',
    records: [
      edge('@witness', '@bob', 'user:id:42', 1, { toType: 'i', hint: '@alice' }),
      edge('@root-bob', '@root', '@bob', 1),
      edge('@alice-post', '@alice', 'post:id:42', 1, { toType: 'i' }),
    ],
    queries: [
      trustQuery({ subject: 'user:id:42', subjectType: 'i' }),
      trustQuery({ subject: 'post:id:42', subjectType: 'i' }),
    ],
  })
  cases.push({
    id: 'lenient-two-x-ids-one-pubkey',
    mode: 'lenient',
    ownEvidence: [
      { i: 'user:id:1', pubkey: '@alice', source: 'bio' },
      { i: 'user:id:2', pubkey: '@alice', source: 'post' },
    ],
    records: [
      edge('@on-1', '@root', 'user:id:1', 1, { toType: 'i' }),
      edge('@on-2', '@carol', 'user:id:2', -1, { toType: 'i' }),
    ],
    queries: [trustQuery({ subject: '@alice' })],
  })
  cases.push({
    id: 'strict-witness-without-claim-does-not-bind',
    mode: 'strict',
    records: [
      edge('@witness', '@bob', 'user:id:42', 1, { toType: 'i', hint: '@alice' }),
      edge('@root-bob', '@root', '@bob', 1),
      edge('@alice-post', '@alice', 'post:id:42', 1, { toType: 'i' }),
    ],
    queries: [
      trustQuery({ subject: 'user:id:42', subjectType: 'i' }),
      trustQuery({ subject: 'post:id:42', subjectType: 'i' }),
    ],
  })
  cases.push({
    id: 'strict-witness-plus-claim-binds',
    mode: 'strict',
    claims: [{ pubkey: '@alice', twitterId: '42' }],
    records: [
      edge('@witness', '@bob', 'user:id:42', 1, { toType: 'i', hint: '@alice' }),
      edge('@root-bob', '@root', '@bob', 1),
      edge('@alice-post', '@alice', 'post:id:42', 1, { toType: 'i' }),
    ],
    queries: [trustQuery({ subject: 'post:id:42', subjectType: 'i' })],
  })

  cases.push({
    id: 'time-expired-before-degree-1',
    records: [edge('@e', '@root', '@bob', 1)],
    queries: [trustQuery({ deadline: 0 })],
  })
  cases.push({
    id: 'time-allows-degree-1-hit',
    records: [edge('@e', '@root', '@bob', 1)],
    queries: [trustQuery({ deadline: 1 })],
  })
  cases.push({
    id: 'time-stops-before-the-hitting-degree',
    records: [
      edge('@root-alice', '@root', '@alice', 1),
      edge('@alice-post', '@alice', 'post:id:8', 1, { toType: 'i' }),
    ],
    queries: [trustQuery({ subject: 'post:id:8', subjectType: 'i', deadline: 1 })],
  })

  cases.push({
    id: 'path-omits-distrust-branch',
    records: [
      edge('@root-skip', '@root', '@skip', -1),
      edge('@skip-bob', '@skip', '@bob', 1),
      edge('@root-alice', '@root', '@alice', 1),
      edge('@alice-bob', '@alice', '@bob', 1),
    ],
    queries: withPath(trustQuery()),
  })

  return cases
}
