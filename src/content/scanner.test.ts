/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from 'vitest'
import {
  ARTICLE_SELECTOR,
  parseArticle,
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
