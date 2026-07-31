import { describe, expect, it } from 'vitest'
import {
  DEMO_WOT_AUTHORS_PER_DEGREE,
  DEMO_WOT_MAX_DEPTH,
  DEMO_WOT_MAX_STATEMENTS,
  DEMO_WOT_MAX_TRUSTS_PER_USER,
  DEMO_WOT_MAX_USER_SUBJECTS,
  DEMO_WOT_MIN_POST_SUBJECTS,
  DEMO_WOT_ROOT_DIRECT_POSTS,
  DEMO_WOT_ROOT_DIRECT_USERS,
  demoPostId,
  demoTrustsPerUser,
  isDemoWotEvent,
  materializeDemoSubject,
  planDemoWotNetwork,
} from './demo-wot'

describe('planDemoWotNetwork', () => {
  it('allows zero identities (posts + mesh only)', () => {
    const plan = planDemoWotNetwork({ twitterIds: [] })
    expect(plan.userSubjects).toBe(0)
    expect(plan.postSubjects).toBeGreaterThanOrEqual(DEMO_WOT_MIN_POST_SUBJECTS)
    expect(plan.statements.length).toBeGreaterThan(DEMO_WOT_MIN_POST_SUBJECTS)
    expect(plan.statements.length).toBeLessThanOrEqual(DEMO_WOT_MAX_STATEMENTS)
  })

  it('builds a capped multi-hop mesh with user and post subjects', () => {
    const ids = Array.from({ length: 20 }, (_, i) => String(1000 + i))
    const plan = planDemoWotNetwork({ twitterIds: ids })
    expect(plan.maxDepth).toBe(DEMO_WOT_MAX_DEPTH)
    expect(plan.fakeAuthorCount).toBe(
      DEMO_WOT_MAX_DEPTH * DEMO_WOT_AUTHORS_PER_DEGREE,
    )
    expect(plan.userSubjects).toBe(20)
    expect(plan.postSubjects).toBeGreaterThanOrEqual(DEMO_WOT_MIN_POST_SUBJECTS)
    expect(plan.statements.length).toBeLessThanOrEqual(DEMO_WOT_MAX_STATEMENTS)

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
    expect(rootToDegree1.length).toBe(DEMO_WOT_AUTHORS_PER_DEGREE)

    const distance = new Map<number, number>()
    const queue = [-1]
    distance.set(-1, 0)
    while (queue.length > 0) {
      const author = queue.shift()!
      const depth = distance.get(author) ?? 0
      for (const edge of pEdges) {
        if (
          edge.authorIndex !== author ||
          edge.value !== '1' ||
          edge.subject.type !== 'p'
        ) {
          continue
        }
        const child = edge.subject.authorIndex
        if (distance.has(child)) continue
        distance.set(child, depth + 1)
        queue.push(child)
      }
    }
    expect(distance.size - 1).toBe(plan.fakeAuthorCount)
    expect(Math.max(...[...distance.values()])).toBe(DEMO_WOT_MAX_DEPTH)
  })

  it('keeps operator direct trusts small and prefers recent lastSeen', () => {
    const users = Array.from({ length: 30 }, (_, i) => ({
      twitterId: String(10_000 + i),
      lastSeen: i === 29 ? 9_999 : i,
    }))
    const plan = planDemoWotNetwork({
      users,
      maxUserSubjects: 10,
    })
    expect(plan.userSubjects).toBe(10)

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
    expect(rootUserTrusts.length).toBe(
      Math.min(DEMO_WOT_ROOT_DIRECT_USERS, plan.userSubjects),
    )
    expect(
      rootUserTrusts.every(
        (row) =>
          row.subject.type === 'user' &&
          topByLastSeen.includes(row.subject.twitterId),
      ),
    ).toBe(true)

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
      expect(topByLastSeen).toContain(id)
    }
    expect(selected).not.toContain('10000')

    const counts = new Map<string, number>()
    const networkCounts = new Map<string, number>()
    for (const row of plan.statements) {
      if (row.subject.type !== 'user') continue
      const id = row.subject.twitterId
      counts.set(id, (counts.get(id) ?? 0) + 1)
      if (row.authorIndex !== -1) {
        networkCounts.set(id, (networkCounts.get(id) ?? 0) + 1)
      }
    }
    for (const [id, count] of networkCounts) {
      expect(count).toBeLessThanOrEqual(DEMO_WOT_MAX_TRUSTS_PER_USER)
      expect(count).toBe(demoTrustsPerUser(id))
    }
    for (const count of counts.values()) {
      expect(count).toBeLessThanOrEqual(DEMO_WOT_MAX_TRUSTS_PER_USER + 1)
    }
  })

  it('scales toward 2000 when many users are present', () => {
    const users = Array.from({ length: 500 }, (_, i) => ({
      twitterId: String(10_000 + i),
      lastSeen: 500 - i,
    }))
    const plan = planDemoWotNetwork({ users })
    expect(plan.userSubjects).toBe(DEMO_WOT_MAX_USER_SUBJECTS)
    const rootUserTrusts = plan.statements.filter(
      (row) => row.authorIndex === -1 && row.subject.type === 'user',
    )
    expect(rootUserTrusts.length).toBe(DEMO_WOT_ROOT_DIRECT_USERS)
    const counts = new Map<string, number>()
    for (const row of plan.statements) {
      if (row.subject.type !== 'user') continue
      const id = row.subject.twitterId
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    expect(counts.size).toBeLessThanOrEqual(DEMO_WOT_MAX_USER_SUBJECTS)
    for (const count of counts.values()) {
      expect(count).toBeLessThanOrEqual(DEMO_WOT_MAX_TRUSTS_PER_USER + 1)
    }
    expect(plan.statements.length).toBeGreaterThan(500)
    expect(plan.statements.length).toBeLessThanOrEqual(DEMO_WOT_MAX_STATEMENTS)
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
