import { describe, expect, it, vi } from 'vitest'
import { MemoryIdentityRepository } from './memory-repository'
import { XIdentityResolver } from './resolver'
import {
  conflictingProfileHtml,
  nasaProfileHtml,
} from './__fixtures__/profile-html'

const NOW = 1_700_000_000_000

describe('XIdentityResolver', () => {
  it('resolves in cache then observation order', async () => {
    const repository = new MemoryIdentityRepository()
    const fetchProfile = vi.fn()
    const queryNip39 = vi.fn()
    const resolver = new XIdentityResolver({
      repository,
      fetch: fetchProfile,
      queryNip39,
      now: () => NOW,
    })
    await resolver.ingestObservations([
      {
        twitterId: '11348282',
        handle: 'NASA',
        observedAt: NOW - 1_000,
        sourceOperation: 'TweetDetail',
      },
    ])

    const first = await resolver.resolve('@NASA')
    const second = await resolver.resolve('nasa')

    expect(first).toMatchObject({
      state: 'resolved',
      twitterId: '11348282',
      provenance: 'observation',
    })
    expect(second).toMatchObject({
      state: 'resolved',
      twitterId: '11348282',
      cached: true,
    })
    expect(fetchProfile).not.toHaveBeenCalled()
    expect(queryNip39).not.toHaveBeenCalled()
  })

  it('falls back to public profile JSON-LD before NIP-39', async () => {
    const queryNip39 = vi.fn()
    const resolver = new XIdentityResolver({
      repository: new MemoryIdentityRepository(),
      fetch: vi.fn(async () =>
        new Response(nasaProfileHtml, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
      queryNip39,
      now: () => NOW,
    })

    await expect(resolver.resolve('NASA')).resolves.toMatchObject({
      state: 'resolved',
      twitterId: '11348282',
      provenance: 'profile-jsonld',
    })
    expect(queryNip39).not.toHaveBeenCalled()
  })

  it('falls back to verified NIP-39 mappings', async () => {
    const resolver = new XIdentityResolver({
      repository: new MemoryIdentityRepository(),
      fetch: vi.fn(async () => new Response('', { status: 404 })),
      queryNip39: vi.fn(async () => [
        {
          status: 'verified' as const,
          handle: 'NASA',
          twitterId: '11348282',
          nostrPubkey: 'a'.repeat(64),
          proofPostId: '2080659774136291424',
          verifiedAt: NOW - 5_000,
        },
      ]),
      now: () => NOW,
    })

    await expect(resolver.resolve('nasa')).resolves.toMatchObject({
      state: 'resolved',
      twitterId: '11348282',
      provenance: 'verified-nip39',
      nostrPubkeys: ['a'.repeat(64)],
    })
  })

  it('returns conflicts rather than choosing between numeric IDs', async () => {
    const resolver = new XIdentityResolver({
      repository: new MemoryIdentityRepository(),
      fetch: vi.fn(async () =>
        new Response(conflictingProfileHtml, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
      queryNip39: vi.fn(),
      now: () => NOW,
    })

    const result = await resolver.resolve('nasa')
    expect(result.state).toBe('conflict')
    if (result.state === 'conflict') {
      expect(result.candidates.map((candidate) => candidate.twitterId)).toEqual([
        '111',
        '222',
      ])
    }
  })

  it('returns pending with a short retry TTL for transient failures', async () => {
    const resolver = new XIdentityResolver({
      repository: new MemoryIdentityRepository(),
      fetch: vi.fn(async () => {
        throw new Error('offline')
      }),
      queryNip39: vi.fn(async () => {
        throw new Error('relay offline')
      }),
      now: () => NOW,
    })

    await expect(resolver.resolve('nasa')).resolves.toMatchObject({
      state: 'pending',
      reasons: ['profile-unavailable', 'nip39-unavailable'],
      retryAt: NOW + 60_000,
    })
  })
})
