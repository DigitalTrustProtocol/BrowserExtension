/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from 'vitest'
import {
  ARTICLE_SELECTOR,
  findAuthorChipSlot,
  findAuthorNameRow,
  findAuthorVerifiedBadge,
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

    const authorSlot = findAuthorChipSlot(article)
    expect(authorSlot?.before).toBe(
      article.querySelector('[aria-label="Grok actions"]'),
    )

    const postSlot = findPostChipSlot(article)
    expect(postSlot?.before).toBe(
      article.querySelector('[aria-label="Bookmark"]'),
    )

    expect(findPostMoreMenu(article)?.getAttribute('data-testid')).toBe('caret')

    expect(parseArticle(article)?.postTarget).toMatchObject({
      id: '123',
      handle: 'alice',
    })
  })
})
