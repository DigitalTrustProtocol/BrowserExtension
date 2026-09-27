import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { finalizeEvent, getPublicKey, type Event, type EventTemplate } from 'nostr-tools'
import { buildKind10011Event } from '../../../src/lib/nostr/kind-10011.ts'
import {
  buildKind32009Event,
  type TrustSubject,
  type TrustValue,
} from '../../../src/lib/nostr/kind-32009.ts'
import { buildKind32014Event } from '../../../src/lib/nostr/kind-32014.ts'
import {
  DEMO_WOT_CHAIN,
  demoWotAuthorProfile,
  materializeDemoSubject,
  planDemoWotNetwork,
} from '../../../src/shared/demo-wot.ts'
import { demoActorSecretKey } from '../../../src/shared/demo-actor-key.ts'
import { X_TRUST_SCOPE } from '../../../src/shared/x-identity.ts'
import { trustPublishContextForSubject } from '../../../src/shared/trust-context.ts'
import { mulberry32, type SimSubject, type SimWorld } from './world.ts'
import type { SigningKey } from './keys.ts'

const CACHE_VERSION = 1
const CACHE_DIR = path.join(process.cwd(), '.test-relay', 'cache')

export interface PublishTags {
  scopes: string[]
  k?: string
  context: string
}

/** Same scope rules as extension publish: X subjects carry `s=x.com`. */
export function publishTags(subject: TrustSubject): PublishTags {
  const context = trustPublishContextForSubject(subject)
  if (subject.type !== 'i') return { scopes: [], context }
  if (subject.value.startsWith('user:id:')) {
    return { scopes: [X_TRUST_SCOPE], k: 'user:id', context }
  }
  if (subject.value.startsWith('post:id:')) {
    return { scopes: [X_TRUST_SCOPE], k: 'post:id', context: '' }
  }
  return { scopes: [], context }
}

export function subjectOf(subject: SimSubject): TrustSubject {
  return subject.type === 'user'
    ? { type: 'i', value: `user:id:${subject.id}` }
    : { type: 'i', value: `post:id:${subject.id}` }
}

export async function signTemplate(
  template: EventTemplate,
  secret: Uint8Array,
): Promise<Event> {
  return finalizeEvent(template, secret)
}

export async function trustEvent(input: {
  author: SigningKey
  subject: TrustSubject
  value: TrustValue
  createdAt: number
  content?: string
  scopes?: string[]
}): Promise<Event> {
  const tags = publishTags(input.subject)
  const template = await buildKind32009Event({
    subject: input.subject,
    value: input.value,
    context: tags.context,
    scopes: input.scopes ?? tags.scopes,
    ...(tags.k ? { k: tags.k } : {}),
    content: input.content ?? '',
    createdAt: input.createdAt,
  })
  return signTemplate(template, input.author.secret)
}

export async function ratingEvent(input: {
  author: SigningKey
  subject: TrustSubject
  score: string
  createdAt: number
}): Promise<Event> {
  const tags = publishTags(input.subject)
  const template = await buildKind32014Event({
    subject: input.subject,
    score: input.score,
    context: '',
    scopes: tags.scopes,
    ...(tags.k ? { k: tags.k } : {}),
    content: '',
    createdAt: input.createdAt,
  })
  return signTemplate(template, input.author.secret)
}

export async function profileEvent(
  author: SigningKey,
  name: string,
  createdAt: number,
): Promise<Event> {
  return signTemplate(
    {
      kind: 0,
      created_at: createdAt,
      tags: [],
      content: JSON.stringify({
        name,
        display_name: name,
        about: 'AttentionX local test persona',
      }),
    },
    author.secret,
  )
}

export async function identityEvent(input: {
  author: SigningKey
  handle: string
  twitterId: string
  createdAt: number
}): Promise<Event> {
  const template = buildKind10011Event({
    handle: input.handle,
    twitterId: input.twitterId,
    createdAt: input.createdAt,
  })
  return signTemplate(template, input.author.secret)
}

export interface BulkSpec {
  seed: string
  count: number
  days: number
  personas: number
}

/**
 * `count` distinct signed events spread across `days`.
 * A JSONL cache avoids re-signing the same batch.
 */
export async function loadBulkEvents(
  world: SimWorld,
  spec: BulkSpec,
): Promise<Event[]> {
  const file = cacheFile(spec)
  try {
    const cached = await readFile(file, 'utf8')
    const events = cached
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Event)
    if (events.length === spec.count) return events
  } catch {
    /* cache miss */
  }
  const events = await buildBulkEvents(world, spec)
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(file, events.map((event) => JSON.stringify(event)).join('\n'))
  return events
}

async function buildBulkEvents(world: SimWorld, spec: BulkSpec): Promise<Event[]> {
  const now = Math.floor(Date.now() / 1000)
  const span = spec.days <= 0 ? 0 : spec.days * 24 * 60 * 60
  const random = mulberry32(`${spec.seed}:bulk:${spec.count}:${spec.days}`)
  const events: Event[] = []
  const chunk = 64
  for (let start = 0; start < spec.count; start += chunk) {
    const end = Math.min(spec.count, start + chunk)
    const batch = await Promise.all(
      Array.from({ length: end - start }, (_, offset) =>
        buildBulkOne(world, spec, start + offset, now, span, random),
      ),
    )
    events.push(...batch)
  }
  return events
}

async function buildBulkOne(
  world: SimWorld,
  spec: BulkSpec,
  index: number,
  now: number,
  span: number,
  random: () => number,
): Promise<Event> {
  const persona = world.personas[index % world.personas.length]!
  const author = persona.key
  const createdAt =
    span === 0
      ? Math.max(0, now - spec.count) + index
      : now - span + Math.floor((index * span) / Math.max(1, spec.count - 1))
  if (index < world.personas.length) {
    return profileEvent(author, persona.name, createdAt)
  }
  if (index < world.personas.length * 2 && world.personas.length > 1) {
    const target = world.personas[(index + 1) % world.personas.length]!.key.pubkey
    return trustEvent({
      author,
      subject: { type: 'p', value: target },
      value: '1',
      createdAt,
      content: 'test relay follow',
    })
  }
  if (index % 5 === 0) {
    return ratingEvent({
      author,
      subject: { type: 'i', value: `post:id:${910000000000000 + index}` },
      score: String(1 + Math.floor(random() * 99)),
      createdAt,
    })
  }
  const configured = world.users()
  const subject =
    configured.length > 0 && index % 20 === 0
      ? subjectOf(configured[index % configured.length]!)
      : { type: 'i' as const, value: `user:id:${800000000000000 + index}` }
  const value: TrustValue = index % 11 === 0 ? '0' : index % 13 === 0 ? '-1' : '1'
  return trustEvent({
    author,
    subject,
    value,
    createdAt,
    content: 'test relay trust',
  })
}

export async function followGraph(world: SimWorld, createdAt: number): Promise<Event[]> {
  const events: Event[] = []
  for (const persona of world.personas) {
    events.push(await profileEvent(persona.key, persona.name, createdAt))
    if (persona.index === 0) continue
    const hub = world.personas[0]!.key.pubkey
    events.push(
      await trustEvent({
        author: persona.key,
        subject: { type: 'p', value: hub },
        value: '1',
        createdAt,
        content: 'hub',
      }),
    )
    events.push(
      await trustEvent({
        author: world.personas[0]!.key,
        subject: { type: 'p', value: persona.key.pubkey },
        value: '1',
        createdAt,
        content: 'member',
      }),
    )
  }
  return events
}

export async function operatorRootTrusts(
  world: SimWorld,
  operator: SigningKey,
  createdAt: number,
): Promise<Event[]> {
  const hops = world.personas.slice(0, Math.min(4, world.personas.length))
  const events: Event[] = []
  for (const persona of hops) {
    events.push(
      await trustEvent({
        author: operator,
        subject: { type: 'p', value: persona.key.pubkey },
        value: '1',
        createdAt,
        content: 'test root',
      }),
    )
  }
  return events
}

const NEXT_VALUE: Record<string, TrustValue> = {
  '1': '0',
  '0': '-1',
  '-1': '',
  '': '1',
}

export function nextTrustValue(value: string): TrustValue {
  return NEXT_VALUE[value] ?? '0'
}

export function readTrustValue(event: Event): TrustValue | undefined {
  const tag = event.tags.find((item) => item[0] === 'v')
  const value = tag?.[1]
  if (value === '1' || value === '0' || value === '-1' || value === '') return value
  return undefined
}

export function readSubject(event: Event): TrustSubject | undefined {
  for (const name of ['p', 'e', 'i'] as const) {
    const tag = event.tags.find((item) => item[0] === name)
    if (tag?.[1]) return { type: name, value: tag[1] }
  }
  return undefined
}

export function readScopes(event: Event): string[] {
  return event.tags.filter((tag) => tag[0] === 's' && tag[1]).map((tag) => tag[1]!)
}

export async function replacementTrust(
  event: Event,
  secret: Uint8Array,
  value: TrustValue,
  createdAt: number,
): Promise<Event | undefined> {
  const subject = readSubject(event)
  if (!subject) return undefined
  const author = { secret, pubkey: event.pubkey, nsec: '', npub: '' }
  return trustEvent({
    author,
    subject,
    value,
    createdAt,
    scopes: readScopes(event),
    content: event.content,
  })
}

export async function streamEvent(
  world: SimWorld,
  random: () => number,
  createdAt: number,
): Promise<Event> {
  const hubCount = Math.min(4, world.personas.length)
  const author =
    random() < 0.7
      ? world.personas[Math.floor(random() * hubCount)]!
      : world.personas[Math.floor(random() * world.personas.length)]!
  const roll = random()
  if (roll < 0.1) return profileEvent(author.key, author.name, createdAt)
  if (roll < 0.35) {
    const posts = world.posts()
    const post = posts[Math.floor(random() * posts.length)]
    const subject = post
      ? subjectOf(post)
      : {
          type: 'i' as const,
          value: `post:id:${910000000000000 + Math.floor(random() * 1_000_000)}`,
        }
    return ratingEvent({
      author: author.key,
      subject,
      score: String(Math.floor(random() * 101)),
      createdAt,
    })
  }
  const users = world.users()
  const user = users[Math.floor(random() * users.length)]
  const subject = user
    ? subjectOf(user)
    : { type: 'p' as const, value: world.personas[0]!.key.pubkey }
  return trustEvent({
    author: author.key,
    subject,
    value: '1',
    createdAt,
    content: 'stream',
  })
}

export async function presetDemoEvents(
  operator: SigningKey,
): Promise<{ events: Event[]; note: string }> {
  const plan = planDemoWotNetwork({
    users: DEMO_WOT_CHAIN.map((member) => ({
      twitterId: member.twitterId,
      handle: member.handle,
      displayName: member.displayName,
      lastSeen: 1,
    })),
  })
  const secrets = plan.authors.map((slot) => demoActorSecretKey(slot.twitterId))
  const pubkeys = secrets.map((secret) => getPublicKey(secret))
  const createdAt = Math.floor(Date.now() / 1000) - plan.statements.length - 10
  const events: Event[] = []
  for (let index = 0; index < plan.authors.length; index += 1) {
    const profile = demoWotAuthorProfile(index, plan.authors[index])
    events.push(
      await profileEvent(
        { secret: secrets[index]!, pubkey: pubkeys[index]!, nsec: '', npub: '' },
        profile.name,
        createdAt,
      ),
    )
  }
  for (let index = 0; index < plan.statements.length; index += 1) {
    const row = plan.statements[index]!
    const author = authorKey(row.authorIndex, operator, secrets, pubkeys)
    if (!author) continue
    const subject = materializeDemoSubject(row.subject, pubkeys)
    events.push(
      await trustEvent({
        author,
        subject,
        value: row.value,
        createdAt: createdAt + 1 + index,
        content: row.content,
      }),
    )
  }
  for (let index = 0; index < plan.ratings.length; index += 1) {
    const row = plan.ratings[index]!
    const author = authorKey(row.authorIndex, operator, secrets, pubkeys)
    if (!author) continue
    events.push(
      await ratingEvent({
        author,
        subject: materializeDemoSubject(row.subject, pubkeys),
        score: row.score,
        createdAt: createdAt + plan.statements.length + 1 + index,
      }),
    )
  }
  return {
    events,
    note: `${events.length} demo-shaped events. Import operator A as the graph root. No demo tag, so testnet ingest keeps them.`,
  }
}

function authorKey(
  authorIndex: number,
  operator: SigningKey,
  secrets: Uint8Array[],
  pubkeys: string[],
): SigningKey | undefined {
  if (authorIndex === -1) return operator
  const secret = secrets[authorIndex]
  const pubkey = pubkeys[authorIndex]
  if (!secret || !pubkey) return undefined
  return { secret, pubkey, nsec: '', npub: '' }
}

export async function pathologicalEvents(world: SimWorld): Promise<{
  events: Array<{ event: Event; expect: 'accept' | 'reject' }>
  sameStamp: Event[]
}> {
  const author = world.personas[0]!.key
  const now = Math.floor(Date.now() / 1000)
  const good = await trustEvent({
    author,
    subject: { type: 'p', value: world.personas[Math.min(1, world.personas.length - 1)]!.key.pubkey },
    value: '1',
    createdAt: now,
    content: 'pathological base',
  })
  const badSig: Event = {
    ...good,
    id: good.id,
    sig: good.sig.slice(0, -1) + (good.sig.endsWith('a') ? 'b' : 'a'),
  }
  const wrongScope = await trustEvent({
    author,
    subject: subjectOf(world.users()[0] ?? { type: 'user', id: '44196397' }),
    value: '1',
    createdAt: now,
    scopes: ['not-x'],
    content: 'wrong scope',
  })
  const future = await trustEvent({
    author,
    subject: { type: 'i', value: 'user:id:800000000000099' },
    value: '1',
    createdAt: now + 365 * 24 * 60 * 60,
    content: 'future',
  })
  const oversize = await signTemplate(
    {
      kind: 1,
      created_at: now,
      tags: [],
      content: 'x'.repeat(140 * 1024),
    },
    author.secret,
  )
  const stamp = now - 5
  const sameStamp: Event[] = []
  for (let index = 0; index < 250; index += 1) {
    sameStamp.push(
      await trustEvent({
        author,
        subject: { type: 'i', value: `user:id:${700000000000000 + index}` },
        value: '1',
        createdAt: stamp,
        content: 'stall',
      }),
    )
  }
  return {
    events: [
      { event: badSig, expect: 'reject' },
      { event: wrongScope, expect: 'accept' },
      { event: future, expect: 'reject' },
      { event: oversize, expect: 'reject' },
      { event: good, expect: 'accept' },
      { event: good, expect: 'reject' },
    ],
    sameStamp,
  }
}

function cacheFile(spec: BulkSpec): string {
  return path.join(
    CACHE_DIR,
    `v${CACHE_VERSION}-${spec.seed}-${spec.count}-${spec.days}-${spec.personas}.jsonl`,
  )
}
