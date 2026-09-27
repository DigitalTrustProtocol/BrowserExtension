import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Event } from 'nostr-tools'
import type { RelayHost } from '../server/relay.ts'
import { idleFaults, type FaultState } from '../server/faults.ts'
import {
  followGraph,
  identityEvent,
  loadBulkEvents,
  nextTrustValue,
  operatorRootTrusts,
  pathologicalEvents,
  presetDemoEvents,
  readTrustValue,
  replacementTrust,
  streamEvent,
} from '../sim/events.ts'
import { mulberry32, type SimWorld } from '../sim/world.ts'
import type { SigningKey } from '../sim/keys.ts'

export interface CommandResult {
  ok: boolean
  lines: string[]
}

export interface CommandHost {
  hosts: readonly RelayHost[]
  world: SimWorld
  seed: string
  log: (line: string) => void
  requestStop: () => void
}

export async function executeCommand(
  host: CommandHost,
  line: string,
): Promise<CommandResult> {
  const argv = tokenize(line)
  if (argv.length === 0) return { ok: true, lines: [] }
  const targeted = resolveTargets(host.hosts, argv)
  if (!targeted.ok) return targeted.result
  try {
    return await run(host, targeted.hosts, targeted.argv)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, lines: [message] }
  }
}

async function run(
  host: CommandHost,
  relays: readonly RelayHost[],
  argv: string[],
): Promise<CommandResult> {
  const [verb, ...rest] = argv
  switch (verb) {
    case 'help':
      return { ok: true, lines: HELP.split('\n') }
    case 'stats':
      return { ok: true, lines: host.hosts.map(formatStats) }
    case 'subs':
      return { ok: true, lines: host.hosts.map(formatSubs) }
    case 'received':
      return { ok: true, lines: formatReceived(relays, rest) }
    case 'personas':
      return personas(host, rest)
    case 'keys':
      return keys(host, rest)
    case 'subjects':
      if (rest[0] === 'import') {
        if (!rest[1]) return { ok: false, lines: ['subjects import <file>'] }
        return importSubjects(host.world, rest[1])
      }
      return subjects(host, rest)
    case 'bind':
      return bind(host, relays, rest)
    case 'graph':
      return publishMany(relays, await followGraph(host.world, nowSeconds()))
    case 'root':
      return publishMany(
        relays,
        await operatorRootTrusts(host.world, operatorSlot(host, rest[0]), nowSeconds()),
      )
    case 'bulk':
      return bulk(host, relays, rest)
    case 'stream':
      return stream(host, relays, rest)
    case 'churn':
      return churn(host, relays, rest)
    case 'storm':
      return storm(host, relays, rest)
    case 'pathological':
      return pathological(relays, host.world)
    case 'preset':
      return preset(host, relays, rest)
    case 'fault':
      return fault(relays, rest)
    case 'reset':
      host.world.stopStream()
      for (const relay of relays) relay.reset()
      return { ok: true, lines: [`reset ${relays.length} relay(s)`] }
    case 'save':
      return save(relays, rest[0])
    case 'load':
      return load(relays, rest[0])
    case 'quit':
      host.world.stopStream()
      host.requestStop()
      return { ok: true, lines: ['stopped'] }
    default:
      return { ok: false, lines: [`Unknown command ${verb}. Try help.`] }
  }
}

function personas(host: CommandHost, rest: string[]): CommandResult {
  if (rest[0]) {
    const count = numberArg(rest[0], 'persona count')
    host.world.setPersonaCount(count)
  }
  const lines = host.world.personas.slice(0, 24).map(
    (persona) => `${persona.index} ${persona.key.pubkey} ${persona.name}`,
  )
  if (host.world.personas.length > 24) {
    lines.push(`… ${host.world.personas.length - 24} more`)
  }
  lines.unshift(`${host.world.personas.length} personas, seed ${host.seed}`)
  return { ok: true, lines }
}

function keys(host: CommandHost, rest: string[]): CommandResult {
  const slot = rest[0] === 'operator' ? rest[1] : rest[0]
  if (slot !== 'a' && slot !== 'b') {
    return { ok: false, lines: ['keys operator a|b'] }
  }
  const key = slot === 'a' ? host.world.operatorA : host.world.operatorB
  return {
    ok: true,
    lines: [
      'Test key only. Do not import this on the public Nostr network.',
      `operator ${slot}`,
      `pubkey ${key.pubkey}`,
      `npub ${key.npub}`,
      `nsec ${key.nsec}`,
    ],
  }
}

function subjects(host: CommandHost, rest: string[]): CommandResult {
  const [action, ...values] = rest
  if (!action) {
    return {
      ok: true,
      lines: host.world.subjects.map((subject) => `${subject.type}:${subject.id}`),
    }
  }
  if (action === 'add') {
    if (!values[0]) return { ok: false, lines: ['subjects add user:123|post:123'] }
    const subject = host.world.addSubject(values[0])
    return { ok: true, lines: [`added ${subject.type}:${subject.id}`] }
  }
  return { ok: false, lines: ['subjects [add user:123|post:123 | import <file>]'] }
}

async function bind(
  host: CommandHost,
  relays: readonly RelayHost[],
  rest: string[],
): Promise<CommandResult> {
  const index = numberArg(rest[0] ?? '', 'persona index')
  const handle = rest[1]
  const twitterId = rest[2]
  if (!handle || !twitterId) return { ok: false, lines: ['bind <persona> <handle> <twitterId>'] }
  const persona = host.world.personas[index]
  if (!persona) return { ok: false, lines: [`No persona ${index}`] }
  const event = await identityEvent({
    author: persona.key,
    handle,
    twitterId,
    createdAt: nowSeconds(),
  })
  return publishMany(relays, [event])
}

async function bulk(
  host: CommandHost,
  relays: readonly RelayHost[],
  rest: string[],
): Promise<CommandResult> {
  const count = numberArg(rest[0] ?? '1000', 'count')
  const days = rest[1] === undefined ? 7 : numberArg(rest[1], 'days')
  const events = await loadBulkEvents(host.world, {
    seed: host.seed,
    count,
    days,
    personas: host.world.personas.length,
  })
  const summary = publishMany(relays, events)
  summary.lines.unshift(`bulk ${count} over ${days} day(s)`)
  return summary
}

function stream(
  host: CommandHost,
  relays: readonly RelayHost[],
  rest: string[],
): CommandResult {
  if (rest[0] === 'stop') {
    host.world.stopStream()
    return { ok: true, lines: ['stream stopped'] }
  }
  const rate = numberArg(rest[0] ?? '5', 'events per second')
  const seconds = rest[1] === undefined ? 0 : numberArg(rest[1], 'seconds')
  host.world.stopStream()
  const random = mulberry32(`${host.seed}:stream:${Date.now()}`)
  const perTick = Math.max(1, Math.round(rate / 10))
  let ticks = 0
  let busy = false
  const timer = setInterval(() => {
    if (busy) return
    busy = true
    void (async () => {
      const createdAt = nowSeconds()
      for (let index = 0; index < perTick; index += 1) {
        const event = await streamEvent(host.world, random, createdAt)
        for (const relay of relays) relay.publish(event)
      }
      ticks += 1
      if (ticks % 10 === 0) {
        host.log(`stream ~${perTick * 10}/s for ${ticks / 10}s`)
      }
      if (seconds > 0 && ticks >= seconds * 10) {
        host.world.stopStream()
        host.log('stream finished')
      }
    })().finally(() => {
      busy = false
    })
  }, 100)
  host.world.setStream(timer)
  const duration = seconds > 0 ? ` for ${seconds}s` : ''
  return { ok: true, lines: [`streaming ~${perTick * 10}/s${duration}. stream stop to end.`] }
}

async function churn(
  host: CommandHost,
  relays: readonly RelayHost[],
  rest: string[],
): Promise<CommandResult> {
  const count = rest[0] === undefined ? 20 : numberArg(rest[0], 'count')
  const source = relays[0]
  if (!source) return { ok: false, lines: ['No relay selected'] }
  const current = source.store
    .snapshot()
    .filter((event) => event.kind === 32009)
    .slice(-count)
  const createdAt = nowSeconds()
  const events: Event[] = []
  for (const event of current) {
    const secret = host.world.secretFor(event.pubkey)
    const value = readTrustValue(event)
    if (!secret || value === undefined) continue
    const next = await replacementTrust(
      event,
      secret,
      nextTrustValue(value),
      Math.max(createdAt, event.created_at + 1),
    )
    if (next) events.push(next)
  }
  const summary = publishMany(relays, events)
  summary.lines.unshift(`churn ${events.length}`)
  return summary
}

async function storm(
  host: CommandHost,
  relays: readonly RelayHost[],
  rest: string[],
): Promise<CommandResult> {
  const count = numberArg(rest[0] ?? '500', 'count')
  const random = mulberry32(`${host.seed}:storm:${count}`)
  const createdAt = nowSeconds()
  const events: Event[] = []
  for (let index = 0; index < count; index += 1) {
    events.push(await streamEvent(host.world, random, createdAt))
  }
  const started = Date.now()
  const summary = publishMany(relays, events)
  summary.lines.unshift(`storm ${count} in ${Date.now() - started}ms`)
  return summary
}

async function pathological(
  relays: readonly RelayHost[],
  world: SimWorld,
): Promise<CommandResult> {
  const { events, sameStamp } = await pathologicalEvents(world)
  const lines: string[] = []
  for (const item of events) {
    const results = relays.map((relay) => relay.publish(item.event))
    const accepted = results.filter((result) => result.ok).length
    const reason = results.find((result) => !result.ok)
    const got = accepted === relays.length ? 'accept' : 'reject'
    lines.push(
      `${got === item.expect ? 'ok' : 'UNEXPECTED'} ${item.event.kind} ${got}` +
        (reason && !reason.ok ? ` ${reason.reason}` : ''),
    )
  }
  const stamp = publishMany(relays, sameStamp)
  lines.push(`same created_at x${sameStamp.length}: ${stamp.lines.join('; ')}`)
  if (relays.length > 1) {
    lines.push('same events were written to every targeted relay')
  }
  return { ok: true, lines }
}

async function preset(
  host: CommandHost,
  relays: readonly RelayHost[],
  rest: string[],
): Promise<CommandResult> {
  if (rest[0] !== 'demo') return { ok: false, lines: ['preset demo'] }
  const { events, note } = await presetDemoEvents(host.world.operatorA)
  const summary = publishMany(relays, events)
  summary.lines.unshift(note)
  return summary
}

function fault(relays: readonly RelayHost[], rest: string[]): CommandResult {
  const [name, value] = rest
  if (!name || name === 'clear') {
    for (const relay of relays) relay.setFaults(idleFaults())
    return { ok: true, lines: ['faults cleared'] }
  }
  for (const relay of relays) {
    const next = applyFault(relay.faults, name, value)
    relay.setFaults(next)
  }
  return { ok: true, lines: [`fault ${name} ${value ?? ''} on ${relays.length} relay(s)`] }
}

function applyFault(current: FaultState, name: string, value: string | undefined): FaultState {
  const next = { ...current }
  switch (name) {
    case 'latency':
      next.latencyMs = numberArg(value ?? '', 'milliseconds')
      return next
    case 'drop':
      next.dropEveryMs = numberArg(value ?? '', 'seconds') * 1000
      return next
    case 'down':
      next.downUntil = Date.now() + numberArg(value ?? '', 'seconds') * 1000
      return next
    case 'reject':
      next.rejectPercent = numberArg(value ?? '', 'percent')
      return next
    case 'eose-delay':
      next.eoseDelayMs = numberArg(value ?? '', 'milliseconds')
      next.suppressEose = false
      return next
    case 'no-eose':
      next.suppressEose = value !== 'off'
      return next
    case 'rate-limit':
      next.ratePerSec = numberArg(value ?? '', 'events per second')
      return next
    default:
      throw new Error(
        'fault latency|drop|down|reject|eose-delay|no-eose|rate-limit|clear',
      )
  }
}

async function save(
  relays: readonly RelayHost[],
  file: string | undefined,
): Promise<CommandResult> {
  const dir = file ?? path.join(process.cwd(), '.test-relay', 'snapshot')
  await mkdir(dir, { recursive: true })
  for (const [index, relay] of relays.entries()) {
    const events = relay.store.snapshot()
    await writeFile(
      path.join(dir, `relay-${index + 1}.jsonl`),
      events.map((event) => JSON.stringify(event)).join('\n'),
    )
  }
  return { ok: true, lines: [`saved ${relays.length} relay(s) to ${dir}`] }
}

async function load(
  relays: readonly RelayHost[],
  file: string | undefined,
): Promise<CommandResult> {
  const dir = file ?? path.join(process.cwd(), '.test-relay', 'snapshot')
  const lines: string[] = []
  for (const [index, relay] of relays.entries()) {
    const text = await readFile(path.join(dir, `relay-${index + 1}.jsonl`), 'utf8')
    const events = text
      .split('\n')
      .filter((row) => row.length > 0)
      .map((row) => JSON.parse(row) as Event)
    relay.store.replaceAll(events)
    lines.push(`relay ${index + 1} loaded ${events.length}`)
  }
  return { ok: true, lines }
}

function publishMany(relays: readonly RelayHost[], events: readonly Event[]): CommandResult {
  let accepted = 0
  let rejected = 0
  let duplicate = 0
  for (const relay of relays) {
    for (const event of events) {
      const result = relay.publish(event)
      if (result.ok) accepted += 1
      else if (result.reason.startsWith('duplicate:')) duplicate += 1
      else rejected += 1
    }
  }
  const stored = relays.map((relay) => relay.store.size).join(',')
  return {
    ok: rejected === 0,
    lines: [
      `accepted ${accepted}, duplicate ${duplicate}, rejected ${rejected}, stored ${stored}`,
    ],
  }
}

function resolveTargets(
  hosts: readonly RelayHost[],
  argv: string[],
):
  | { ok: true; hosts: readonly RelayHost[]; argv: string[] }
  | { ok: false; result: CommandResult } {
  if (argv[0] !== 'on') return { ok: true, hosts, argv }
  const index = Number(argv[1])
  const relay = hosts[index - 1]
  if (!Number.isInteger(index) || !relay) {
    return {
      ok: false,
      result: { ok: false, lines: [`Relay ${argv[1]} is not running`] },
    }
  }
  const rest = argv.slice(2)
  return { ok: true, hosts: [relay], argv: rest }
}

function formatStats(relay: RelayHost): string {
  const stats = relay.stats()
  return [
    `relay ${stats.port}`,
    `stored ${stats.stored}`,
    `accepted ${stats.accepted}`,
    `rejected ${stats.rejected}`,
    `duplicate ${stats.duplicates}`,
    `conn ${stats.connections}`,
    `subs ${stats.subscriptions}`,
  ].join(' ')
}

function formatSubs(relay: RelayHost): string {
  const stats = relay.stats()
  return `${stats.url} connections ${stats.connections} subscriptions ${stats.subscriptions}`
}

function formatReceived(relays: readonly RelayHost[], rest: string[]): string[] {
  const author = flag(rest, '--author')
  const kindText = flag(rest, '--kind')
  const limitText = flag(rest, '--limit') ?? '20'
  const kind = kindText === undefined ? undefined : numberArg(kindText, 'kind')
  const limit = numberArg(limitText, 'limit')
  const lines: string[] = []
  for (const relay of relays) {
    for (const row of relay.received({
      ...(author ? { author } : {}),
      ...(kind === undefined ? {} : { kind }),
      limit,
    })) {
      lines.push(
        `${relay.port} ${row.accepted ? 'ok' : 'no'} ${row.event.kind} ${row.event.id.slice(0, 8)} ${row.event.pubkey.slice(0, 8)} ${row.reason ?? ''}`,
      )
    }
  }
  return lines.length > 0 ? lines : ['no events']
}

function operatorSlot(host: CommandHost, slot: string | undefined): SigningKey {
  if (slot === undefined || slot === 'a') return host.world.operatorA
  if (slot === 'b') return host.world.operatorB
  throw new Error('root a|b')
}

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index < 0) return undefined
  return argv[index + 1]
}

function numberArg(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`)
  }
  return parsed
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

export function tokenize(line: string): string[] {
  const tokens: string[] = []
  for (const match of line.matchAll(/"([^"]*)"|(\S+)/g)) {
    tokens.push(match[1] ?? match[2] ?? '')
  }
  return tokens
}

const HELP = `help
stats
subs
received [--author <hex>] [--kind <n>] [--limit <n>]
personas [count]
keys operator a|b
subjects
subjects add user:<id>|post:<id>
subjects import <file>
bind <persona> <handle> <twitterId>
graph
root [a|b]
bulk <count> [days]
stream <perSecond> [seconds]
stream stop
churn [count]
storm <count]
pathological
preset demo
fault latency <ms> | drop <seconds> | down <seconds> | reject <percent>
fault eose-delay <ms> | no-eose [off] | rate-limit <perSecond> | clear
on <relay> <command>
reset
save [dir]
load [dir]
quit

Publish commands hit every relay unless prefixed with on <1-based index>.
Operator nsecs are test keys. Never import them on the public network.`

export async function importSubjects(
  world: SimWorld,
  file: string,
): Promise<CommandResult> {
  const text = await readFile(file, 'utf8')
  const parsed = JSON.parse(text) as unknown
  world.replaceSubjects([])
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (typeof item === 'string') world.addSubject(item)
    }
  } else if (parsed && typeof parsed === 'object') {
    const record = parsed as { users?: unknown; posts?: unknown }
    for (const id of asStrings(record.users)) world.addSubject(`user:${id}`)
    for (const id of asStrings(record.posts)) world.addSubject(`post:${id}`)
  } else {
    throw new Error('Subject file must be a JSON array or { users, posts }')
  }
  return {
    ok: true,
    lines: [`imported ${world.subjects.length} subjects from ${file}`],
  }
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}
