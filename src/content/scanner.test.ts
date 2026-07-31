/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from 'vitest'
import {
  ARTICLE_SELECTOR,
  AUTHOR_META_ATTR,
  ensureAuthorNameMetaMount,
  findAuthorAvatarAnchor,
  findAuthorNameRow,
  findAuthorVerifiedBadge,
  findPostActionBarAnchor,
  findPostChipSlot,
  findPostMoreMenu,
  parseArticle,
  parseProfileHref,
  parseStatusHref,
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
})
