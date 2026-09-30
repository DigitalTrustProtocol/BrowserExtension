import { DEMO_WOT_CHAIN } from '../../../src/shared/demo-wot.ts'
import { operatorKey, personaKey, type SigningKey } from './keys.ts'

export type SimSubject =
  | { type: 'user'; id: string; handle?: string }
  | { type: 'post'; id: string }

export interface Persona {
  index: number
  key: SigningKey
  name: string
}

const DEFAULT_POSTS = ['900000000000001', '900000000000002', '900000000000003', '900000000000004']

/**
 * Deterministic people, operator test keys, and X subjects the simulator publishes about.
 */
export class SimWorld {
  readonly seed: string
  personas: Persona[] = []
  subjects: SimSubject[] = []
  readonly operatorA: SigningKey
  readonly operatorB: SigningKey
  #timer: ReturnType<typeof setTimeout> | undefined
  #generation = 0
  #live = false
  #wake: Array<() => void> = []

  constructor(seed: string, personaCount = 16) {
    this.seed = seed
    this.operatorA = operatorKey(seed, 'a')
    this.operatorB = operatorKey(seed, 'b')
    this.setPersonaCount(personaCount)
    this.subjects = [
      ...DEMO_WOT_CHAIN.map((member) => ({
        type: 'user' as const,
        id: member.twitterId,
      })),
      ...DEFAULT_POSTS.map((id) => ({ type: 'post' as const, id })),
    ]
  }

  setPersonaCount(count: number): void {
    const next = Math.max(1, Math.min(5_000, Math.floor(count)))
    this.personas = Array.from({ length: next }, (_, index) => ({
      index,
      key: personaKey(this.seed, index),
      name: index === 0 ? 'Hub' : `Persona ${index}`,
    }))
  }

  addSubject(raw: string): SimSubject {
    const subject = parseSubject(raw)
    const exists = this.subjects.some(
      (item) => item.type === subject.type && item.id === subject.id,
    )
    if (!exists) this.subjects.push(subject)
    return subject
  }

  replaceSubjects(subjects: readonly SimSubject[]): void {
    this.subjects = [...subjects]
  }

  users(): Array<Extract<SimSubject, { type: 'user' }>> {
    return this.subjects.filter(
      (subject): subject is Extract<SimSubject, { type: 'user' }> =>
        subject.type === 'user',
    )
  }

  posts(): SimSubject[] {
    return this.subjects.filter((subject) => subject.type === 'post')
  }

  secretFor(pubkey: string): Uint8Array | undefined {
    if (pubkey === this.operatorA.pubkey) return this.operatorA.secret
    if (pubkey === this.operatorB.pubkey) return this.operatorB.secret
    return this.personas.find((persona) => persona.key.pubkey === pubkey)?.key
      .secret
  }

  /**
   * Stop any stream or play loop and wake a sleep that is in progress.
   * The previous run's token no longer matches `streamActive`.
   */
  stopStream(): void {
    this.#halt(true)
  }

  /** Start a new stream or play run. Returns the token `streamActive` accepts. */
  beginStream(): number {
    this.#halt(false)
    this.#generation += 1
    this.#live = true
    return this.#generation
  }

  streamActive(token: number): boolean {
    return this.#live && this.#generation === token
  }

  /**
   * Sleep until `ms` elapses or this run is stopped. Stopping resolves
   * immediately so a pause does not keep publishing afterwards.
   */
  wait(ms: number, token: number): Promise<void> {
    if (!this.streamActive(token)) return Promise.resolve()
    return new Promise((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      const timer = setTimeout(() => {
        this.#wake = this.#wake.filter((item) => item !== finish)
        if (this.#timer === timer) this.#timer = undefined
        finish()
      }, ms)
      this.#wake.push(finish)
      if (this.#timer !== undefined) clearTimeout(this.#timer)
      this.#timer = timer
    })
  }

  get streaming(): boolean {
    return this.#live
  }

  #halt(bump: boolean): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer)
      this.#timer = undefined
    }
    const wake = this.#wake.splice(0)
    for (const finish of wake) finish()
    this.#live = false
    if (bump) this.#generation += 1
  }
}

export function parseSubject(raw: string): SimSubject {
  const trimmed = raw.trim()
  const post = /^(?:post:id:|post:)?(\d+)$/.exec(trimmed)
  if (post?.[1] && trimmed.startsWith('post')) {
    return { type: 'post', id: post[1] }
  }
  const user = /^(?:user:id:|user:)?(\d+)$/.exec(trimmed)
  if (!user?.[1]) {
    throw new Error(`Subject must look like user:123 or post:123, got ${raw}`)
  }
  return { type: 'user', id: user[1] }
}

export function mulberry32(seedText: string): () => number {
  let seed = 2166136261
  for (let index = 0; index < seedText.length; index += 1) {
    seed = Math.imul(seed ^ seedText.charCodeAt(index), 16777619)
  }
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
