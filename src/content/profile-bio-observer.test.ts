/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest'
import {
  buildProfileBioCandidateFromDocument,
  startProfileBioObserver,
} from './profile-bio-observer'
import { identitiesByHandle } from './scanner'

const NPUB = `npub1${'q'.repeat(60)}`

describe('buildProfileBioCandidateFromDocument', () => {
  it('extracts a single npub from UserDescription and discards raw text', () => {
    identitiesByHandle.clear()
    identitiesByHandle.set('nasa', {
      twitterId: '11348282',
      handle: 'nasa',
      observedAt: 1,
    })
    const doc = document.implementation.createHTMLDocument('profile')
    const desc = doc.createElement('div')
    desc.setAttribute('data-testid', 'UserDescription')
    desc.textContent = `Space agency. ${NPUB} (nostr)`
    doc.body.appendChild(desc)

    const candidate = buildProfileBioCandidateFromDocument(
      doc,
      '/nasa',
      1_700_000_000_000,
    )
    expect(candidate).toEqual({
      twitterId: '11348282',
      handle: 'nasa',
      npub: NPUB,
      npubCount: 1,
      observedAt: 1_700_000_000_000,
    })
    expect(JSON.stringify(candidate)).not.toContain('Space agency')
  })

  it('emits npubCount 0 when the visible bio has no npub', () => {
    identitiesByHandle.clear()
    identitiesByHandle.set('nasa', {
      twitterId: '11348282',
      handle: 'nasa',
      observedAt: 1,
    })
    const doc = document.implementation.createHTMLDocument('profile')
    const desc = doc.createElement('div')
    desc.setAttribute('data-testid', 'UserDescription')
    desc.textContent = 'Just a normal bio'
    doc.body.appendChild(desc)

    expect(
      buildProfileBioCandidateFromDocument(doc, '/nasa', 42),
    ).toEqual({
      twitterId: '11348282',
      handle: 'nasa',
      npubCount: 0,
      observedAt: 42,
    })
  })

  it('returns undefined off profile routes or without UserDescription', () => {
    identitiesByHandle.clear()
    const doc = document.implementation.createHTMLDocument('home')
    expect(
      buildProfileBioCandidateFromDocument(doc, '/home', 1),
    ).toBeUndefined()
  })
})

describe('startProfileBioObserver', () => {
  it('forwards a candidate once UserDescription is present', async () => {
    identitiesByHandle.clear()
    identitiesByHandle.set('bob', {
      twitterId: '99',
      handle: 'bob',
      observedAt: 1,
    })
    const doc = document.implementation.createHTMLDocument('profile')
    const forwardCandidate = vi.fn()
    const observer = startProfileBioObserver({
      document: doc,
      getPathname: () => '/bob',
      forwardCandidate,
      now: () => 100,
    })

    const desc = doc.createElement('div')
    desc.setAttribute('data-testid', 'UserDescription')
    desc.textContent = `gm ${NPUB}`
    doc.body.appendChild(desc)
    observer.scan()

    await new Promise((r) => setTimeout(r, 500))
    expect(forwardCandidate).toHaveBeenCalled()
    expect(forwardCandidate.mock.calls[0]?.[0]).toMatchObject({
      twitterId: '99',
      handle: 'bob',
      npub: NPUB,
      npubCount: 1,
    })
    observer.stop()
  })
})
