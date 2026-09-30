import {
  DEMO_WOT_CHAIN,
  DEMO_WOT_ROOT_DIRECT_USERS,
} from '../../../src/shared/demo-wot.ts'
import { identityEvent, subjectOf, trustEvent } from './events.ts'
import { signingKey, signingKeyFromNsec, type SigningKey } from './keys.ts'
import type { CatalogUser } from './catalog.ts'
import type { SimWorld } from './world.ts'
import type { Event } from 'nostr-tools'

/** X handle of the playback root, display name "Digital Trust Protocol". */
export const DIGITAL_TRUST_HANDLE = 'trustprotocol'

export interface SpinePlan {
  events: Event[]
  /** Key from the Digital Trust Protocol row's `nsec`, when that row has one. */
  rootKey: SigningKey
  rootUser: CatalogUser
  summary: string[]
}

/**
 * Demo spine, signed for live ingest: You → Elon → SpaceX → Tesla → NASA.
 * You is the nsec on the Digital Trust Protocol row. Every other author
 * gets a generated key. The Elon `user:id` trust is first.
 */
export async function demoSpineEvents(
  world: SimWorld,
  users: readonly CatalogUser[],
  createdAt: number,
): Promise<SpinePlan> {
  const rootUser = findDigitalTrustProtocol(users)
  if (!rootUser) {
    throw new Error(
      'x-identities.json has no @trustprotocol (Digital Trust Protocol) to sign the first trusts',
    )
  }
  if (!rootUser.handle) {
    throw new Error('Digital Trust Protocol has no canonical handle')
  }
  if (!rootUser.nsec) {
    throw new Error(
      'Add an nsec property on the Digital Trust Protocol row in x-identities.json',
    )
  }
  const rootKey = signingKeyFromNsec(rootUser.nsec)
  const chainKeys = DEMO_WOT_CHAIN.map((member) =>
    signingKey(`${world.seed}:chain:${member.twitterId}`),
  )
  const events: Event[] = []
  let stamp = createdAt

  const elon = DEMO_WOT_CHAIN[0]!
  const elonKey = chainKeys[0]!
  events.push(
    await trustUser(rootKey, elon.twitterId, elonKey, stamp, 'You trust Elon'),
  )
  stamp += 1
  events.push(
    await trustEvent({
      author: rootKey,
      subject: { type: 'p', value: elonKey.pubkey },
      value: '1',
      createdAt: stamp,
      content: 'You trust Elon',
    }),
  )
  stamp += 1

  const protectedIds = new Set(
    DEMO_WOT_CHAIN.filter((member) => member.degree > 1).map(
      (member) => member.twitterId,
    ),
  )
  const direct = [elon.twitterId]
  for (const user of users) {
    if (direct.length >= DEMO_WOT_ROOT_DIRECT_USERS) break
    if (user.id === rootUser.id || protectedIds.has(user.id)) continue
    if (direct.includes(user.id)) continue
    direct.push(user.id)
  }
  for (const twitterId of direct.slice(1)) {
    events.push(
      await trustUser(rootKey, twitterId, undefined, stamp, 'You trust'),
    )
    stamp += 1
  }

  for (let index = 0; index < DEMO_WOT_CHAIN.length - 1; index += 1) {
    const source = DEMO_WOT_CHAIN[index]!
    const target = DEMO_WOT_CHAIN[index + 1]!
    const sourceKey = chainKeys[index]!
    const targetKey = chainKeys[index + 1]!
    events.push(
      await trustUser(
        sourceKey,
        target.twitterId,
        targetKey,
        stamp,
        `${source.handle} trusts ${target.handle}`,
      ),
    )
    stamp += 1
    events.push(
      await trustEvent({
        author: sourceKey,
        subject: { type: 'p', value: targetKey.pubkey },
        value: '1',
        createdAt: stamp,
        content: `${source.handle} trusts ${target.handle}`,
      }),
    )
    stamp += 1
  }

  events.push(
    await identityEvent({
      author: rootKey,
      handle: rootUser.handle,
      twitterId: rootUser.id,
      createdAt: stamp,
    }),
  )
  stamp += 1
  for (let index = 0; index < DEMO_WOT_CHAIN.length; index += 1) {
    const member = DEMO_WOT_CHAIN[index]!
    const key = chainKeys[index]!
    events.push(
      await identityEvent({
        author: key,
        handle: member.handle,
        twitterId: member.twitterId,
        createdAt: stamp,
      }),
    )
    stamp += 1
  }

  const names = DEMO_WOT_CHAIN.map((member) => member.displayName).join(' → ')
  return {
    events,
    rootKey,
    rootUser,
    summary: [
      `spine You → ${names}`,
      `Digital Trust Protocol (@${rootUser.handle}) signs with its nsec`,
      `npub ${rootKey.npub}`,
      'First event is You trusting Elon. Other accounts use generated keys.',
    ],
  }
}

export function findDigitalTrustProtocol(
  users: readonly CatalogUser[],
): CatalogUser | undefined {
  const byHandle = users.find((user) => user.handle === DIGITAL_TRUST_HANDLE)
  if (byHandle) return byHandle
  return users.find(
    (user) => user.displayName?.trim().toLowerCase() === 'digital trust protocol',
  )
}

async function trustUser(
  author: SigningKey,
  twitterId: string,
  hinted: SigningKey | undefined,
  createdAt: number,
  content: string,
): Promise<Event> {
  return trustEvent({
    author,
    subject: subjectOf({ type: 'user', id: twitterId }),
    value: '1',
    createdAt,
    content,
    ...(hinted ? { subjectHints: [{ kind: 'npub' as const, npub: hinted.npub }] } : {}),
  })
}
