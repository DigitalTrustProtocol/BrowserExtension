/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from 'vitest'
import {
  ARTICLE_SELECTOR,
  AUTHOR_META_ATTR,
  classifyPage,
  ensureAuthorNameMetaMount,
  findAuthorAvatarAnchor,
  findAuthorNameRow,
  findAuthorVerifiedBadge,
  findPostActionBarAnchor,
  findPostChipSlot,
  findPostMoreMenu,
  placePostActionStar,
  identitiesByHandle,
  parseArticle,
  placeAfterDisplayNameIcons,
  parseProfileHref,
  parseStatusHref,
  profileHandleFromPathname,
  rememberObservedHandle,
} from './scanner'

afterEach(() => {
  document.body.replaceChildren()
  window.history.replaceState({}, '', '/')
})

describe('parseStatusHref', () => {
  it('accepts relative and absolute status URLs', () => {
    expect(parseStatusHref('/elonmusk/status/2081627240777895998')).toEqual({
      handle: 'elonmusk',
      postId: '2081627240777895998',
    })
    expect(
      parseStatusHref(
        'https://x.com/elonmusk/status/2081627240777895998/photo/1',
      ),
    ).toEqual({
      handle: 'elonmusk',
      postId: '2081627240777895998',
    })
  })
})

describe('parseProfileHref', () => {
  it('accepts profile paths and rejects reserved / status routes', () => {
    expect(parseProfileHref('/elonmusk')).toBe('elonmusk')
    expect(parseProfileHref('https://x.com/alice')).toBe('alice')
    expect(parseProfileHref('/home')).toBeUndefined()
    expect(parseProfileHref('/elonmusk/status/1')).toBeUndefined()
    expect(parseProfileHref('/elonmusk/with_replies')).toBeUndefined()
  })
})

describe('profileHandleFromPathname', () => {
  it('accepts profile roots and known tabs', () => {
    expect(profileHandleFromPathname('/nasa')).toBe('nasa')
    expect(profileHandleFromPathname('/nasa/with_replies')).toBe('nasa')
    expect(profileHandleFromPathname('/nasa/media')).toBe('nasa')
    expect(profileHandleFromPathname('/nasa/followers')).toBe('nasa')
  })

  it('rejects status URLs and reserved routes', () => {
    expect(profileHandleFromPathname('/nasa/status/123')).toBeUndefined()
    expect(profileHandleFromPathname('/home')).toBeUndefined()
    expect(profileHandleFromPathname('/i/bookmarks')).toBeUndefined()
    expect(profileHandleFromPathname('/nasa/lists')).toBeUndefined()
  })
})

describe('classifyPage', () => {
  function pageKind(path: string): string {
    window.history.replaceState({}, '', path)
    return classifyPage()
  }

  it('labels timeline, status, profile, and other routes', () => {
    expect(pageKind('/home')).toBe('timeline')
    expect(pageKind('/explore')).toBe('timeline')
    expect(pageKind('/notifications')).toBe('timeline')
    expect(pageKind('/search?q=test')).toBe('timeline')
    expect(pageKind('/i/bookmarks')).toBe('timeline')
    expect(pageKind('/i/history')).toBe('timeline')
    expect(pageKind('/i/lists/123')).toBe('timeline')
    expect(pageKind('/elonmusk/status/123')).toBe('status')
    expect(pageKind('/nasa')).toBe('profile')
    expect(pageKind('/nasa/with_replies')).toBe('profile')
    expect(pageKind('/nasa/media')).toBe('profile')
    expect(pageKind('/i/connect_people')).toBe('connect')
    expect(pageKind('/compose/post')).toBe('other')
    expect(pageKind('/i/communities/abc')).toBe('other')
  })
})

describe('parseArticle on status pages', () => {
  it('uses the page URL for the focused primary article without a self link', () => {
    window.history.replaceState(
      {},
      '',
      '/elonmusk/status/2081627240777895998',
    )

    const article = document.createElement('article')
    article.dataset.testid = 'tweet'
    article.innerHTML = `
      <div data-testid="User-Name">
        <a href="/elonmusk">Elon Musk</a>
        <a href="/elonmusk">@elonmusk</a>
      </div>
      <a href="https://x.com/cb_doge/status/2081600000000000000">parent</a>
      <div role="group"><button data-testid="bookmark"></button></div>
    `
    document.body.append(article)

    expect(document.querySelector(ARTICLE_SELECTOR)).toBe(article)
    expect(parseArticle(article)?.postTarget).toMatchObject({
      id: '2081627240777895998',
      handle: 'elonmusk',
    })
  })

  it('still parses replies below the focused post from their own links', () => {
    window.history.replaceState(
      {},
      '',
      '/elonmusk/status/2081627240777895998',
    )

    const primary = document.createElement('article')
    primary.dataset.testid = 'tweet'
    primary.innerHTML = `<div data-testid="User-Name"><a href="/elonmusk">Elon</a></div>`
    const reply = document.createElement('article')
    reply.dataset.testid = 'tweet'
    reply.innerHTML = `
      <div data-testid="User-Name"><a href="/alice">Alice</a></div>
      <a href="/alice/status/999">permalink</a>
    `
    document.body.append(primary, reply)

    expect(parseArticle(reply)?.postTarget).toMatchObject({
      id: '999',
      handle: 'alice',
    })
  })

  it('uses a hoisted first-article context instead of querying per article', () => {
    window.history.replaceState(
      {},
      '',
      '/elonmusk/status/2081627240777895998',
    )

    const primary = document.createElement('article')
    primary.dataset.testid = 'tweet'
    primary.innerHTML = `
      <div data-testid="User-Name"><a href="/elonmusk">Elon Musk</a></div>
      <a href="https://x.com/cb_doge/status/2081600000000000000">parent</a>
    `
    const reply = document.createElement('article')
    reply.dataset.testid = 'tweet'
    reply.innerHTML = `
      <div data-testid="User-Name"><a href="/alice">Alice</a></div>
      <a href="/alice/status/999">permalink</a>
    `
    document.body.append(primary, reply)

    // Correct context: the focused article resolves from the page URL.
    expect(
      parseArticle(primary, { firstArticle: primary })?.postTarget,
    ).toMatchObject({ id: '2081627240777895998', handle: 'elonmusk' })
    expect(parseArticle(reply, { firstArticle: primary })?.postTarget).toMatchObject({
      id: '999',
      handle: 'alice',
    })

    // A wrong context proves the hint is authoritative (no fallback query):
    // the focused article is no longer primary and falls to its parent link.
    expect(parseArticle(primary, { firstArticle: reply })?.postTarget.id).toBe(
      '2081600000000000000',
    )
  })
})

describe('structure-independent author anchors', () => {
  it('finds the name row from profile links without User-Name testids', () => {
    const article = document.createElement('article')
    article.dataset.testid = 'tweet'
    article.innerHTML = `
      <div class="header-whatever">
        <a href="/alice"><img alt="Alice" width="40" height="40" /></a>
        <div class="name-cluster">
          <a href="/alice">Alice</a>
          <svg aria-label="Verified account"></svg>
          <a href="/alice">@alice</a>
        </div>
        <button aria-label="Grok actions"></button>
        <button data-testid="caret" aria-label="More"></button>
      </div>
      <a href="/alice/status/123">permalink</a>
      <div role="group">
        <button aria-label="Reply"></button>
        <button aria-label="Bookmark"></button>
      </div>
    `
    document.body.append(article)

    const row = findAuthorNameRow(article)
    expect(row?.textContent).toContain('Alice')
    expect(row?.textContent).toContain('@alice')
    expect(findAuthorVerifiedBadge(article)?.getAttribute('aria-label')).toBe(
      'Verified account',
    )

    const authorMeta = ensureAuthorNameMetaMount(article)
    expect(authorMeta?.getAttribute(AUTHOR_META_ATTR)).toBe('true')
    expect(row?.lastElementChild).toBe(authorMeta)

    const avatar = findAuthorAvatarAnchor(article)
    expect(avatar?.querySelector('img')).toBeTruthy()

    const postSlot = findPostChipSlot(article)
    expect(postSlot?.before).toBe(
      article.querySelector('[aria-label="Bookmark"]'),
    )
    expect(findPostActionBarAnchor(article)).toBe(postSlot?.parent)

    const wrapped = document.createElement('article')
    wrapped.innerHTML = `
      <div role="group">
        <div><button data-testid="reply"></button></div>
        <div><button data-testid="bookmark"></button></div>
        <div><button data-testid="share"></button></div>
      </div>
    `
    document.body.append(wrapped)
    const star = document.createElement('span')
    expect(placePostActionStar(wrapped, star)).toBe(true)
    const wrappedBar = wrapped.querySelector('[role="group"]')
    const bookmarkSlot = wrapped.querySelector('[data-testid="bookmark"]')?.parentElement
    expect(star.parentElement).toBe(wrappedBar)
    expect(star.nextElementSibling).toBe(bookmarkSlot)
    expect(bookmarkSlot?.contains(star)).toBe(false)
    expect(placePostActionStar(wrapped, star)).toBe(true)
    expect(star.nextElementSibling).toBe(bookmarkSlot)

    expect(findPostMoreMenu(article)?.getAttribute('data-testid')).toBe('caret')

    expect(parseArticle(article)?.postTarget).toMatchObject({
      id: '123',
      handle: 'alice',
    })
  })

  it('prefers UserAvatar testids for the overlay anchor', () => {
    const article = document.createElement('article')
    article.dataset.testid = 'tweet'
    article.innerHTML = `
      <div data-testid="UserAvatar-Container"><img alt="x" /></div>
      <div data-testid="User-Name"><a href="/bob">Bob</a></div>
    `
    document.body.append(article)
    expect(findAuthorAvatarAnchor(article)?.dataset.testid).toBe(
      'UserAvatar-Container',
    )
  })

  it('appends the author meta mount as the last User-Name child', () => {
    const article = document.createElement('article')
    article.dataset.testid = 'tweet'
    article.innerHTML = `
      <div class="tweet-header">
        <div class="name-column">
          <div class="name-wrap">
            <div data-testid="User-Name">
              <a href="/alice">Alice</a>
              <a href="/alice">@alice</a>
              <a href="/alice/status/1"><time datetime="2026-07-31">2h</time></a>
            </div>
          </div>
        </div>
        <div class="trailing">
          <button aria-label="Grok actions"></button>
          <button data-testid="caret" aria-label="More"></button>
        </div>
      </div>
    `
    document.body.append(article)

    const name = article.querySelector('[data-testid="User-Name"]')
    const meta = ensureAuthorNameMetaMount(article)
    expect(meta?.tagName).toBe('DIV')
    expect(meta?.getAttribute(AUTHOR_META_ATTR)).toBe('true')
    expect(name?.lastElementChild).toBe(meta)
    expect(meta?.parentElement).toBe(name)
  })

  it('mounts on the first inner row when User-Name is a column', () => {
    const article = document.createElement('article')
    article.dataset.testid = 'tweet'
    article.innerHTML = `
      <div data-testid="User-Name" style="display:flex;flex-direction:column">
        <div style="display:flex;flex-direction:row" data-name-row="true">
          <a href="/starlink">Starlink</a>
        </div>
        <div style="display:flex;flex-direction:row">
          <a href="/starlink">@Starlink</a>
        </div>
      </div>
    `
    document.body.append(article)

    const name = article.querySelector('[data-testid="User-Name"]')
    const firstRow = article.querySelector<HTMLElement>('[data-name-row]')
    const meta = ensureAuthorNameMetaMount(article)
    expect(meta?.parentElement).toBe(firstRow)
    expect(firstRow?.lastElementChild).toBe(meta)
    expect(name?.lastElementChild).not.toBe(meta)
  })
})

describe('rememberObservedHandle', () => {
  afterEach(() => {
    identitiesByHandle.clear()
  })

  it('records a public handle→twitterId mapping when the map is empty', () => {
    expect(rememberObservedHandle('Starlink', '593711570')).toBe(true)
    expect(identitiesByHandle.get('starlink')?.twitterId).toBe('593711570')
  })

  it('does not overwrite an existing page-world observation', () => {
    identitiesByHandle.set('starlink', {
      twitterId: '1',
      handle: 'starlink',
      observedAt: 1,
    })
    expect(rememberObservedHandle('Starlink', '593711570')).toBe(false)
    expect(identitiesByHandle.get('starlink')?.twitterId).toBe('1')
  })

  it('rejects handle-shaped follow ids', () => {
    expect(rememberObservedHandle('alice', 'alice')).toBe(false)
    expect(identitiesByHandle.size).toBe(0)
  })
})

describe('placeAfterDisplayNameIcons', () => {
  it('places UserHero chrome on the unlinked profile name line after verified icons', () => {
    document.body.innerHTML = `
      <main role="main">
        <div data-testid="UserName">
          <div class="name-column">
            <span class="name-line">
              <span>NASA</span>
              <span class="badge">
                <button type="button" aria-label="Provides details about verified accounts.">
                  <svg data-testid="icon-verified" aria-label="Verified account"></svg>
                </button>
              </span>
            </span>
            <span>@NASA</span>
          </div>
        </div>
      </main>
    `
    const scope = document.querySelector<HTMLElement>('[data-testid="UserName"]')
    expect(scope).toBeTruthy()
    const host = document.createElement('span')
    host.setAttribute('data-attentionx-profile-score', 'true')
    placeAfterDisplayNameIcons(scope!, host)

    const nameLine = document.querySelector('.name-line')
    expect(host.parentElement).toBe(nameLine)
    expect(nameLine?.lastElementChild).toBe(host)
    expect(scope?.lastElementChild?.className).toBe('name-column')
  })

  it('places chrome on the name line when the profile has no verified badge', () => {
    document.body.innerHTML = `
      <main role="main">
        <div data-testid="UserName" style="display:flex;flex-direction:row">
          <div class="name-column">
            <div class="name-line" style="display:flex;flex-direction:row">
              <span><span>Alice</span></span>
            </div>
            <span>@alice</span>
          </div>
        </div>
      </main>
    `
    const scope = document.querySelector<HTMLElement>('[data-testid="UserName"]')
    const host = document.createElement('span')
    host.setAttribute('data-attentionx-profile-chip', 'true')
    placeAfterDisplayNameIcons(scope!, host)

    expect(host.closest('.name-line')).toBeTruthy()
    expect(host.closest('.name-column')).toBeTruthy()
    expect(scope?.contains(host)).toBe(true)
    expect(scope?.lastElementChild).not.toBe(host)
  })
})
