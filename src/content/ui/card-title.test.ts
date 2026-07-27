/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import { capCardTitle, readPostHeadline } from './card-title'

describe('capCardTitle', () => {
  it('leaves short titles alone', () => {
    expect(capCardTitle('Hello world')).toBe('Hello world')
  })

  it('ellipsizes long titles near a word boundary', () => {
    const long =
      'This is a fairly long post title that should not stretch the popup forever'
    const capped = capCardTitle(long, 40)
    expect(capped.endsWith('…')).toBe(true)
    expect(capped.length).toBeLessThanOrEqual(41)
    expect(capped.includes('  ')).toBe(false)
  })
})

describe('readPostHeadline', () => {
  it('uses the first words of tweet text', () => {
    const article = document.createElement('article')
    article.innerHTML = `<div data-testid="tweetText">One two three four five six seven eight nine ten</div>`
    expect(readPostHeadline(article, '123')).toBe(
      'One two three four five six seven eight',
    )
  })

  it('falls back to image alt when there is no text', () => {
    const article = document.createElement('article')
    article.innerHTML = `
      <div data-testid="UserAvatar-Container"><img alt="avatar" /></div>
      <div data-testid="tweetPhoto"><img alt="Sunset over the bay" /></div>
    `
    expect(readPostHeadline(article, '123')).toBe('Sunset over the bay')
  })

  it('falls back to a short post id when media has no name', () => {
    const article = document.createElement('article')
    article.innerHTML = `<div data-testid="tweetPhoto"><img alt="Image" /></div>`
    expect(readPostHeadline(article, '2080659774136291424')).toBe(
      '2080659774136…',
    )
  })
})
