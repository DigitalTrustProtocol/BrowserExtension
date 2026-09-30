import { describe, expect, it } from 'vitest'
import { mulberry32, SimWorld } from './world.ts'
import {
  openingIdentityEvents,
  playbackStatement,
  runPlaybackPhases,
  scheduleForRate,
  type PlayPhase,
} from './playback.ts'

describe('playback schedule', () => {
  it('waits a full second at 1/s and batches only from 10/s', () => {
    expect(scheduleForRate(1)).toEqual({ intervalMs: 1000, perTick: 1 })
    expect(scheduleForRate(0.5)).toEqual({ intervalMs: 2000, perTick: 1 })
    expect(scheduleForRate(5)).toEqual({ intervalMs: 200, perTick: 1 })
    expect(scheduleForRate(40)).toEqual({ intervalMs: 100, perTick: 4 })
  })

  it('publishes one event per second for a two-second phase', async () => {
    const sleeps: number[] = []
    let published = 0
    const phases: PlayPhase[] = [
      { kind: 'rate', name: 'trickle', perSecond: 1, seconds: 2 },
    ]
    await runPlaybackPhases({
      phases,
      active: () => true,
      onPhase: () => undefined,
      publishOne: async () => {
        published += 1
      },
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })
    expect(published).toBe(2)
    expect(sleeps).toEqual([1000])
  })
})

describe('playback statements', () => {
  it('signs trust and ratings only for loaded subjects', async () => {
    const world = new SimWorld('playback-subjects', 4)
    world.replaceSubjects([
      { type: 'user', id: '44196397', handle: 'spacex' },
      { type: 'user', id: '12' },
      { type: 'post', id: '2104545486313247031' },
    ])
    const random = mulberry32('playback-subjects')
    const allowed = new Set([
      'user:id:44196397',
      'user:id:12',
      'post:id:2104545486313247031',
    ])
    for (let index = 0; index < 40; index += 1) {
      const event = await playbackStatement(world, random, 1_700_000_000)
      const subject = event.tags.find((tag) => tag[0] === 'i')?.[1]
      expect(allowed.has(subject ?? '')).toBe(true)
      expect(event.kind === 32009 || event.kind === 32014).toBe(true)
    }
  })

  it('opens with one kind 10011 per persona for users that have a handle', async () => {
    const world = new SimWorld('playback-10011', 3)
    world.replaceSubjects([
      { type: 'user', id: '44196397', handle: 'spacex' },
      { type: 'user', id: '12' },
    ])
    const events = await openingIdentityEvents(world, 1_700_000_000)
    expect(events).toHaveLength(3)
    expect(events.every((event) => event.kind === 10011)).toBe(true)
    const claims = events.map((event) =>
      event.tags.find((tag) => tag[0] === 'i' && tag[1]?.startsWith('twitter_id:'))?.[1],
    )
    expect(claims.filter((claim) => claim === 'twitter_id:44196397')).toHaveLength(3)
    expect(claims.filter((claim) => claim === 'twitter_id:12')).toHaveLength(0)
  })

  it('skips kind 10011 when no handle is usable', async () => {
    const world = new SimWorld('playback-no-handle', 2)
    world.replaceSubjects([{ type: 'user', id: '12' }])
    expect(await openingIdentityEvents(world, 1_700_000_000)).toEqual([])
  })
})
