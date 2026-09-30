import type { Event } from 'nostr-tools'
import type { TrustValue } from '../../../src/lib/nostr/kind-32009.ts'
import { identityEvent, ratingEvent, subjectOf, trustEvent } from './events.ts'
import type { SimWorld } from './world.ts'

/** One tick of a rate below 10/s, or a 100ms batch at or above 10/s. */
export interface TickSchedule {
  intervalMs: number
  perTick: number
}

export type PlayPhase =
  | { kind: 'rate'; name: string; perSecond: number; seconds: number }
  | { kind: 'pause'; name: string; seconds: number }
  | { kind: 'burst'; name: string; count: number }

/** About 60% kind 32009 and 40% kind 32014, so a single post still sees many ratings. */
const TRUST_SHARE = 0.6

export const PLAY_PHASES: readonly PlayPhase[] = [
  { kind: 'rate', name: 'trickle', perSecond: 0.5, seconds: 30 },
  { kind: 'rate', name: 'steady', perSecond: 5, seconds: 20 },
  { kind: 'pause', name: 'pause', seconds: 5 },
  { kind: 'burst', name: 'burst', count: 80 },
  { kind: 'pause', name: 'pause', seconds: 3 },
  { kind: 'rate', name: 'fast', perSecond: 40, seconds: 8 },
  { kind: 'burst', name: 'flood', count: 400 },
]

/**
 * Rates under 10/s wait out the full interval and send one event.
 * Faster rates keep the 100ms tick and send several events per tick.
 */
export function scheduleForRate(eventsPerSecond: number): TickSchedule {
  if (!Number.isFinite(eventsPerSecond) || eventsPerSecond <= 0) {
    throw new Error('events per second must be positive')
  }
  if (eventsPerSecond >= 10) {
    return {
      intervalMs: 100,
      perTick: Math.max(1, Math.round(eventsPerSecond / 10)),
    }
  }
  return {
    intervalMs: Math.max(1, Math.round(1000 / eventsPerSecond)),
    perTick: 1,
  }
}

/** One kind 10011 per persona, round-robin over users that have a handle. */
export async function openingIdentityEvents(
  world: SimWorld,
  createdAt: number,
): Promise<Event[]> {
  const claimed = world.users().filter((user) => user.handle)
  if (claimed.length === 0) return []
  const events: Event[] = []
  for (const persona of world.personas) {
    const user = claimed[persona.index % claimed.length]
    if (!user?.handle) continue
    events.push(
      await identityEvent({
        author: persona.key,
        handle: user.handle,
        twitterId: user.id,
        createdAt,
      }),
    )
  }
  return events
}

/** Trust or rating about a loaded user or post. No synthetic ids. */
export async function playbackStatement(
  world: SimWorld,
  random: () => number,
  createdAt: number,
): Promise<Event> {
  const personas = world.personas
  const author = personas[Math.floor(random() * personas.length)]
  if (!author) throw new Error('No personas')
  if (random() < TRUST_SHARE) {
    const users = world.users()
    const user = users[Math.floor(random() * users.length)]
    if (!user) throw new Error('No users loaded')
    return trustEvent({
      author: author.key,
      subject: subjectOf(user),
      value: trustValue(random()),
      createdAt,
      content: 'playback',
    })
  }
  const posts = world.posts()
  const post = posts[Math.floor(random() * posts.length)]
  if (!post) throw new Error('No posts loaded')
  return ratingEvent({
    author: author.key,
    subject: subjectOf(post),
    score: random() < 0.05 ? '' : String(1 + Math.floor(random() * 100)),
    createdAt,
  })
}

export function phaseLine(phase: PlayPhase): string {
  if (phase.kind === 'rate') {
    return `play ${phase.name} ${phase.perSecond}/s for ${phase.seconds}s`
  }
  if (phase.kind === 'pause') return `play pause ${phase.seconds}s`
  return `play ${phase.name} ${phase.count}`
}

export async function runPlaybackPhases(input: {
  phases: readonly PlayPhase[]
  active: () => boolean
  onPhase: (phase: PlayPhase) => void
  publishOne: () => Promise<void>
  sleep: (ms: number) => Promise<void>
}): Promise<void> {
  for (const phase of input.phases) {
    if (!input.active()) return
    input.onPhase(phase)
    if (phase.kind === 'pause') {
      await input.sleep(phase.seconds * 1000)
      continue
    }
    if (phase.kind === 'burst') {
      for (let index = 0; index < phase.count; index += 1) {
        if (!input.active()) return
        await input.publishOne()
      }
      continue
    }
    const schedule = scheduleForRate(phase.perSecond)
    const ticks = Math.max(
      1,
      Math.round((phase.seconds * 1000) / schedule.intervalMs),
    )
    for (let tick = 0; tick < ticks; tick += 1) {
      if (!input.active()) return
      for (let index = 0; index < schedule.perTick; index += 1) {
        await input.publishOne()
      }
      if (tick + 1 < ticks) await input.sleep(schedule.intervalMs)
    }
  }
}

/** 70% trust, 15% Neutral, 10% distrust, 5% Delete. */
function trustValue(random: number): TrustValue {
  if (random < 0.7) return '1'
  if (random < 0.85) return '0'
  if (random < 0.95) return '-1'
  return ''
}
