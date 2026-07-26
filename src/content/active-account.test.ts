import { describe, expect, it } from 'vitest'
import {
  detectActiveAccountHandle,
  handleFromProfileHref,
  resolveActiveAccount,
  twitterIdFromDocument,
  twitterIdFromTwidCookie,
} from './active-account'

describe('active account detection', () => {
  it('parses profile hrefs and ignores non-profile paths', () => {
    expect(handleFromProfileHref('/NASA')).toBe('nasa')
    expect(handleFromProfileHref('https://x.com/nasa/with_replies')).toBe(
      'nasa',
    )
    expect(handleFromProfileHref('/home')).toBeUndefined()
    expect(handleFromProfileHref('/i/bookmarks')).toBeUndefined()
  })

  it('parses the logged-in user id from the twid cookie', () => {
    expect(twitterIdFromTwidCookie('twid=u%3D42')).toBe('42')
    expect(twitterIdFromTwidCookie('foo=1; twid="u=11348282"; bar=2')).toBe(
      '11348282',
    )
    expect(twitterIdFromTwidCookie('auth_token=secret')).toBeUndefined()
  })

  it('prefers twid over observations for the signed-in account', () => {
    const link = {
      getAttribute(name: string) {
        return name === 'href' ? '/keutmann' : null
      },
    }
    const doc = {
      querySelectorAll(selector: string) {
        if (selector.includes('AppTabBar_Profile_Link')) return [link]
        return []
      },
      querySelector() {
        return null
      },
    } as unknown as Document

    const identities = new Map([
      ['keutmann', { twitterId: '999', handle: 'keutmann', observedAt: 1 }],
    ])
    expect(
      resolveActiveAccount(identities, doc, 42, 'twid=u%3D123456789'),
    ).toEqual({
      handle: 'keutmann',
      twitterId: '123456789',
      detectedAt: 42,
    })
  })

  it('detects the profile tab link and resolves a numeric ID from observations', () => {
    const link = {
      getAttribute(name: string) {
        return name === 'href' ? '/nasa' : null
      },
    }
    const doc = {
      querySelectorAll(selector: string) {
        if (selector.includes('AppTabBar_Profile_Link')) return [link]
        return []
      },
      querySelector() {
        return null
      },
    } as unknown as Document

    expect(detectActiveAccountHandle(doc)).toBe('nasa')

    const identities = new Map([
      ['nasa', { twitterId: '11348282', handle: 'nasa', observedAt: 1 }],
    ])
    expect(resolveActiveAccount(identities, doc, 42, '')).toEqual({
      handle: 'nasa',
      twitterId: '11348282',
      detectedAt: 42,
    })
  })

  it('reads twitterId from Schema.org Person microdata when observations are empty', () => {
    const link = {
      getAttribute(name: string) {
        return name === 'href' ? '/nasa' : null
      },
    }
    const idMeta = {
      getAttribute(name: string) {
        return name === 'content' ? '11348282' : null
      },
    }
    const nameMeta = {
      getAttribute(name: string) {
        return name === 'content' ? 'NASA' : null
      },
    }
    const person = {
      querySelector(selector: string) {
        if (selector.includes('additionalName') || selector.includes('name')) {
          return nameMeta
        }
        if (selector.includes('identifier')) return idMeta
        return null
      },
    }
    const doc = {
      querySelectorAll(selector: string) {
        if (selector.includes('AppTabBar_Profile_Link')) return [link]
        return []
      },
      querySelector(selector: string) {
        if (selector.includes('schema.org/Person')) return person
        return null
      },
    } as unknown as Document

    expect(twitterIdFromDocument(doc, 'nasa')).toBe('11348282')
    expect(resolveActiveAccount(new Map(), doc, 7, '')).toEqual({
      handle: 'nasa',
      twitterId: '11348282',
      detectedAt: 7,
    })
  })
})
