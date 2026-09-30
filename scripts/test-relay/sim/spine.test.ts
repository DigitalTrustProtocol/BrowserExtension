import { describe, expect, it } from 'vitest'
import { DEMO_WOT_CHAIN } from '../../../src/shared/demo-wot.ts'
import type { CatalogUser } from './catalog.ts'
import { signingKey } from './keys.ts'
import { findDigitalTrustProtocol, demoSpineEvents } from './spine.ts'
import { SimWorld } from './world.ts'

const ROOT = signingKey('spine-root-nsec')

const USERS: CatalogUser[] = [
  {
    id: '1002660175277363200',
    handle: 'trustprotocol',
    displayName: 'Digital Trust Protocol',
    nsec: ROOT.nsec,
  },
  { id: '44196397', handle: 'elonmusk', displayName: 'Elon Musk' },
  { id: '12', handle: 'someone' },
  { id: '34743251', handle: 'spacex' },
  { id: '13298072', handle: 'tesla' },
  { id: '11348282', handle: 'nasa' },
  { id: '99', handle: 'extra' },
]

describe('demo spine', () => {
  it('finds Digital Trust Protocol by handle or display name', () => {
    expect(findDigitalTrustProtocol(USERS)?.id).toBe('1002660175277363200')
    expect(
      findDigitalTrustProtocol([
        { id: '7', displayName: 'Digital Trust Protocol' },
      ])?.id,
    ).toBe('7')
  })

  it('sends You trusting Elon first, then the demo chain, and skips later hops from You', async () => {
    const world = new SimWorld('spine', 2)
    const { events, rootKey } = await demoSpineEvents(world, USERS, 1_700_000_000)
    expect(rootKey.pubkey).toBe(ROOT.pubkey)
    expect(rootKey.pubkey).not.toBe(world.operatorA.pubkey)

    const first = events[0]!
    expect(first.pubkey).toBe(ROOT.pubkey)
    expect(first.kind).toBe(32009)
    expect(tagValue(first, 'i')).toBe('user:id:44196397')
    expect(tagValue(first, 'v')).toBe('1')
    expect(first.tags.find((tag) => tag[0] === 'i')?.slice(2).join('')).toMatch(/^npub1/)

    const rootSubjects = events
      .filter((event) => event.pubkey === ROOT.pubkey && event.kind === 32009)
      .map((event) => tagValue(event, 'i') ?? tagValue(event, 'p'))
    expect(rootSubjects[0]).toBe('user:id:44196397')
    expect(rootSubjects).not.toContain('user:id:34743251')
    expect(rootSubjects).not.toContain('user:id:13298072')
    expect(rootSubjects).not.toContain('user:id:11348282')
    expect(rootSubjects).toContain('user:id:12')

    const chain = DEMO_WOT_CHAIN
    for (let index = 0; index < chain.length - 1; index += 1) {
      const source = chain[index]!
      const target = chain[index + 1]!
      const hop = events.find(
        (event) =>
          event.kind === 32009 &&
          event.content === `${source.handle} trusts ${target.handle}` &&
          tagValue(event, 'i') === `user:id:${target.twitterId}`,
      )
      expect(hop).toBeDefined()
      expect(hop?.pubkey).not.toBe(ROOT.pubkey)
    }
  })

  it('requires an nsec on Digital Trust Protocol and generates keys for everyone else', async () => {
    const world = new SimWorld('spine-nsec', 1)
    const withoutSecret = USERS.map(({ nsec: _nsec, ...user }) => user)
    await expect(demoSpineEvents(world, withoutSecret, 1)).rejects.toThrow(/nsec/)
  })

  it('requires the Digital Trust Protocol row', async () => {
    const world = new SimWorld('spine-missing', 1)
    await expect(demoSpineEvents(world, [{ id: '1', handle: 'nasa' }], 1)).rejects.toThrow(
      /trustprotocol/,
    )
  })
})

function tagValue(event: { tags: string[][] }, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1]
}
