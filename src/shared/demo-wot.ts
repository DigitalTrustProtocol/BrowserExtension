import type { TrustSubject, TrustValue } from './kind-32009'
import {
  canonicalTwitterAccountSubject,
  canonicalTwitterPostSubject,
} from './x-identity'
import type { XVerifiedType } from './x-verified'

import { DEMO_EVENT_STATE } from '../storage/demo-event-state'

/** Tag name/value marking local-only demo trust events (never publish). */
export const DEMO_WOT_TAG_NAME = 'test'
export const DEMO_WOT_TAG_VALUE = 'attentionx-demo'
export const DEMO_WOT_EXTRA_TAGS: ReadonlyArray<readonly [string, string]> = [
  [DEMO_WOT_TAG_NAME, DEMO_WOT_TAG_VALUE],
]

/**
 * Spine depth so NASA lands at degree 4:
 * root → Elon (1) → SpaceX (2) → Tesla (3) → NASA (4).
 */
export const DEMO_WOT_MAX_DEPTH = 4
export const DEMO_WOT_AUTHORS_PER_DEGREE = 4
/**
 * Extra signing authors from observed `xIdentities`, spread across hops 1–4
 * so Elon / SpaceX / Tesla / NASA each have several witnesses. No extra may
 * `p`-skip onto a later chain hop.
 */
export const DEMO_WOT_DEGREE1_CHORUS = 16
/** Cap observed X accounts considered for user:id demo trusts (chain ids are always added). */
export const DEMO_WOT_MAX_USER_SUBJECTS = 400
/** Inclusive max network (non-root) trust statements about a single non-chain X user. */
export const DEMO_WOT_MAX_TRUSTS_PER_USER = 10
/** Operator (root) directly trusts only this many recent X accounts (includes Elon). */
export const DEMO_WOT_ROOT_DIRECT_USERS = 8
/** Operator (root) directly trusts only this many non-featured demo posts. */
export const DEMO_WOT_ROOT_DIRECT_POSTS = 8
/** Upper bound for observed post subjects when many users leave room under the cap. */
export const DEMO_WOT_MAX_POST_SUBJECTS = 1000
/** Hard cap for kind 32009 statements. */
export const DEMO_WOT_MAX_STATEMENTS = 2000
/** Hard cap for kind 32014 ratings (seeded in addition to statements). */
export const DEMO_WOT_MAX_RATINGS = 600

export { TRUST_GRAPH_UPDATED_MESSAGE } from './trust-graph-updated'

/** Well-known public X accounts used as the manual degree-test spine. */
export const DEMO_WOT_CHAIN: readonly DemoWotChainMember[] = [
  {
    handle: 'elonmusk',
    twitterId: '44196397',
    degree: 1,
    displayName: 'Elon Musk',
    verifiedType: 'blue',
    affiliationBadgePath:
      'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n_normal.png',
    affiliationLabel: 'Tesla',
  },
  {
    handle: 'spacex',
    twitterId: '34743251',
    degree: 2,
    displayName: 'SpaceX',
    verifiedType: 'business',
  },
  {
    handle: 'tesla',
    twitterId: '13298072',
    degree: 3,
    displayName: 'Tesla',
    verifiedType: 'business',
  },
  {
    handle: 'nasa',
    twitterId: '11348282',
    degree: 4,
    displayName: 'NASA',
    verifiedType: 'government',
  },
]

const DEMO_RATING_PRESETS: ReadonlyArray<{
  score: string
  labels: readonly string[]
}> = [
  { score: '100', labels: ['insightful'] },
  { score: '80', labels: ['genuine'] },
  { score: '60', labels: ['funny'] },
  { score: '40', labels: ['ai-slop'] },
  { score: '20', labels: ['misleading'] },
  { score: '0', labels: ['spam'] },
]

/** Short signed-body quotes for StatementScan. Not polarity templates. */
const DEMO_ACCOUNT_TRUST_QUOTES = [
  'Followed this account through years of public posts.',
  'Writes clearly and corrects the record when called out.',
  'Primary sources usually match what they claim here.',
  'Keeps a consistent voice across news and product drops.',
  'Useful signal; skips the pile-on when facts are thin.',
] as const

const DEMO_ACCOUNT_DISTRUST_QUOTES = [
  'Repeats claims that fall apart under a short check.',
  'This account often amplifies rumors without sources.',
  'Track record here is too noisy to rely on.',
  'Headline energy, little that holds up later.',
] as const

const DEMO_ACCOUNT_NEUTRAL_QUOTES = [
  'Neither endorsed nor opposed; watching this account.',
  'Still collecting signal before taking a side.',
] as const

const DEMO_POST_TRUST_QUOTES = [
  'This post matches their usual reporting, with sources attached.',
  'The numbers in this post check out against public records.',
  'Clear write-up; worth keeping in the timeline.',
  'Specific claim, dated, and easy to verify.',
] as const

const DEMO_POST_DISTRUST_QUOTES = [
  'This post overstates the claim without linking evidence.',
  'Headline and body do not match; skipping it.',
  'Looks like engagement bait more than a source.',
] as const

const DEMO_POST_NEUTRAL_QUOTES = [
  'Holding judgment on this post until more context lands.',
  'Neither endorsed nor opposed; watching this thread.',
] as const

const DEMO_HOP_TRUST_QUOTES = [
  'Signs from a stable key and does not bounce identities.',
  'This author has been a reliable hop in the local graph.',
  'Consistent signer; worth following for further evidence.',
] as const

const DEMO_HOP_DISTRUST_QUOTES = [
  'This key hops around too much to treat as a stable hop.',
  'Signatures are fine; the judgment behind them is not.',
] as const

const DEMO_HOP_NEUTRAL_QUOTES = [
  'Keeping this hop visible without treating it as a path.',
] as const

/**
 * Distinct people for StatementScan (name + HTTPS face). Index-stable so
 * re-seeds keep the same reviewer chrome for the same author slot.
 * Pictures are randomuser portraits — not X avatars, not `data:` URLs.
 */
const DEMO_AUTHOR_PEOPLE: readonly { name: string; portrait: string }[] = [
  { name: 'Ada Okonkwo', portrait: 'women/11' },
  { name: 'Ben Calder', portrait: 'men/32' },
  { name: 'Cora Voss', portrait: 'women/44' },
  { name: 'Diego Hale', portrait: 'men/75' },
  { name: 'Elena Park', portrait: 'women/8' },
  { name: 'Farid Nasser', portrait: 'men/14' },
  { name: 'Greta Holm', portrait: 'women/65' },
  { name: 'Hiro Tanaka', portrait: 'men/41' },
  { name: 'Ines Duarte', portrait: 'women/21' },
  { name: 'Jonas Klein', portrait: 'men/52' },
  { name: 'Keisha Ward', portrait: 'women/17' },
  { name: 'Luca Moretti', portrait: 'men/28' },
  { name: 'Maya Singh', portrait: 'women/33' },
  { name: 'Noah Berg', portrait: 'men/7' },
  { name: 'Olga Petrov', portrait: 'women/47' },
  { name: 'Priya Shah', portrait: 'women/68' },
  { name: 'Quinn Adler', portrait: 'men/63' },
  { name: 'Rosa Mendes', portrait: 'women/3' },
  { name: 'Samir Cole', portrait: 'men/19' },
  { name: 'Tessa Nguyen', portrait: 'women/52' },
  { name: 'Uma Patel', portrait: 'women/28' },
  { name: 'Viktor Lang', portrait: 'men/81' },
  { name: 'Willa Brooks', portrait: 'women/36' },
  { name: 'Ximena Ruiz', portrait: 'women/57' },
  { name: 'Yuri Sokolov', portrait: 'men/22' },
  { name: 'Zara Ahmed', portrait: 'women/12' },
  { name: 'Amina Farouk', portrait: 'women/73' },
  { name: 'Blair Chen', portrait: 'men/4' },
  { name: 'Cam Reed', portrait: 'men/46' },
  { name: 'Dalia Frost', portrait: 'women/24' },
  { name: 'Eli Navarro', portrait: 'men/58' },
  { name: 'Faye Ortiz', portrait: 'women/41' },
  { name: 'Gita Rao', portrait: 'women/6' },
  { name: 'Hassan Idris', portrait: 'men/11' },
  { name: 'Ivy Laurent', portrait: 'women/15' },
  { name: 'Jules Weber', portrait: 'men/36' },
  { name: 'Kira Bennett', portrait: 'women/49' },
  { name: 'Leo Strauss', portrait: 'men/67' },
  { name: 'Nadia Costa', portrait: 'women/61' },
  { name: 'Omar Diallo', portrait: 'men/88' },
]

export interface DemoWotAuthorProfile {
  name: string
  display_name: string
  picture: string
}

/**
 * Kind-0 chrome for a demo author. Prefer bound X identity names so Graph
 * and StatementScan show Elon / SpaceX instead of anonymous reviewers.
 * HTTPS `picture` only (not X avatars).
 */
export function demoWotAuthorProfile(
  authorIndex: number,
  author?: Pick<DemoWotAuthorSlot, 'handle' | 'displayName'>,
): DemoWotAuthorProfile {
  const n = Math.max(0, Math.floor(authorIndex))
  const person = DEMO_AUTHOR_PEOPLE[n % DEMO_AUTHOR_PEOPLE.length]!
  const fromAuthor = author
    ? author.displayName.trim() ||
      (author.handle ? `@${author.handle}` : '')
    : ''
  const name =
    fromAuthor ||
    (n < DEMO_AUTHOR_PEOPLE.length ? person.name : `${person.name} ${n + 1}`)
  return {
    name,
    display_name: name,
    picture: `https://randomuser.me/api/portraits/${person.portrait}.jpg`,
  }
}

/**
 * Hop-1 StatementScan lists ~20 authors (plus root on Elon). Each sentence
 * must stay unique after truncation — distinct openings, subject-true.
 */
const DEMO_CHAIN_ACCOUNT_TRUST: Readonly<Record<string, readonly string[]>> = {
  elonmusk: [
    'Followed this account through Starship tests and product launches.',
    'Engineering updates from this account usually land before the press.',
    'Watches launches and factory progress in public, in real time.',
    'Factory and flight notes here are the ones that hold up later.',
    'Starship stack talk here shows up before the evening recaps.',
    'Launch holds posted here match the range clock, not rumors.',
    'Factory floor clips from this account beat second-hand photos.',
    'Engineering cadence here is the one suppliers actually cite.',
    'Starship tile notes from this account match the close-ups.',
    'Launch windows posted here line up with the public manifest.',
    'Factory Giga updates here stay specific enough to check.',
    'Engineering stills from this account match the pad cameras.',
    'Starship catch talk here tracks the tower video, not leaks.',
    'Launch delays posted here match the weather call, not spin.',
    'Factory vehicle counts here are the ones that hold up later.',
    'Engineering Raptor notes from this account match static-fires.',
    'Starship rollouts posted here match the crawler shots.',
    'Launch T-0 calls from this account match the webcast audio.',
    'Factory energy notes here line up with what owners report.',
    'Engineering grid-fin talk here matches the landing burns.',
    'Starship heat-shield posts here match the recovered tiles.',
    'Launch fairing notes from this account match recovery ships.',
    'Factory Cybertruck clips here match what lots already showed.',
    'Engineering orbit calls from this account match tracking sites.',
  ],
  spacex: [
    'Tracks reusable booster work and actual flight cadence here.',
    'Launch manifests from this account match what actually flew.',
    'Pad and booster notes here beat most second-hand recaps.',
    'Booster serials posted here match the ones on the droneship.',
    'Launch cadence notes from this account match the public log.',
    'Pad camera stills here are the ones journalists grab first.',
    'Booster catch talk from this account matches the tower video.',
    'Launch holds posted here match the range, not a rumor mill.',
    'Pad tanking photos here match the T-minus webcast.',
    'Booster grid-fin notes here match the landing burn footage.',
    'Launch window posts from this account match the customer sheet.',
    'Pad flame-trench stills here match the T-0 cameras.',
    'Booster splashdown times here match the public tracker.',
    'Launch fairing notes from this account match recovery ships.',
    'Pad chopsticks timing here matches the tower cameras.',
    'Booster engine-out notes here match the landing footage.',
    'Launch max-Q calls from this account match the public audio.',
    'Pad weather delays here match the range call that morning.',
    'Booster interstage clips here match the staging camera.',
    'Launch payload mass here matches the customer filing.',
    'Pad crane stills from this account match the stack that day.',
    'Booster heat-shield notes here match the recovered hardware.',
    'Launch orbit calls from this account match tracking sites.',
    'Pad stack photos here match the crawler shots, not mocks.',
  ],
  tesla: [
    'Vehicle and energy numbers from this account are easy to verify.',
    'Product drops here line up with what owners report.',
    'Delivery and safety notes from this account stay specific.',
    'Factory output posts here match the last public filing.',
    'Owner-app notes from this account show up in the wild first.',
    'Energy storage figures here are the ones installers cite.',
    'Safety recall language from this account matches the docket.',
    'Delivery photos here match lots that were already public.',
    'Range numbers posted here match independent winter tests.',
    'Energy pack claims here match the installer data sheets.',
    'Factory shift notes from this account match the lot photos.',
    'Safety scores posted here match the public crash tests.',
    'Delivery week claims here match what lots already showed.',
    'Owner software notes from this account match the app changelog.',
    'Energy site photos here match the permits already filed.',
    'Factory paint codes posted here match the VINs that shipped.',
    'Safety belt notes from this account match the recall list.',
    'Delivery truck stills here match the public lot cameras.',
    'Owner charge-time claims here match third-party logs.',
    'Energy megapack counts here match the interconnection filings.',
    'Factory robot stills from this account match the tour video.',
    'Safety foam notes here match the public tear-down photos.',
    'Delivery rail-car counts here match the freight filings.',
    'Owner FSD clips from this account match the build notes.',
  ],
  nasa: [
    'Mission updates from this account match the public briefings.',
    'Imagery and timelines here are the ones journalists cite.',
    'Flight events posted here match the official clock.',
    'Briefing slides from this account match the streamed audio.',
    'Pad camera stills here match the launch director call.',
    'Orbit insertion notes from this account match tracking sites.',
    'Crew timeline posts here match the public flight plan.',
    'Recovery photos here match the ships that were already named.',
    'Launch window posts here match the range schedule that day.',
    'Pad tanking stills from this account match the webcast clock.',
    'Orbit trim notes here match the public tracking sheet.',
    'Crew sleep slots posted here match the flight-plan PDF.',
    'Recovery helicopter stills here match the named ships.',
    'Briefing audio from this account matches the slide deck.',
    'Pad flame-trench shots here match the T-0 cameras.',
    'Orbit tracking calls here match independent observers.',
    'Crew EVA notes posted here match the public timeline.',
    'Recovery weather holds here match the range call.',
    'Briefing Q&A from this account matches the streamed tape.',
    'Pad countdown calls here match the launch director audio.',
    'Orbit beacon notes from this account match the NORAD sheet.',
    'Crew hatch times posted here match the flight events log.',
    'Recovery splashdown stills here match the helicopter video.',
    'Briefing maps from this account match the public ground track.',
  ],
}

const DEMO_CHAIN_ACCOUNT_DISTRUST: Readonly<Record<string, readonly string[]>> = {
  elonmusk: [
    'Launch claims from this account often outrun the pad clock.',
    'Factory counts posted here do not match the lot photos later.',
    'Starship notes here skip the holds that actually happened.',
    'Engineering updates from this account fade when the webcast starts.',
    'Launch windows posted here keep slipping without a range call.',
    'Factory output talk here is louder than the public filings.',
    'Starship catch talk here outruns the tower cameras.',
    'Engineering Raptor counts here do not match the static-fire notes.',
  ],
  spacex: [
    'Booster serials posted here often fail to match the droneship.',
    'Launch holds from this account lag the range clock.',
    'Pad camera stills here get recaptioned after the webcast.',
    'Booster catch talk from this account outruns the tower video.',
    'Launch cadence notes here do not match the public log.',
    'Pad tanking photos here skip the T-minus holds that counted.',
    'Booster splashdown times here miss the public tracker.',
    'Launch window posts from this account drift from the customer sheet.',
  ],
  tesla: [
    'Vehicle range claims from this account miss independent winter tests.',
    'Energy pack figures here do not match installer data sheets.',
    'Factory output posts here overshoot the last public filing.',
    'Delivery photos here recaption lots that were already public.',
    'Safety recall language from this account lags the docket.',
    'Owner-app notes here skip the changelog that actually shipped.',
    'Energy megapack counts here drift from interconnection filings.',
    'Factory robot stills from this account do not match the tour video.',
  ],
  nasa: [
    'Mission updates from this account lag the public briefings.',
    'Imagery posted here gets recaptioned after the flight log.',
    'Flight events here drift from the official clock.',
    'Briefing slides from this account skip the streamed Q&A.',
    'Pad camera stills here miss the launch director call.',
    'Orbit insertion notes from this account miss tracking sites.',
    'Crew timeline posts here drift from the public flight plan.',
    'Recovery photos here name ships that were not on station.',
  ],
}

const DEMO_CHAIN_ACCOUNT_NEUTRAL: Readonly<Record<string, readonly string[]>> = {
  elonmusk: [
    'Watching Starship notes from this account without picking a side.',
    'Launch cadence here is still too mixed to call.',
    'Factory clips from this account need another quarter of context.',
    'Engineering grid-fin talk here is interesting, not yet a call.',
    'Starship tile posts here are worth tracking, not endorsing.',
    'Launch holds posted here are on the clock; judgment can wait.',
    'Factory energy notes here are still settling against owner reports.',
    'Engineering orbit calls from this account are in the mix, not a vote.',
  ],
  spacex: [
    'Booster notes from this account are still settling against the log.',
    'Launch manifests here are worth tracking, not a call yet.',
    'Pad stills from this account need the webcast before a side.',
    'Booster catch frames here are mixed until the tower video lands.',
    'Launch holds posted here match the range some days, not others.',
    'Pad chopsticks timing here is interesting, not a verdict.',
    'Booster grid-fin notes here are in the mix, not a vote.',
    'Launch payload mass here waits on the customer filing.',
  ],
  tesla: [
    'Vehicle numbers from this account are still settling against filings.',
    'Energy storage figures here are worth tracking, not a call.',
    'Factory shift notes here need another quarter of lot photos.',
    'Delivery week claims here are mixed until lots confirm.',
    'Safety scores posted here wait on the next crash-test round.',
    'Owner software notes here are interesting, not a verdict.',
    'Energy site photos here are on the permits, not a side.',
    'Factory paint codes posted here are in the mix, not a vote.',
  ],
  nasa: [
    'Mission notes from this account are still settling against briefings.',
    'Imagery here is worth tracking, not a call yet.',
    'Flight events posted here wait on the official clock.',
    'Briefing audio from this account is mixed until the slides land.',
    'Pad stills here are interesting, not a verdict.',
    'Orbit trim notes here are in the mix, not a vote.',
    'Crew sleep slots posted here wait on the flight-plan PDF.',
    'Recovery weather holds here match the range some days, not others.',
  ],
}

const DEMO_CHAIN_POST_TRUST: Readonly<Record<string, readonly string[]>> = {
  elonmusk: [
    'This update matches the flight test that actually happened.',
    'Factory photo and caption line up with the public timeline.',
    'Landing clip in this post matches the webcast clock.',
    'Booster serial in this caption matches the one that flew.',
    'Pad hold noted here matches the public countdown.',
    'Raptor count in this post matches the static-fire notes.',
    'Starship stack photo here matches the tower cameras that day.',
    'Heat-tile notes in this post match what the close-up showed.',
    'Orbit call in this caption matches the tracking sites.',
    'Catch-attempt stills here match the tower cameras.',
    'Engine-out note in this post matches the landing footage.',
    'Weather delay in this caption matches the range call.',
    'Payload mass here matches the customer sheet.',
    'Ship number in this caption matches the stack that rolled.',
    'Chopsticks timing in this post matches the tower video.',
    'Splashdown time here matches the public tracker.',
    'Grid-fin stills in this post match the landing burn.',
    'Tanking photo here matches the T-minus webcast.',
    'Fairing note in this caption matches the recovery ships.',
    'Interstage clip here matches the staging camera.',
    'Launch window in this post matches the range schedule.',
    'Crane still here matches the stack that morning.',
    'Flame-trench photo here matches the T-0 cameras.',
    'Max-Q call in this caption matches the public audio.',
  ],
  spacex: [
    'This launch note matches the booster that actually flew.',
    'Pad camera and caption agree; keeping the post.',
    'Booster serial in this post matches the droneship photo.',
    'Launch hold here matches the range clock, not a rumor.',
    'Pad tanking still in this post matches the webcast.',
    'Booster catch frame here matches the tower video.',
    'Launch window in this caption matches the customer sheet.',
    'Pad flame-trench shot here matches T-0 cameras.',
    'Booster splashdown time in this post matches the tracker.',
    'Launch fairing note here matches the recovery ships.',
    'Pad chopsticks clip in this post matches the tower.',
    'Booster engine-out note here matches landing footage.',
    'Launch max-Q call in this caption matches the audio.',
    'Pad weather delay here matches the morning range call.',
    'Booster interstage still in this post matches staging.',
    'Launch payload figure here matches the filing.',
    'Pad crane photo in this post matches the stack that day.',
    'Booster grid-fin still here matches the landing burn.',
    'Launch orbit call in this caption matches tracking sites.',
    'Pad stack photo here matches the crawler shots.',
    'Booster heat-shield note in this post matches hardware.',
    'Launch cadence claim here matches the public log.',
    'Pad countdown in this caption matches the webcast clock.',
    'Booster droneship name here matches the recovery track.',
  ],
  tesla: [
    'This product note matches what owners already reported.',
    'The figure in this post matches the last public filing.',
    'Delivery photo here matches lots that were already public.',
    'Safety note in this caption matches the recall docket.',
    'Energy figure in this post matches installer sheets.',
    'Factory output claim here matches the quarterly filing.',
    'Owner-app screenshot here matches what shipped that week.',
    'Range number in this caption matches independent tests.',
  ],
  nasa: [
    'This mission note matches the public briefing clock.',
    'Image and caption agree with the flight events log.',
    'Crew time in this post matches the published flight plan.',
    'Pad still here matches the launch director call.',
    'Orbit insertion note in this caption matches tracking.',
    'Recovery photo here matches the named ships.',
    'Briefing slide in this post matches the streamed audio.',
    'Timeline in this caption matches the official clock.',
  ],
}

export interface DemoWotChainMember {
  handle: string
  twitterId: string
  degree: number
  displayName: string
  verifiedType?: XVerifiedType
  affiliationBadgePath?: string
  affiliationLabel?: string
}

export interface DemoWotUserCandidate {
  twitterId: string
  handle?: string
  displayName?: string
  /** Prefer higher values — recently seen accounts are likelier on the timeline. */
  lastSeen: number
}

/** Demo signing slot bound 1:1 to an `xIdentities` row. */
export interface DemoWotAuthorSlot {
  twitterId: string
  handle: string
  displayName: string
  hop: number
}

export interface DemoWotPostCandidate {
  postId: string
  authorTwitterId?: string
  lastSeen: number
  createdAt?: number
}

export interface DemoWotResolvedChainMember extends DemoWotChainMember {
  /** Newest observed `xPosts` post by this account, if any. */
  latestPostId: string | undefined
  /** Observed `xPosts` posts only — never synthesized. */
  postIds: string[]
}

export function isDemoWotEvent(event: {
  tags: ReadonlyArray<readonly string[]>
  state?: string
}): boolean {
  if (event.state === DEMO_EVENT_STATE) return true
  return event.tags.some(
    (tag) =>
      tag[0] === DEMO_WOT_TAG_NAME && tag[1] === DEMO_WOT_TAG_VALUE,
  )
}

export function isDemoWotChainTwitterId(twitterId: string): boolean {
  return DEMO_WOT_CHAIN.some((member) => member.twitterId === twitterId)
}

/** Chain accounts that do not yet have an `xIdentities` row. */
export function demoWotMissingChainMembers(
  users: readonly DemoWotUserCandidate[],
): DemoWotChainMember[] {
  const knownIds = new Set(
    users.map((row) => row.twitterId).filter((id) => /^\d+$/.test(id)),
  )
  return resolveDemoWotChain(users).filter(
    (member) => !knownIds.has(member.twitterId),
  )
}

export type DemoWotSubjectRef =
  | { type: 'p'; authorIndex: number }
  | { type: 'user'; twitterId: string }
  | { type: 'post'; postId: string }

export interface DemoWotPlannedStatement {
  /** `-1` = active user (root); `0..n-1` = ephemeral fake authors. */
  authorIndex: number
  subject: DemoWotSubjectRef
  value: TrustValue
  context: string
  /** Signed kind 32009 `content` — StatementScan quote. Never empty in the plan. */
  content: string
}

export interface DemoWotPlannedRating {
  authorIndex: number
  subject: { type: 'post'; postId: string }
  score: string
  labels: string[]
}

export interface DemoWotPlan {
  fakeAuthorCount: number
  maxDepth: number
  userSubjects: number
  postSubjects: number
  statements: DemoWotPlannedStatement[]
  ratings: DemoWotPlannedRating[]
  chain: DemoWotResolvedChainMember[]
  /** Signing authors: chain members then hop-1 extras from `xIdentities`. */
  authors: DemoWotAuthorSlot[]
}

function hashDigits(twitterId: string): number {
  let h = 0
  for (let i = 0; i < twitterId.length; i += 1) {
    h = (h * 31 + twitterId.charCodeAt(i)) >>> 0
  }
  return h
}

/** Deterministic 0..DEMO_WOT_MAX_TRUSTS_PER_USER trusts for one non-chain user. */
export function demoTrustsPerUser(twitterId: string): number {
  return hashDigits(twitterId) % (DEMO_WOT_MAX_TRUSTS_PER_USER + 1)
}

/** Crowd polarity for SpaceX / Tesla / NASA at the hitting hop. Predecessor stays `'1'`. */
function laterChainCrowdValue(
  memberIndex: number,
  authorIndex: number,
  predecessorIndex: number,
): TrustValue {
  if (authorIndex === predecessorIndex) return '1'
  const mix = (authorIndex + memberIndex) % 5
  if (mix === 0) return '-1'
  if (mix === 1) return '0'
  return '1'
}

function normalizeHandle(handle: string | undefined): string {
  return (handle ?? '').trim().replace(/^@/, '').toLowerCase()
}

function normalizeCandidates(input: {
  users?: readonly DemoWotUserCandidate[]
  twitterIds?: readonly string[]
}): DemoWotUserCandidate[] {
  const fromUsers = (input.users ?? []).map((row) => ({
    twitterId: row.twitterId.trim(),
    handle: normalizeHandle(row.handle),
    displayName: (row.displayName ?? '').trim(),
    lastSeen:
      typeof row.lastSeen === 'number' && Number.isFinite(row.lastSeen)
        ? row.lastSeen
        : 0,
  }))
  const fromIds = (input.twitterIds ?? []).map((id) => ({
    twitterId: id.trim(),
    handle: '',
    displayName: '',
    lastSeen: 0,
  }))
  const merged = [...fromUsers, ...fromIds].filter((row) =>
    /^\d+$/.test(row.twitterId),
  )

  const byId = new Map<string, DemoWotUserCandidate>()
  for (const row of merged) {
    const previous = byId.get(row.twitterId)
    if (!previous || row.lastSeen > previous.lastSeen) {
      byId.set(row.twitterId, row)
      continue
    }
    if (!previous.handle && row.handle) {
      byId.set(row.twitterId, { ...previous, handle: row.handle })
    }
    const current = byId.get(row.twitterId) ?? previous
    if (!current.displayName && row.displayName) {
      byId.set(row.twitterId, { ...current, displayName: row.displayName })
    }
  }

  return [...byId.values()].sort((a, b) => {
    if (b.lastSeen !== a.lastSeen) return b.lastSeen - a.lastSeen
    return a.twitterId < b.twitterId ? -1 : a.twitterId > b.twitterId ? 1 : 0
  })
}

function normalizePosts(
  posts: readonly DemoWotPostCandidate[] | undefined,
): DemoWotPostCandidate[] {
  const byId = new Map<string, DemoWotPostCandidate>()
  for (const row of posts ?? []) {
    const postId = row.postId.trim()
    if (!/^\d+$/.test(postId)) continue
    const authorTwitterId = row.authorTwitterId?.trim()
    const next: DemoWotPostCandidate = {
      postId,
      lastSeen:
        typeof row.lastSeen === 'number' && Number.isFinite(row.lastSeen)
          ? row.lastSeen
          : 0,
      ...(authorTwitterId && /^\d+$/.test(authorTwitterId)
        ? { authorTwitterId }
        : {}),
      ...(typeof row.createdAt === 'number' && Number.isFinite(row.createdAt)
        ? { createdAt: row.createdAt }
        : {}),
    }
    const previous = byId.get(postId)
    if (!previous || next.lastSeen > previous.lastSeen) {
      byId.set(postId, next)
    }
  }
  return [...byId.values()].sort(comparePostsLatestFirst)
}

function comparePostsLatestFirst(
  a: DemoWotPostCandidate,
  b: DemoWotPostCandidate,
): number {
  if (b.lastSeen !== a.lastSeen) return b.lastSeen - a.lastSeen
  const aCreated = a.createdAt ?? 0
  const bCreated = b.createdAt ?? 0
  if (bCreated !== aCreated) return bCreated - aCreated
  if (a.postId === b.postId) return 0
  return a.postId < b.postId ? 1 : -1
}

export function resolveDemoWotChain(
  users: readonly DemoWotUserCandidate[],
): DemoWotChainMember[] {
  return DEMO_WOT_CHAIN.map((member) => {
    const byHandle = users.find(
      (row) => row.handle && row.handle === member.handle,
    )
    const byId = users.find((row) => row.twitterId === member.twitterId)
    return {
      ...member,
      twitterId: byHandle?.twitterId ?? byId?.twitterId ?? member.twitterId,
    }
  })
}

function postsForAuthor(
  posts: readonly DemoWotPostCandidate[],
  twitterId: string,
): DemoWotPostCandidate[] {
  return posts.filter((row) => row.authorTwitterId === twitterId)
}

function resolveChainPosts(
  chain: readonly DemoWotChainMember[],
  observed: readonly DemoWotPostCandidate[],
): DemoWotResolvedChainMember[] {
  return chain.map((member) => {
    const postIds = postsForAuthor(observed, member.twitterId).map(
      (row) => row.postId,
    )
    return {
      ...member,
      postIds,
      latestPostId: postIds[0],
    }
  })
}

function ratingPreset(index: number): { score: string; labels: string[] } {
  const preset = DEMO_RATING_PRESETS[index % DEMO_RATING_PRESETS.length]!
  return { score: preset.score, labels: [...preset.labels] }
}

function highRatingPreset(index: number): { score: string; labels: string[] } {
  const preset = DEMO_RATING_PRESETS[index % 3]!
  return { score: preset.score, labels: [...preset.labels] }
}

/**
 * Spread hop-1 extras across hops 1–4 so SpaceX / Tesla / NASA each have
 * several same-or-later witnesses. Prefer hop 1 (Elon crowd), then hop 2.
 */
function splitExtrasByHop(
  extras: readonly DemoWotUserCandidate[],
): [
  DemoWotUserCandidate[],
  DemoWotUserCandidate[],
  DemoWotUserCandidate[],
  DemoWotUserCandidate[],
] {
  const n1 = Math.ceil(extras.length / 2)
  const rest1 = extras.length - n1
  const n2 = Math.ceil(rest1 / 2)
  const rest2 = rest1 - n2
  const n3 = Math.ceil(rest2 / 2)
  return [
    extras.slice(0, n1),
    extras.slice(n1, n1 + n2),
    extras.slice(n1 + n2, n1 + n2 + n3),
    extras.slice(n1 + n2 + n3),
  ]
}

/**
 * Dense quote slot so hop-1 authors (Elon + extras) do not collide.
 * Root (`-1`) is 0; live Elon lists occupy consecutive slots after that.
 */
function denseQuoteSlot(authorIndex: number): number {
  if (authorIndex < 0) return 0
  return authorIndex + 1
}

/** One unique sentence per co-appearing author when `pool.length` covers the list. */
function pickUniqueQuote(pool: readonly string[], authorIndex: number): string {
  return pool[denseQuoteSlot(authorIndex) % pool.length]!
}

function quotesForValue(
  value: TrustValue,
  trust: readonly string[],
  distrust: readonly string[],
  neutral: readonly string[],
): readonly string[] {
  switch (value) {
    case '1':
      return trust
    case '-1':
      return distrust
    case '0':
    case '':
      return neutral
    default: {
      const _exhaustive: never = value
      return _exhaustive
    }
  }
}

function chainHandleForUser(
  twitterId: string,
  chain: readonly Pick<DemoWotChainMember, 'handle' | 'twitterId'>[],
): string | undefined {
  return chain.find((member) => member.twitterId === twitterId)?.handle
}

function chainHandleForPost(
  postId: string,
  chain: readonly Pick<DemoWotResolvedChainMember, 'handle' | 'postIds'>[],
): string | undefined {
  return chain.find((member) => member.postIds.includes(postId))?.handle
}

/**
 * Deterministic kind 32009 `content` for a planned demo statement.
 * Subject-true sentences for StatementScan; never polarity templates.
 * Unique per author on a live list (re-seed via SEED_DEMO_WOT).
 */
export function demoWotStatementContent(
  row: Pick<DemoWotPlannedStatement, 'authorIndex' | 'subject' | 'value'>,
  chain: readonly Pick<
    DemoWotResolvedChainMember,
    'handle' | 'twitterId' | 'postIds'
  >[] = DEMO_WOT_CHAIN.map((member) => ({ ...member, postIds: [] })),
): string {
  switch (row.subject.type) {
    case 'user': {
      const handle = chainHandleForUser(row.subject.twitterId, chain)
      const chainTrust =
        handle !== undefined ? DEMO_CHAIN_ACCOUNT_TRUST[handle] : undefined
      const chainDistrust =
        handle !== undefined ? DEMO_CHAIN_ACCOUNT_DISTRUST[handle] : undefined
      const chainNeutral =
        handle !== undefined ? DEMO_CHAIN_ACCOUNT_NEUTRAL[handle] : undefined
      return pickUniqueQuote(
        quotesForValue(
          row.value,
          chainTrust ?? DEMO_ACCOUNT_TRUST_QUOTES,
          chainDistrust ?? DEMO_ACCOUNT_DISTRUST_QUOTES,
          chainNeutral ?? DEMO_ACCOUNT_NEUTRAL_QUOTES,
        ),
        row.authorIndex,
      )
    }
    case 'post': {
      const handle = chainHandleForPost(row.subject.postId, chain)
      const chainTrust =
        handle !== undefined ? DEMO_CHAIN_POST_TRUST[handle] : undefined
      return pickUniqueQuote(
        quotesForValue(
          row.value,
          chainTrust ?? DEMO_POST_TRUST_QUOTES,
          DEMO_POST_DISTRUST_QUOTES,
          DEMO_POST_NEUTRAL_QUOTES,
        ),
        row.authorIndex,
      )
    }
    case 'p':
      return pickUniqueQuote(
        quotesForValue(
          row.value,
          DEMO_HOP_TRUST_QUOTES,
          DEMO_HOP_DISTRUST_QUOTES,
          DEMO_HOP_NEUTRAL_QUOTES,
        ),
        row.authorIndex,
      )
    default: {
      const _exhaustive: never = row.subject
      return _exhaustive
    }
  }
}

type DemoWotStatementDraft = Omit<DemoWotPlannedStatement, 'content'> & {
  content?: string
}

/**
 * Builds a deterministic multi-hop WoT plan:
 * - Signing authors are the chain X accounts plus extras from `xIdentities`
 *   (no anonymous Ada/Ben keys). Elon is author 0. Extras are spread across
 *   hops 1–4 so each chain account has several witnesses.
 * - p-mesh: root → hop 1; hop h → hop h+1 (no skip). Chain members also
 *   p-trust earlier chain members (SpaceX / Tesla / NASA trust each other
 *   back). No author p-trusts itself.
 * - user:id: every author at hop ≥ (degree − 1) may vouch for that chain
 *   account except itself. Elon stays all `'1'` (root + crowd). SpaceX /
 *   Tesla / NASA keep the predecessor `'1'` spine and mix Neutral (`'0'`)
 *   and distrust (`'-1'`) on other **hitting-hop** witnesses so QUERY_TRUST
 *   last-degree evidence shows all three polarities. Earlier hops stay
 *   silent (distrust would become the hitting degree). Root never comments
 *   on SpaceX / Tesla / NASA.
 * - hop-1 densely trusts + rates the latest observed Elon and SpaceX posts
 *   (never the post author); Tesla's latest post at hop 2, NASA's at hop 3.
 *   Only the latest observed post per chain account is rated.
 * - remaining observed users/posts fill the statement budget
 *   (user:id only from `xIdentities`; post:id only from observed `xPosts`
 *   whose author is already in that set — trust statements only, no ratings)
 * - every kind 32009 row carries a short `content` quote unique per author
 *   on a live list (re-seed via SEED_DEMO_WOT)
 * - authors get kind-0 name from identity chrome (re-seed via SEED_DEMO_WOT)
 * - no entity trusts itself (own `p`, own `user:id`, or own post)
 * - extras omit the operator's active/bound X id (no fake `eventNpub` on that row)
 */
export function planDemoWotNetwork(input: {
  users?: readonly DemoWotUserCandidate[]
  posts?: readonly DemoWotPostCandidate[]
  /** @deprecated Prefer `users` with `lastSeen`. */
  twitterIds?: readonly string[]
  maxDepth?: number
  authorsPerDegree?: number
  maxUserSubjects?: number
  postSubjects?: number
  /** Do not use these X ids as signing extras (operator / bound account). */
  excludeTwitterIds?: readonly string[]
}): DemoWotPlan {
  const observedUsers = normalizeCandidates(input)
  const chain = resolveDemoWotChain(observedUsers)
  const chainIds = new Set(chain.map((member) => member.twitterId))
  const protectedLaterIds = new Set(
    chain.filter((member) => member.degree > 1).map((member) => member.twitterId),
  )

  const recentUsers = observedUsers
    .filter((row) => !chainIds.has(row.twitterId))
    .slice(
      0,
      Math.max(
        0,
        Math.min(
          input.maxUserSubjects ?? DEMO_WOT_MAX_USER_SUBJECTS,
          DEMO_WOT_MAX_USER_SUBJECTS,
        ),
      ),
    )
  const excludedAuthorIds = new Set(
    (input.excludeTwitterIds ?? []).filter((id) => /^\d{1,24}$/.test(id)),
  )
  const twitterIds = [
    ...chain.map((member) => member.twitterId),
    ...recentUsers.map((row) => row.twitterId),
  ]

  const observedPosts = normalizePosts(input.posts)
  const resolvedChain = resolveChainPosts(chain, observedPosts)

  const maxDepth = Math.max(
    DEMO_WOT_CHAIN.length,
    Math.min(input.maxDepth ?? DEMO_WOT_MAX_DEPTH, DEMO_WOT_MAX_DEPTH),
  )
  const extras = recentUsers
    .filter((row) => !excludedAuthorIds.has(row.twitterId))
    .slice(0, DEMO_WOT_DEGREE1_CHORUS)
  const extrasByHop = splitExtrasByHop(extras)
  const authors: DemoWotAuthorSlot[] = [
    ...resolvedChain.map((member) => ({
      twitterId: member.twitterId,
      handle: member.handle,
      displayName: member.displayName,
      hop: member.degree,
    })),
    ...extrasByHop.flatMap((rows, hopOffset) =>
      rows.map((row) => ({
        twitterId: row.twitterId,
        handle: row.handle ?? '',
        displayName: row.displayName ?? '',
        hop: hopOffset + 1,
      })),
    ),
  ]
  const fakeAuthorCount = authors.length
  const statements: DemoWotPlannedStatement[] = []
  const ratings: DemoWotPlannedRating[] = []
  const usedPostIds = new Set<string>()
  const postOwnerById = new Map<string, string>()
  for (const row of observedPosts) {
    if (row.authorTwitterId) postOwnerById.set(row.postId, row.authorTwitterId)
  }

  const sourceHop = (authorIndex: number): number | undefined => {
    if (authorIndex < 0) return 0
    return authors[authorIndex]?.hop
  }
  const isSelfTrust = (row: DemoWotStatementDraft): boolean => {
    if (row.authorIndex >= 0 && row.subject.type === 'p') {
      if (row.subject.authorIndex === row.authorIndex) return true
    }
    const ownId =
      row.authorIndex < 0 ? undefined : authors[row.authorIndex]?.twitterId
    if (!ownId) return false
    if (row.subject.type === 'user' && row.subject.twitterId === ownId) {
      return true
    }
    if (
      row.subject.type === 'post' &&
      postOwnerById.get(row.subject.postId) === ownId
    ) {
      return true
    }
    return false
  }
  const wouldShorten = (row: DemoWotStatementDraft): boolean => {
    if (row.value !== '1') return false
    const hop = sourceHop(row.authorIndex)
    if (hop === undefined) return false
    if (row.subject.type === 'user') {
      const twitterId = row.subject.twitterId
      const target = authors.find((slot) => slot.twitterId === twitterId)
      if (target) return hop + 1 < target.hop
      return false
    }
    if (row.subject.type === 'p') {
      const target = authors[row.subject.authorIndex]
      if (!target) return false
      return hop + 1 < target.hop
    }
    return false
  }

  const pushStatement = (row: DemoWotStatementDraft): boolean => {
    if (isSelfTrust(row) || wouldShorten(row)) return true
    if (statements.length >= DEMO_WOT_MAX_STATEMENTS) return false
    const content = (row.content ?? demoWotStatementContent(row, resolvedChain)).trim()
    statements.push({ ...row, content })
    if (row.subject.type === 'post') usedPostIds.add(row.subject.postId)
    return true
  }
  const pushRating = (row: DemoWotPlannedRating): boolean => {
    if (ratings.length >= DEMO_WOT_MAX_RATINGS) return false
    ratings.push(row)
    return true
  }

  const authorsAtHop = (hop: number): number[] =>
    authors.flatMap((slot, index) => (slot.hop === hop ? [index] : []))
  const hop1Authors = (): number[] => authorsAtHop(1)

  const done = (): DemoWotPlan =>
    finish(
      fakeAuthorCount,
      maxDepth,
      twitterIds.length,
      usedPostIds.size,
      statements,
      ratings,
      resolvedChain,
      authors,
    )

  // Root → hop-1 authors (Elon + hop-1 extras).
  for (const target of hop1Authors()) {
    if (
      !pushStatement({
        authorIndex: -1,
        subject: { type: 'p', authorIndex: target },
        value: '1',
        context: '',
      })
    ) {
      return done()
    }
  }

  // Adjacent hops only: hop h → hop h+1. No skip to Tesla/NASA.
  for (let hop = 1; hop < maxDepth; hop += 1) {
    const sources = authorsAtHop(hop)
    const targets = authorsAtHop(hop + 1)
    for (const source of sources) {
      for (const target of targets) {
        if (
          !pushStatement({
            authorIndex: source,
            subject: { type: 'p', authorIndex: target },
            value: '1',
            context: '',
          })
        ) {
          return done()
        }
      }
    }
  }

  // SpaceX / Tesla / NASA (and Elon) p-trust earlier chain members — back edges
  // only, so degrees stay 1→2→3→4.
  for (let later = 1; later < resolvedChain.length; later += 1) {
    for (let earlier = 0; earlier < later; earlier += 1) {
      if (
        !pushStatement({
          authorIndex: later,
          subject: { type: 'p', authorIndex: earlier },
          value: '1',
          context: '',
        })
      ) {
        return done()
      }
    }
  }

  const elon = resolvedChain[0]!
  const spacex = resolvedChain[1]!
  const tesla = resolvedChain[2]!
  const nasa = resolvedChain[3]!

  // Hitting-degree crowd plus later back-trusts. Elon stays `'1'`. SpaceX /
  // Tesla / NASA mix Neutral/distrust on non-predecessor **hitting-hop**
  // witnesses so last-degree QUERY_TRUST evidence shows all three polarities.
  // Earlier hops stay silent (distrust would become the hitting degree).
  // Root never comments on SpaceX / Tesla / NASA.
  for (let memberIndex = 0; memberIndex < resolvedChain.length; memberIndex += 1) {
    const member = resolvedChain[memberIndex]!
    const minHop = member.degree - 1
    const predecessorIndex = memberIndex > 0 ? memberIndex - 1 : undefined
    if (minHop <= 0) {
      if (
        !pushStatement({
          authorIndex: -1,
          subject: { type: 'user', twitterId: member.twitterId },
          value: '1',
          context: '',
        })
      ) {
        return done()
      }
    }
    for (let authorIndex = 0; authorIndex < authors.length; authorIndex += 1) {
      const hop = authors[authorIndex]?.hop
      if (hop === undefined || hop < minHop) continue
      const value: TrustValue =
        predecessorIndex === undefined || hop > minHop
          ? '1'
          : laterChainCrowdValue(memberIndex, authorIndex, predecessorIndex)
      if (
        !pushStatement({
          authorIndex,
          subject: { type: 'user', twitterId: member.twitterId },
          value,
          context: '',
        })
      ) {
        return done()
      }
    }
  }

  const ensureLaterChainPolarityMix = (memberIndex: number): boolean => {
    const member = resolvedChain[memberIndex]
    if (!member) return true
    const twitterId = member.twitterId
    const predecessorIndex = memberIndex - 1
    const minHop = member.degree - 1
    const hitting = authorsAtHop(minHop).filter(
      (index) =>
        index !== predecessorIndex && authors[index]?.twitterId !== twitterId,
    )
    const needed = ['-1', '0'] as const
    for (const polarity of needed) {
      const hasPolarity = statements.some(
        (row) =>
          row.subject.type === 'user' &&
          row.subject.twitterId === twitterId &&
          row.value === polarity &&
          hitting.includes(row.authorIndex),
      )
      if (hasPolarity) continue

      const flipFrom = (from: TrustValue, keepOne: boolean): boolean => {
        const matches = statements.flatMap((row, index) =>
          row.subject.type === 'user' &&
          row.subject.twitterId === twitterId &&
          row.value === from &&
          hitting.includes(row.authorIndex)
            ? [index]
            : [],
        )
        if (keepOne && matches.length < 2) return false
        const flip = matches[matches.length - 1]
        if (flip === undefined) return false
        const row = statements[flip]!
        const next = { ...row, value: polarity }
        statements[flip] = {
          ...next,
          content: demoWotStatementContent(next, resolvedChain),
        }
        return true
      }

      if (flipFrom('1', false)) continue
      const other: TrustValue = polarity === '0' ? '-1' : '0'
      if (flipFrom(other, true)) continue
    }
    return true
  }

  for (let memberIndex = 1; memberIndex < resolvedChain.length; memberIndex += 1) {
    if (!ensureLaterChainPolarityMix(memberIndex)) return done()
  }

  const trusteesForPost = (hop: number, ownerTwitterId: string): number[] => {
    const atHop = authorsAtHop(hop).filter(
      (index) => authors[index]?.twitterId !== ownerTwitterId,
    )
    if (atHop.length > 0) return atHop
    const later: number[] = []
    for (let laterHop = hop + 1; laterHop <= maxDepth; laterHop += 1) {
      later.push(
        ...authorsAtHop(laterHop).filter(
          (index) => authors[index]?.twitterId !== ownerTwitterId,
        ),
      )
    }
    return later
  }

  const trustAndRatePostsFromHop = (
    postIds: readonly string[],
    hop: number,
    dense: boolean,
    ownerTwitterId: string,
  ): boolean => {
    const hopAuthors = trusteesForPost(hop, ownerTwitterId)
    for (let p = 0; p < postIds.length; p += 1) {
      const postId = postIds[p]!
      const raters = dense
        ? hopAuthors
        : hopAuthors.slice(0, Math.min(4, hopAuthors.length))
      for (let a = 0; a < raters.length; a += 1) {
        const authorIndex = raters[a]!
        if (
          !pushStatement({
            authorIndex,
            subject: { type: 'post', postId },
            value: '1',
            context: '',
          })
        ) {
          return false
        }
        const preset = dense ? highRatingPreset(a) : ratingPreset(p + a)
        pushRating({
          authorIndex,
          subject: { type: 'post', postId },
          score: preset.score,
          labels: preset.labels,
        })
      }
    }
    return true
  }

  // Latest observed post per chain account only: hop-1 densely trusts and
  // rates Elon + SpaceX (never the author); Tesla's latest at hop 2, NASA's
  // at hop 3. No synthetic posts, no non-latest posts, no other users' posts.
  if (elon.latestPostId) {
    if (!trustAndRatePostsFromHop([elon.latestPostId], 1, true, elon.twitterId)) {
      return done()
    }
  }
  if (spacex.latestPostId) {
    if (
      !trustAndRatePostsFromHop(
        [spacex.latestPostId],
        1,
        true,
        spacex.twitterId,
      )
    ) {
      return done()
    }
  }
  if (tesla.latestPostId) {
    if (
      !trustAndRatePostsFromHop(
        [tesla.latestPostId],
        2,
        false,
        tesla.twitterId,
      )
    ) {
      return done()
    }
  }
  if (nasa.latestPostId) {
    if (
      !trustAndRatePostsFromHop([nasa.latestPostId], 3, false, nasa.twitterId)
    ) {
      return done()
    }
  }

  // Root directly trusts a small recent slice, never SpaceX / Tesla / NASA.
  const rootDirectPool = twitterIds.filter((id) => !protectedLaterIds.has(id))
  const rootDirectUsers = Math.min(DEMO_WOT_ROOT_DIRECT_USERS, rootDirectPool.length)
  for (let i = 0; i < rootDirectUsers; i += 1) {
    const twitterId = rootDirectPool[i]!
    if (twitterId === elon.twitterId) continue
    if (
      !pushStatement({
        authorIndex: -1,
        subject: { type: 'user', twitterId },
        value: i % 7 === 0 ? '-1' : '1',
        context: '',
      })
    ) {
      return done()
    }
  }

  const otherUserIds = twitterIds.filter((id) => !chainIds.has(id))
  const chainPostIdSet = new Set(
    resolvedChain.flatMap((member) => member.postIds),
  )
  const knownAuthorIds = new Set(twitterIds)
  const otherObservedPosts = observedPosts.filter(
    (row) =>
      !chainPostIdSet.has(row.postId) &&
      !!row.authorTwitterId &&
      knownAuthorIds.has(row.authorTwitterId),
  )
  const remainingAfterChain = DEMO_WOT_MAX_STATEMENTS - statements.length
  const otherPostBudget = Math.min(
    otherObservedPosts.length,
    input.postSubjects ?? DEMO_WOT_MAX_POST_SUBJECTS,
    DEMO_WOT_MAX_POST_SUBJECTS,
    remainingAfterChain,
  )
  const postReserve = Math.min(remainingAfterChain, otherPostBudget * 2)
  const userStatementLimit =
    statements.length + Math.max(0, remainingAfterChain - postReserve)

  // Network opinions on other observed X users. Chain ids already handled.
  for (let i = 0; i < otherUserIds.length; i += 1) {
    if (statements.length >= userStatementLimit) break
    const twitterId = otherUserIds[i]!
    const trustCount = demoTrustsPerUser(twitterId)
    const witnesses = authorsAtHop(1).filter(
      (index) => authors[index]?.twitterId !== twitterId,
    )
    const max = Math.min(trustCount, witnesses.length)
    const start = i % Math.max(1, witnesses.length)
    for (let j = 0; j < max; j += 1) {
      if (statements.length >= userStatementLimit) break
      const authorIndex = witnesses[(start + j) % witnesses.length]!
      const mix = (hashDigits(twitterId) + j) % 7
      const value: TrustValue = mix === 0 ? '-1' : mix === 1 ? '0' : '1'
      if (
        !pushStatement({
          authorIndex,
          subject: { type: 'user', twitterId },
          value,
          context: '',
        })
      ) {
        return done()
      }
    }
  }

  const otherPostCount = Math.min(
    otherObservedPosts.length,
    otherPostBudget,
    DEMO_WOT_MAX_STATEMENTS - statements.length,
  )

  const otherPostIds: string[] = []
  for (const row of otherObservedPosts) {
    if (otherPostIds.length >= otherPostCount) break
    otherPostIds.push(row.postId)
  }

  const rootDirectPosts = Math.min(DEMO_WOT_ROOT_DIRECT_POSTS, otherPostIds.length)
  const hop1 = hop1Authors()
  const laterAuthors: number[] = []
  for (let hop = 2; hop <= maxDepth; hop += 1) {
    laterAuthors.push(...authorsAtHop(hop))
  }

  for (let i = 0; i < otherPostIds.length; i += 1) {
    const postId = otherPostIds[i]!
    const authorIndex = i < rootDirectPosts ? -1 : hop1[i % hop1.length]!
    if (
      !pushStatement({
        authorIndex,
        subject: { type: 'post', postId },
        value: i % 9 === 0 ? '-1' : i % 7 === 0 ? '0' : '1',
        context: '',
      })
    ) {
      return done()
    }

    const secondAuthor = laterAuthors[i % laterAuthors.length]!
    if (secondAuthor !== authorIndex && statements.length < DEMO_WOT_MAX_STATEMENTS) {
      if (
        !pushStatement({
          authorIndex: secondAuthor,
          subject: { type: 'post', postId },
          value: i % 11 === 0 ? '-1' : i % 5 === 0 ? '0' : '1',
          context: '',
        })
      ) {
        return done()
      }
    }
  }

  return done()
}

function finish(
  fakeAuthorCount: number,
  maxDepth: number,
  userSubjects: number,
  postSubjects: number,
  statements: DemoWotPlannedStatement[],
  ratings: DemoWotPlannedRating[],
  chain: DemoWotResolvedChainMember[],
  authors: DemoWotAuthorSlot[],
): DemoWotPlan {
  return {
    fakeAuthorCount,
    maxDepth,
    userSubjects,
    postSubjects,
    statements,
    ratings,
    chain,
    authors,
  }
}

export function materializeDemoSubject(
  subject: DemoWotSubjectRef,
  pubkeys: readonly string[],
): TrustSubject {
  if (subject.type === 'user') {
    return {
      type: 'i',
      value: canonicalTwitterAccountSubject(subject.twitterId),
    }
  }
  if (subject.type === 'post') {
    return {
      type: 'i',
      value: canonicalTwitterPostSubject(subject.postId),
    }
  }
  const pubkey = pubkeys[subject.authorIndex]
  if (!pubkey) {
    throw new Error(`Missing demo author pubkey at ${subject.authorIndex}`)
  }
  return { type: 'p', value: pubkey }
}

/** Positive-`p` hop distance from root (`-1`). Missing authors are omitted. */
export function demoWotAuthorHops(
  plan: DemoWotPlan,
): Map<number, number> {
  const distance = new Map<number, number>()
  const queue = [-1]
  distance.set(-1, 0)
  const pEdges = plan.statements.filter(
    (row) => row.subject.type === 'p' && row.value === '1',
  )
  while (queue.length > 0) {
    const author = queue.shift()!
    const depth = distance.get(author) ?? 0
    for (const edge of pEdges) {
      if (edge.authorIndex !== author || edge.subject.type !== 'p') continue
      const child = edge.subject.authorIndex
      if (distance.has(child)) continue
      distance.set(child, depth + 1)
      queue.push(child)
    }
  }
  return distance
}

/** Hitting degree for a user:id / post:id subject, or `undefined` if untrusted. */
export function demoWotSubjectDegree(
  plan: DemoWotPlan,
  subject: { type: 'user'; twitterId: string } | { type: 'post'; postId: string },
): number | undefined {
  const hops = demoWotAuthorHops(plan)
  let best: number | undefined
  for (const row of plan.statements) {
    if (row.value !== '1') continue
    if (subject.type === 'user') {
      if (row.subject.type !== 'user' || row.subject.twitterId !== subject.twitterId) {
        continue
      }
    } else if (
      row.subject.type !== 'post' ||
      row.subject.postId !== subject.postId
    ) {
      continue
    }
    const hop =
      row.authorIndex === -1 ? 0 : hops.get(row.authorIndex)
    if (hop === undefined) continue
    const degree = hop + 1
    if (best === undefined || degree < best) best = degree
  }
  return best
}
