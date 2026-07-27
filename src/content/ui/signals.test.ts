/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearAllSignals,
  ensureSignalStylesheet,
  markDisplayName,
  setAuthorTone,
  setPostTone,
  setProfileTone,
  SIGNAL_STYLE_ID,
} from './signals'

beforeEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

describe('ambient signals', () => {
  it('injects the stylesheet exactly once', () => {
    ensureSignalStylesheet()
    ensureSignalStylesheet()

    expect(document.querySelectorAll(`#${SIGNAL_STYLE_ID}`)).toHaveLength(1)
  })

  it('underlines only the display name, not the @handle', () => {
    const article = document.createElement('article')
    article.innerHTML = `
      <div data-testid="User-Name">
        <a href="/nasa">NASA</a>
        <a href="/nasa">@nasa</a>
      </div>
    `
    document.body.append(article)

    setAuthorTone(article, 'trust')

    const links = [
      ...article.querySelectorAll<HTMLAnchorElement>('a[href^="/"]'),
    ]
    expect(links[0]?.dataset.attentionxDisplayName).toBe('true')
    expect(links[1]?.dataset.attentionxDisplayName).toBeUndefined()
  })

  it('marks plain span display names on profile headers', () => {
    const root = document.createElement('div')
    root.dataset.testid = 'UserName'
    root.innerHTML = `
      <span><span>Elon Musk</span></span>
      <span>@elonmusk</span>
    `
    document.body.append(root)

    setProfileTone(root, 'trust')
    expect(
      root.querySelector('[data-attentionx-display-name]')?.textContent,
    ).toBe('Elon Musk')
  })

  it('writes tones as data attributes and drops neutral ones', () => {
    const article = document.createElement('article')
    document.body.append(article)

    setAuthorTone(article, 'trust')
    setPostTone(article, 'misleading')
    expect(article.dataset.attentionxAuthorTone).toBe('trust')
    expect(article.dataset.attentionxPostTone).toBe('misleading')

    setAuthorTone(article, 'neutral')
    expect(article.dataset.attentionxAuthorTone).toBeUndefined()
  })

  it('fully reverts the page on cleanup', () => {
    const article = document.createElement('article')
    article.innerHTML = `<div data-testid="User-Name"><a href="/nasa">NASA</a></div>`
    document.body.append(article)
    ensureSignalStylesheet()
    setAuthorTone(article, 'trust')
    setPostTone(article, 'question')
    markDisplayName(article, 'trust')

    clearAllSignals()

    expect(document.getElementById(SIGNAL_STYLE_ID)).toBeNull()
    expect(article.dataset.attentionxAuthorTone).toBeUndefined()
    expect(article.dataset.attentionxPostTone).toBeUndefined()
    expect(
      article.querySelector('[data-attentionx-display-name]'),
    ).toBeNull()
  })
})
