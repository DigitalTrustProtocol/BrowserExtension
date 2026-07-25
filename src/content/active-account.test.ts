import { describe, expect, it } from 'vitest'
import {
  detectActiveAccountHandle,
  handleFromProfileHref,
  resolveActiveAccount,
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

  it('detects the profile tab link and resolves a numeric ID from observations', () => {
    const link = {
      getAttribute(name: string) {
        return name === 'href' ? '/nasa' : null
      },
    }
    const doc = {
      querySelectorAll(selector: string) {
        return selector.includes('AppTabBar_Profile_Link') ? [link] : []
      },
      querySelector() {
        return null
      },
    } as unknown as Document

    expect(detectActiveAccountHandle(doc)).toBe('nasa')

    const identities = new Map([
      ['nasa', { twitterId: '11348282', handle: 'nasa', observedAt: 1 }],
    ])
    expect(resolveActiveAccount(identities, doc, 42)).toEqual({
      handle: 'nasa',
      twitterId: '11348282',
      detectedAt: 42,
    })
  })
})
