import { describe, expect, it } from 'vitest'
import {
  DEMO_WOT_AUTHORS_PER_DEGREE,
  DEMO_WOT_CHAIN,
  DEMO_WOT_DEGREE1_CHORUS,
  DEMO_WOT_MAX_DEPTH,
  DEMO_WOT_MAX_RATINGS,
  DEMO_WOT_MAX_STATEMENTS,
  DEMO_WOT_MAX_TRUSTS_PER_USER,
  DEMO_WOT_MAX_USER_SUBJECTS,
  DEMO_WOT_MIN_POST_SUBJECTS,
  DEMO_WOT_ROOT_DIRECT_POSTS,
  DEMO_WOT_ROOT_DIRECT_USERS,
  demoPostId,
  demoTrustsPerUser,
  demoWotAuthorHops,
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

describe('planDemoWotNetwork', () => {
  it('always includes the Elon→NASA chain even with no observed identities', () => {
    const plan = planDemoWotNetwork({ twitterIds: [] })
    expect(plan.userSubjects).toBe(DEMO_WOT_CHAIN.length)
    expect(plan.maxDepth).toBe(DEMO_WOT_MAX_DEPTH)
    expect(plan.fakeAuthorCount).toBe(
      DEMO_WOT_MAX_DEPTH * DEMO_WOT_AUTHORS_PER_DEGREE +
        DEMO_WOT_DEGREE1_CHORUS,
    )
    expect(plan.postSubjects).toBeGreaterThanOrEqual(DEMO_WOT_MIN_POST_SUBJECTS)
    expect(plan.statements.length).toBeGreaterThan(DEMO_WOT_MIN_POST_SUBJECTS)
    expect(plan.statements.length).toBeLessThanOrEqual(DEMO_WOT_MAX_STATEMENTS)
    expect(plan.ratings.length).toBeGreaterThan(0)
    expect(plan.ratings.length).toBeLessThanOrEqual(DEMO_WOT_MAX_RATINGS)
    expect(demoWotSubjectDegree(plan, {
      type: 'user',
      twitterId: chainMember('elonmusk').twitterId,
    })).toBe(1)
    expect(demoWotSubjectDegree(plan, {
      type: 'user',
      twitterId: chainMember('nasa').twitterId,
    })).toBe(4)
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

    const elonLatest = plan.chain[0]!.latestPostId
    const spacexLatest = plan.chain[1]!.latestPostId
    expect(elonLatest).toBe('9004')
    expect(spacexLatest).toBe('8003')

    const hop1Count =
      DEMO_WOT_AUTHORS_PER_DEGREE + DEMO_WOT_DEGREE1_CHORUS
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
    expect(elonLatestTrusts.length).toBe(hop1Count)
    expect(spacexLatestTrusts.length).toBe(hop1Count)
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
    ).toBe(hop1Count)
    expect(
      plan.ratings.filter((row) => row.subject.postId === spacexLatest).length,
    ).toBe(hop1Count)

    for (const postId of ['9000', '9001', '8000', '7000', '7002']) {
      expect(
        plan.ratings.some((row) => row.subject.postId === postId),
      ).toBe(true)
      expect(
        plan.statements.some(
          (row) => row.subject.type === 'post' && row.subject.postId === postId,
        ),
      ).toBe(true)
    }

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

  it('builds user and post subjects alongside the p-mesh', () => {
    const ids = Array.from({ length: 20 }, (_, i) => String(1000 + i))
    const plan = planDemoWotNetwork({ twitterIds: ids })
    expect(plan.userSubjects).toBe(20 + DEMO_WOT_CHAIN.length)
    expect(plan.postSubjects).toBeGreaterThanOrEqual(DEMO_WOT_MIN_POST_SUBJECTS)

    const pEdges = plan.statements.filter((row) => row.subject.type === 'p')
    const userEdges = plan.statements.filter((row) => row.subject.type === 'user')
    const postEdges = plan.statements.filter((row) => row.subject.type === 'post')
    expect(pEdges.length).toBeGreaterThan(0)
    expect(userEdges.length).toBeGreaterThan(0)
    expect(postEdges.length).toBeGreaterThanOrEqual(DEMO_WOT_MIN_POST_SUBJECTS)

    const rootToDegree1 = pEdges.filter(
      (row) =>
        row.authorIndex === -1 &&
        row.subject.type === 'p' &&
        row.value === '1',
    )
    expect(rootToDegree1.length).toBe(
      DEMO_WOT_AUTHORS_PER_DEGREE + DEMO_WOT_DEGREE1_CHORUS,
    )
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
    expect(plan.ratings.length).toBeGreaterThan(20)
    expect(plan.ratings.length).toBeLessThanOrEqual(DEMO_WOT_MAX_RATINGS)
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
      materializeDemoSubject({ type: 'post', postId: demoPostId(3) }, pubkeys),
    ).toEqual({ type: 'i', value: `post:id:${demoPostId(3)}` })
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
