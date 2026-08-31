/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from 'vitest'
import {
  activeAccountReportKey,
  decideActiveAccountReport,
  detectActiveAccountHandle,
  handleFromProfileHref,
  LOGGED_OUT_REPORT_KEY,
  previousReportHadTwitterId,
  readActiveAccountProfile,
  resolveActiveAccount,
  twitterIdFromDocument,
  twitterIdFromTwidCookie,
} from './active-account'

afterEach(() => {
  document.body.replaceChildren()
})

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

  it('detects the profile tab link without trusting observation-map IDs', () => {
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
    // Observation-sourced IDs must not become the active account id.
    expect(resolveActiveAccount(identities, doc, 42, '')).toEqual({
      handle: 'nasa',
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

  it('scopes /i/user/ links to expectedHandle and keeps first-match without one', () => {
    type MockNode = {
      tagName: string
      parentElement: MockNode | null
      children: MockNode[]
      getAttribute: (name: string) => string | null
      querySelectorAll: (selector: string) => MockNode[]
    }

    const collectMatching = (
      root: MockNode,
      predicate: (node: MockNode) => boolean,
    ): MockNode[] => {
      const found: MockNode[] = []
      const visit = (node: MockNode): void => {
        if (predicate(node)) found.push(node)
        for (const child of node.children) visit(child)
      }
      for (const child of root.children) visit(child)
      return found
    }

    const makeAnchor = (href: string): MockNode => ({
      tagName: 'A',
      parentElement: null,
      children: [],
      getAttribute(name) {
        return name === 'href' ? href : null
      },
      querySelectorAll() {
        return []
      },
    })

    const makeDiv = (children: MockNode[]): MockNode => {
      const div: MockNode = {
        tagName: 'DIV',
        parentElement: null,
        children,
        getAttribute() {
          return null
        },
        querySelectorAll(selector) {
          if (selector.includes('/i/user/')) {
            return collectMatching(div, (node) =>
              Boolean(node.getAttribute('href')?.includes('/i/user/')),
            )
          }
          if (selector.includes('a[href')) {
            return collectMatching(div, (node) => node.tagName === 'A')
          }
          return []
        },
      }
      for (const child of children) child.parentElement = div
      return div
    }

    const foreignUser = makeAnchor('/i/user/111')
    const foreignHandle = makeAnchor('/other')
    const foreign = makeDiv([foreignHandle, foreignUser])

    const selfUser = makeAnchor('/i/user/11348282')
    const selfHandle = makeAnchor('/nasa')
    const self = makeDiv([selfHandle, selfUser])

    const body = makeDiv([foreign, self])
    foreign.parentElement = body
    self.parentElement = body

    const doc = {
      querySelector() {
        return null
      },
      querySelectorAll(selector: string) {
        if (selector.includes('/i/user/')) return [foreignUser, selfUser]
        return []
      },
    } as unknown as Document

    expect(twitterIdFromDocument(doc, 'nasa')).toBe('11348282')
    expect(twitterIdFromDocument(doc, 'other')).toBe('111')
    expect(twitterIdFromDocument(doc, 'missing')).toBeUndefined()
    expect(twitterIdFromDocument(doc)).toBe('111')
  })

  it('reads displayName and iconPath from SideNav account switcher', () => {
    document.body.innerHTML = `
      <div data-testid="SideNav_AccountSwitcher_Button"
           aria-label="NASA @NASA">
        <img src="https://pbs.twimg.com/profile_images/11348282/nasa_normal.jpg" />
        <a href="/NASA">@NASA</a>
      </div>
      <a data-testid="AppTabBar_Profile_Link" href="/NASA">Profile</a>
    `

    expect(readActiveAccountProfile(document, 'nasa')).toEqual({
      displayName: 'NASA',
      iconPath: 'https://pbs.twimg.com/profile_images/11348282/nasa_normal.jpg',
    })
    expect(
      resolveActiveAccount(new Map(), document, 9, 'twid=u%3D11348282'),
    ).toEqual({
      handle: 'nasa',
      twitterId: '11348282',
      detectedAt: 9,
      displayName: 'NASA',
      iconPath: 'https://pbs.twimg.com/profile_images/11348282/nasa_normal.jpg',
    })
  })

  it('reads displayName when SideNav aria-label is the generic Account menu', () => {
    document.body.innerHTML = `
      <button data-testid="SideNav_AccountSwitcher_Button" aria-label="Account menu">
        <div aria-label="Digital Trust Protocol">
          <img
            alt="Digital Trust Protocol"
            src="https://pbs.twimg.com/profile_images/1008616932566798336/nAcdavNy_normal.jpg"
          />
        </div>
        <div>Digital Trust Protocol</div>
        <div>@TrustProtocol</div>
      </button>
      <a data-testid="AppTabBar_Profile_Link" href="/TrustProtocol">Profile</a>
    `

    expect(readActiveAccountProfile(document, 'trustprotocol')).toEqual({
      displayName: 'Digital Trust Protocol',
      iconPath:
        'https://pbs.twimg.com/profile_images/1008616932566798336/nAcdavNy_normal.jpg',
    })
  })

  it('ignores non-pbs avatars and generic aria labels', () => {
    document.body.innerHTML = `
      <div data-testid="SideNav_AccountSwitcher_Button" aria-label="Account menu">
        <img src="https://abs.twimg.com/sticky/default_profile.png" />
      </div>
      <a data-testid="AppTabBar_Profile_Link" href="/nasa">Profile</a>
    `
    expect(readActiveAccountProfile(document, 'nasa')).toEqual({})
  })

  it('builds report keys and detects prior numeric ids for dedupe', () => {
    const key = activeAccountReportKey({
      handle: 'nasa',
      twitterId: '11348282',
      displayName: 'NASA',
      iconPath: 'profile_images/11348282/nasa',
    })
    expect(previousReportHadTwitterId(key, 'nasa')).toBe(true)
    expect(
      previousReportHadTwitterId(
        activeAccountReportKey({ handle: 'nasa', displayName: 'NASA' }),
        'nasa',
      ),
    ).toBe(false)
    expect(previousReportHadTwitterId(key, 'other')).toBe(false)
  })

  it('reports logout on first observation without twid, not only after a prior account', () => {
    const first = decideActiveAccountReport({
      account: null,
      twid: undefined,
      lastReportedKey: '',
    })
    expect(first.decision).toEqual({ action: 'logout' })
    expect(first.nextKey).toBe(LOGGED_OUT_REPORT_KEY)
    const again = decideActiveAccountReport({
      account: null,
      twid: undefined,
      lastReportedKey: LOGGED_OUT_REPORT_KEY,
    })
    expect(again.decision).toEqual({ action: 'none' })
  })

  it('does not logout when twid is present but the DOM handle is missing', () => {
    expect(
      decideActiveAccountReport({
        account: null,
        twid: '42',
        lastReportedKey: activeAccountReportKey({
          handle: 'alice',
          twitterId: '42',
        }),
      }).decision,
    ).toEqual({ action: 'none' })
  })
})
