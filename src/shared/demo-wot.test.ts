import { describe, expect, it } from 'vitest'
import {
  DEMO_WOT_AUTHORS_PER_DEGREE,
  DEMO_WOT_CHAIN,
  DEMO_WOT_DEGREE1_CHORUS,
  DEMO_WOT_MAX_DEPTH,
  DEMO_WOT_MAX_STATEMENTS,
  DEMO_WOT_MAX_TRUSTS_PER_USER,
  DEMO_WOT_MAX_USER_SUBJECTS,
  DEMO_WOT_ROOT_DIRECT_POSTS,
  DEMO_WOT_ROOT_DIRECT_USERS,
  demoTrustsPerUser,
  demoWotAuthorHops,
  demoWotAuthorProfile,
  demoWotMissingChainMembers,
  demoWotStatementContent,
  demoWotSubjectDegree,
  isDemoWotChainTwitterId,
  isDemoWotEvent,
  materializeDemoSubject,
  planDemoWotNetwork,
} from './demo-wot'

function chainMember(handle: string) {
  const member = DEMO_WOT_CHAIN.find((row) => row.handle === handle)
  if (!member) throw new Error(`missing chain member ${handle}`)
  return member
}

function extraCount(twitterIds: readonly string[]): number {
  const chainIds = new Set(DEMO_WOT_CHAIN.map((row) => row.twitterId))
  return Math.min(
    DEMO_WOT_DEGREE1_CHORUS,
    twitterIds.filter((id) => !chainIds.has(id)).length,
  )
}

function hop1Count(twitterIds: readonly string[] = []): number {
  return 1 + extraCount(twitterIds)
}

function fakeAuthorCount(twitterIds: readonly string[] = []): number {
  return DEMO_WOT_CHAIN.length + extraCount(twitterIds)
}

describe('planDemoWotNetwork', () => {
  it('always includes the Elon→NASA chain even with no observed identities', () => {
    const plan = planDemoWotNetwork({ twitterIds: [] })
    expect(plan.userSubjects).toBe(DEMO_WOT_CHAIN.length)
    expect(plan.maxDepth).toBe(DEMO_WOT_MAX_DEPTH)
    expect(plan.fakeAuthorCount).toBe(fakeAuthorCount([]))
    expect(plan.authors).toHaveLength(DEMO_WOT_CHAIN.length)
    expect(plan.authors[0]).toMatchObject({
      twitterId: chainMember('elonmusk').twitterId,
      hop: 1,
    })
    expect(plan.authors[1]?.twitterId).toBe(chainMember('spacex').twitterId)
    expect(plan.postSubjects).toBe(0)
    expect(
      plan.statements.every((row) => row.content.trim().length > 0),
    ).toBe(true)
    expect(plan.statements.length).toBeGreaterThan(0)
    expect(plan.statements.length).toBeLessThanOrEqual(DEMO_WOT_MAX_STATEMENTS)
    expect(plan.ratings).toHaveLength(0)
    expect(demoWotSubjectDegree(plan, {
      type: 'user',
      twitterId: chainMember('elonmusk').twitterId,
    })).toBe(1)
    expect(demoWotSubjectDegree(plan, {
      type: 'user',
      twitterId: chainMember('nasa').twitterId,
    })).toBe(4)

    const elonUserTrusts = plan.statements.filter(
      (row) =>
        row.subject.type === 'user' &&
        row.subject.twitterId === chainMember('elonmusk').twitterId,
    )
    expect(elonUserTrusts.length).toBe(hop1Count([]))
    expect(elonUserTrusts.some((row) => row.authorIndex === -1)).toBe(true)
    expect(
      elonUserTrusts.filter((row) => row.authorIndex !== -1).length,
    ).toBe(extraCount([]))
  })

  it('makes Elon the hop-1 author who trusts SpaceX', () => {
    const extras = Array.from({ length: 8 }, (_, i) => ({
      twitterId: String(1000 + i),
      handle: `user${i}`,
      displayName: `User ${i}`,
      lastSeen: 10 - i,
    }))
    const plan = planDemoWotNetwork({ users: extras })
    expect(plan.authors[0]?.twitterId).toBe(chainMember('elonmusk').twitterId)
    expect(plan.authors[1]?.twitterId).toBe(chainMember('spacex').twitterId)

    const spacexUserTrusts = plan.statements.filter(
      (row) =>
        row.subject.type === 'user' &&
        row.subject.twitterId === chainMember('spacex').twitterId,
    )
    expect(spacexUserTrusts).toEqual([
      expect.objectContaining({ authorIndex: 0, value: '1' }),
    ])

    const pToSpacex = plan.statements.filter(
      (row) =>
        row.subject.type === 'p' &&
        row.subject.authorIndex === 1 &&
        row.value === '1',
    )
    expect(pToSpacex).toEqual([
      expect.objectContaining({ authorIndex: 0 }),
    ])
  })

  it('only trusts users already in the identity set or the Elon chain', () => {
    const plan = planDemoWotNetwork({
      users: [{ twitterId: '111', lastSeen: 2 }],
    })
    const trustedUsers = new Set(
      plan.statements.flatMap((row) =>
        row.subject.type === 'user' ? [row.subject.twitterId] : [],
      ),
    )
    expect(trustedUsers.has('111')).toBe(true)
    for (const member of DEMO_WOT_CHAIN) {
      expect(trustedUsers.has(member.twitterId)).toBe(true)
    }
    expect(trustedUsers.size).toBe(1 + DEMO_WOT_CHAIN.length)
  })

  it('does not invent post subjects and skips posts whose author is unknown', () => {
    const plan = planDemoWotNetwork({
      users: [{ twitterId: '111', lastSeen: 1 }],
      posts: [
        { postId: '9001', authorTwitterId: '111', lastSeen: 5 },
        { postId: '9002', authorTwitterId: '999', lastSeen: 4 },
        { postId: '9003', lastSeen: 3 },
      ],
    })
    const trustedPosts = new Set(
      plan.statements.flatMap((row) =>
        row.subject.type === 'post' ? [row.subject.postId] : [],
      ),
    )
    expect(trustedPosts.has('9001')).toBe(true)
    expect(trustedPosts.has('9002')).toBe(false)
    expect(trustedPosts.has('9003')).toBe(false)
    expect([...trustedPosts]).toEqual(['9001'])
    expect(plan.postSubjects).toBe(1)
  })

  it('keeps Elon 1, SpaceX 2, Tesla 3, NASA 4 with no shortcuts', () => {
    const ids = Array.from({ length: 20 }, (_, i) => String(1000 + i))
    const plan = planDemoWotNetwork({ twitterIds: ids })

    expect(demoWotSubjectDegree(plan, {
      type: 'user',
      twitterId: chainMember('elonmusk').twitterId,
    })).toBe(1)
    expect(demoWotSubjectDegree(plan, {
      type: 'user',
      twitterId: chainMember('spacex').twitterId,
    })).toBe(2)
    expect(demoWotSubjectDegree(plan, {
      type: 'user',
      twitterId: chainMember('tesla').twitterId,
    })).toBe(3)
    expect(demoWotSubjectDegree(plan, {
      type: 'user',
      twitterId: chainMember('nasa').twitterId,
    })).toBe(4)

    const hops = demoWotAuthorHops(plan)
    expect(Math.max(...[...hops.values()])).toBe(DEMO_WOT_MAX_DEPTH)
    expect(hops.size - 1).toBe(plan.fakeAuthorCount)

    for (const member of plan.chain) {
      const minHop = member.degree - 1
      for (const row of plan.statements) {
        if (row.subject.type !== 'user') continue
        if (row.subject.twitterId !== member.twitterId) continue
        const hop = row.authorIndex === -1 ? 0 : hops.get(row.authorIndex)
        expect(hop).toBeDefined()
        expect(hop!).toBeGreaterThanOrEqual(minHop)
      }
    }
  })

  it('densely trusts and rates Elon and SpaceX latest posts at hop 1', () => {
    const elonPosts = Array.from({ length: 5 }, (_, i) => ({
      postId: String(9_000 + i),
      authorTwitterId: chainMember('elonmusk').twitterId,
      lastSeen: 100 + i,
    }))
    const spacexPosts = Array.from({ length: 4 }, (_, i) => ({
      postId: String(8_000 + i),
      authorTwitterId: chainMember('spacex').twitterId,
      lastSeen: 50 + i,
    }))
    const teslaPosts = Array.from({ length: 3 }, (_, i) => ({
      postId: String(7_000 + i),
      authorTwitterId: chainMember('tesla').twitterId,
      lastSeen: 10 + i,
    }))
    const plan = planDemoWotNetwork({
      twitterIds: ['111'],
      posts: [...elonPosts, ...spacexPosts, ...teslaPosts],
    })

    const elonLatest = plan.chain[0]!.latestPostId!
    const spacexLatest = plan.chain[1]!.latestPostId!
    expect(elonLatest).toBe('9004')
    expect(spacexLatest).toBe('8003')

    const expectedHop1 = hop1Count(['111'])
    const elonLatestTrusts = plan.statements.filter(
      (row) =>
        row.subject.type === 'post' &&
        row.subject.postId === elonLatest &&
        row.value === '1',
    )
    const spacexLatestTrusts = plan.statements.filter(
      (row) =>
        row.subject.type === 'post' &&
        row.subject.postId === spacexLatest &&
        row.value === '1',
    )
    expect(elonLatestTrusts.length).toBe(expectedHop1)
    expect(spacexLatestTrusts.length).toBe(expectedHop1)
    expect(elonLatestTrusts.every((row) => row.authorIndex !== -1)).toBe(true)
    expect(spacexLatestTrusts.every((row) => row.authorIndex !== -1)).toBe(
      true,
    )
    expect(demoWotSubjectDegree(plan, { type: 'post', postId: elonLatest })).toBe(
      2,
    )
    expect(
      demoWotSubjectDegree(plan, { type: 'post', postId: spacexLatest }),
    ).toBe(2)

    expect(
      plan.ratings.filter((row) => row.subject.postId === elonLatest).length,
    ).toBe(expectedHop1)
    expect(
      plan.ratings.filter((row) => row.subject.postId === spacexLatest).length,
    ).toBe(expectedHop1)

    // Only the latest post per chain account is trusted or rated.
    const ratedPosts = new Set(plan.ratings.map((row) => row.subject.postId))
    expect([...ratedPosts].sort()).toEqual(['7002', '8003', '9004'])
    for (const postId of ['9000', '9001', '8000', '7000']) {
      expect(
        plan.ratings.some((row) => row.subject.postId === postId),
      ).toBe(false)
      expect(
        plan.statements.some(
          (row) => row.subject.type === 'post' && row.subject.postId === postId,
        ),
      ).toBe(false)
    }

    // Tesla's latest post is rated at hop 2 (SpaceX), keeping degree 3.
    expect(
      plan.ratings.some((row) => row.subject.postId === '7002'),
    ).toBe(true)
    expect(demoWotSubjectDegree(plan, { type: 'post', postId: '7002' })).toBe(3)
  })

  it('does not let root or hop-1 authors shorten Tesla or NASA', () => {
    const plan = planDemoWotNetwork({ twitterIds: ['111', '222'] })
    const hops = demoWotAuthorHops(plan)
    const teslaId = chainMember('tesla').twitterId
    const nasaId = chainMember('nasa').twitterId

    for (const row of plan.statements) {
      if (row.subject.type !== 'user') continue
      const hop = row.authorIndex === -1 ? 0 : hops.get(row.authorIndex)
      if (row.subject.twitterId === teslaId) {
        expect(hop).toBeGreaterThanOrEqual(2)
      }
      if (row.subject.twitterId === nasaId) {
        expect(hop).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('builds user subjects alongside the p-mesh without inventing posts', () => {
    const ids = Array.from({ length: 20 }, (_, i) => String(1000 + i))
    const plan = planDemoWotNetwork({ twitterIds: ids })
    expect(plan.userSubjects).toBe(20 + DEMO_WOT_CHAIN.length)
    expect(plan.postSubjects).toBe(0)

    const pEdges = plan.statements.filter((row) => row.subject.type === 'p')
    const userEdges = plan.statements.filter((row) => row.subject.type === 'user')
    const postEdges = plan.statements.filter((row) => row.subject.type === 'post')
    expect(pEdges.length).toBeGreaterThan(0)
    expect(userEdges.length).toBeGreaterThan(0)
    expect(postEdges).toHaveLength(0)

    const rootToDegree1 = pEdges.filter(
      (row) =>
        row.authorIndex === -1 &&
        row.subject.type === 'p' &&
        row.value === '1',
    )
    expect(rootToDegree1.length).toBe(hop1Count(ids))
  })

  it('keeps operator direct trusts small, prefers recent lastSeen, and never shortcuts the chain', () => {
    const users = Array.from({ length: 30 }, (_, i) => ({
      twitterId: String(10_000 + i),
      lastSeen: i === 29 ? 9_999 : i,
    }))
    const plan = planDemoWotNetwork({
      users,
      maxUserSubjects: 10,
    })
    expect(plan.userSubjects).toBe(10 + DEMO_WOT_CHAIN.length)

    const topByLastSeen = [...users]
      .sort(
        (a, b) =>
          b.lastSeen - a.lastSeen || a.twitterId.localeCompare(b.twitterId),
      )
      .slice(0, 10)
      .map((row) => row.twitterId)
    expect(topByLastSeen[0]).toBe('10029')

    const rootUserTrusts = plan.statements.filter(
      (row) => row.authorIndex === -1 && row.subject.type === 'user',
    )
    expect(rootUserTrusts.length).toBeLessThanOrEqual(
      DEMO_WOT_ROOT_DIRECT_USERS,
    )
    expect(
      rootUserTrusts.some(
        (row) =>
          row.subject.type === 'user' &&
          row.subject.twitterId === chainMember('elonmusk').twitterId,
      ),
    ).toBe(true)
    expect(
      rootUserTrusts.some(
        (row) =>
          row.subject.type === 'user' &&
          row.subject.twitterId === chainMember('spacex').twitterId,
      ),
    ).toBe(false)
    expect(
      rootUserTrusts.some(
        (row) =>
          row.subject.type === 'user' &&
          row.subject.twitterId === chainMember('nasa').twitterId,
      ),
    ).toBe(false)

    const rootPostTrusts = plan.statements.filter(
      (row) => row.authorIndex === -1 && row.subject.type === 'post',
    )
    expect(rootPostTrusts.length).toBeLessThanOrEqual(DEMO_WOT_ROOT_DIRECT_POSTS)

    const selected = [
      ...new Set(
        plan.statements
          .filter((row) => row.subject.type === 'user')
          .map((row) =>
            row.subject.type === 'user' ? row.subject.twitterId : '',
          ),
      ),
    ]
    for (const id of selected) {
      if (isDemoWotChainTwitterId(id)) continue
      expect(topByLastSeen).toContain(id)
    }
    expect(selected).not.toContain('10000')

    const networkCounts = new Map<string, number>()
    for (const row of plan.statements) {
      if (row.subject.type !== 'user') continue
      const id = row.subject.twitterId
      if (isDemoWotChainTwitterId(id)) continue
      if (row.authorIndex !== -1) {
        networkCounts.set(id, (networkCounts.get(id) ?? 0) + 1)
      }
    }
    for (const [id, count] of networkCounts) {
      expect(count).toBeLessThanOrEqual(DEMO_WOT_MAX_TRUSTS_PER_USER)
      expect(count).toBe(demoTrustsPerUser(id))
    }
  })

  it('scales toward 2000 when many users are present', () => {
    const users = Array.from({ length: 500 }, (_, i) => ({
      twitterId: String(10_000 + i),
      lastSeen: 500 - i,
    }))
    const plan = planDemoWotNetwork({ users })
    expect(plan.userSubjects).toBe(
      DEMO_WOT_MAX_USER_SUBJECTS + DEMO_WOT_CHAIN.length,
    )
    const rootUserTrusts = plan.statements.filter(
      (row) => row.authorIndex === -1 && row.subject.type === 'user',
    )
    expect(rootUserTrusts.length).toBeLessThanOrEqual(DEMO_WOT_ROOT_DIRECT_USERS)
    expect(plan.statements.length).toBeGreaterThan(500)
    expect(plan.statements.length).toBeLessThanOrEqual(DEMO_WOT_MAX_STATEMENTS)
    expect(plan.ratings).toHaveLength(0)
  })

  it('resolves chain members from observed handles when ids differ', () => {
    const plan = planDemoWotNetwork({
      users: [
        { twitterId: '1', handle: 'elonmusk', lastSeen: 10 },
        { twitterId: '2', handle: 'spacex', lastSeen: 9 },
        { twitterId: '3', handle: 'tesla', lastSeen: 8 },
        { twitterId: '4', handle: 'nasa', lastSeen: 7 },
      ],
    })
    expect(plan.chain.map((row) => row.twitterId)).toEqual(['1', '2', '3', '4'])
    expect(demoWotSubjectDegree(plan, { type: 'user', twitterId: '1' })).toBe(1)
    expect(demoWotSubjectDegree(plan, { type: 'user', twitterId: '2' })).toBe(2)
    expect(demoWotSubjectDegree(plan, { type: 'user', twitterId: '3' })).toBe(3)
    expect(demoWotSubjectDegree(plan, { type: 'user', twitterId: '4' })).toBe(4)
  })

  it('lists chain members missing from xIdentities', () => {
    expect(
      demoWotMissingChainMembers([]).map((row) => row.handle),
    ).toEqual(['elonmusk', 'spacex', 'tesla', 'nasa'])
    expect(
      demoWotMissingChainMembers([
        { twitterId: chainMember('elonmusk').twitterId, lastSeen: 1 },
      ]).map((row) => row.handle),
    ).toEqual(['spacex', 'tesla', 'nasa'])
  })

  it('materializes user, post, and p subjects', () => {
    const pubkeys = Array.from({ length: 3 }, (_, i) =>
      (i + 1).toString(16).padStart(64, 'a'),
    )
    expect(materializeDemoSubject({ type: 'p', authorIndex: 1 }, pubkeys)).toEqual(
      { type: 'p', value: pubkeys[1] },
    )
    expect(
      materializeDemoSubject({ type: 'user', twitterId: '42' }, pubkeys),
    ).toEqual({ type: 'i', value: 'user:id:42' })
    expect(
      materializeDemoSubject({ type: 'post', postId: '424242' }, pubkeys),
    ).toEqual({ type: 'i', value: 'post:id:424242' })
  })
})

describe('demo statement quotes', () => {
  const POLARITY_TEMPLATES = [
    'Trusted this account.',
    'Distrusted this account.',
    'Neutral on this account.',
    'Trusted this post.',
    'I trust this account.',
  ]

  it('puts a subject-true sentence on every planned 32009 row', () => {
    const plan = planDemoWotNetwork({ twitterIds: ['111', '222'] })
    expect(plan.statements.length).toBeGreaterThan(0)
    expect(
      plan.statements.every((row) => row.content.trim().length > 8),
    ).toBe(true)
    expect(
      plan.statements.some((row) => POLARITY_TEMPLATES.includes(row.content)),
    ).toBe(false)
  })

  it('quotes Elon and SpaceX in words about those accounts, not polarity labels', () => {
    const plan = planDemoWotNetwork({ twitterIds: [] })
    const elonId = chainMember('elonmusk').twitterId
    const spacexId = chainMember('spacex').twitterId
    const elon = plan.statements.filter(
      (row) => row.subject.type === 'user' && row.subject.twitterId === elonId,
    )
    const spacex = plan.statements.filter(
      (row) =>
        row.subject.type === 'user' && row.subject.twitterId === spacexId,
    )
    expect(elon.length).toBe(hop1Count([]))
    expect(elon.some((row) => row.authorIndex === -1)).toBe(true)
    expect(elon.filter((row) => row.authorIndex !== -1).length).toBe(
      extraCount([]),
    )
    expect(spacex.length).toBe(1)
    expect(
      elon.every((row) => /starship|launch|factory|engineering/i.test(row.content)),
    ).toBe(true)
    expect(
      spacex.every((row) => /booster|launch|pad/i.test(row.content)),
    ).toBe(true)
    const uniqueElon = new Set(elon.map((row) => row.content))
    const uniqueSpacex = new Set(spacex.map((row) => row.content))
    expect(uniqueElon.size).toBe(elon.length)
    expect(uniqueSpacex.size).toBe(spacex.length)
  })

  it('gives each hop-1 author a unique quote on Elon and SpaceX latest posts', () => {
    const elonPosts = Array.from({ length: 3 }, (_, i) => ({
      postId: String(9_000 + i),
      authorTwitterId: chainMember('elonmusk').twitterId,
      lastSeen: 100 + i,
    }))
    const spacexPosts = Array.from({ length: 2 }, (_, i) => ({
      postId: String(8_000 + i),
      authorTwitterId: chainMember('spacex').twitterId,
      lastSeen: 50 + i,
    }))
    const plan = planDemoWotNetwork({
      twitterIds: [],
      posts: [...elonPosts, ...spacexPosts],
    })
    const elonLatest = plan.chain[0]!.latestPostId
    const spacexLatest = plan.chain[1]!.latestPostId
    const expectedHop1 = hop1Count([])
    const elonLatestTrusts = plan.statements.filter(
      (row) =>
        row.subject.type === 'post' &&
        row.subject.postId === elonLatest &&
        row.value === '1',
    )
    const spacexLatestTrusts = plan.statements.filter(
      (row) =>
        row.subject.type === 'post' &&
        row.subject.postId === spacexLatest &&
        row.value === '1',
    )
    expect(elonLatestTrusts.length).toBe(expectedHop1)
    expect(spacexLatestTrusts.length).toBe(expectedHop1)
    expect(new Set(elonLatestTrusts.map((row) => row.content)).size).toBe(
      expectedHop1,
    )
    expect(new Set(spacexLatestTrusts.map((row) => row.content)).size).toBe(
      expectedHop1,
    )
  })

  it('keeps demoWotStatementContent aligned with the plan', () => {
    const plan = planDemoWotNetwork({ twitterIds: ['111'] })
    const elon = plan.statements.find(
      (row) =>
        row.authorIndex === -1 &&
        row.subject.type === 'user' &&
        row.subject.twitterId === chainMember('elonmusk').twitterId,
    )
    expect(elon).toBeDefined()
    expect(demoWotStatementContent(elon!, plan.chain)).toBe(elon!.content)
  })
})

describe('demo author profiles', () => {
  it('gives each fake author a distinct name and HTTPS face', () => {
    const count =
      DEMO_WOT_MAX_DEPTH * DEMO_WOT_AUTHORS_PER_DEGREE +
      DEMO_WOT_DEGREE1_CHORUS
    const names = new Set<string>()
    const pictures = new Set<string>()
    const initials = new Set<string>()
    for (let i = 0; i < count; i += 1) {
      const profile = demoWotAuthorProfile(i)
      expect(profile.name.trim().length).toBeGreaterThan(2)
      expect(profile.display_name).toBe(profile.name)
      expect(profile.picture.startsWith('https://')).toBe(true)
      expect(profile.picture.startsWith('data:')).toBe(false)
      expect(profile.picture).not.toMatch(/twimg|twitter|x\.com/i)
      names.add(profile.name)
      pictures.add(profile.picture)
      initials.add(profile.name.charAt(0).toUpperCase())
    }
    expect(names.size).toBe(count)
    expect(pictures.size).toBe(count)
    expect(initials.size).toBeGreaterThan(15)
  })
})

describe('isDemoWotEvent', () => {
  it('detects the test tag', () => {
    expect(
      isDemoWotEvent({
        tags: [
          ['d', 'x'],
          ['test', 'attentionx-demo'],
        ],
      }),
    ).toBe(true)
    expect(isDemoWotEvent({ tags: [['d', 'x']] })).toBe(false)
  })
})
