/** @vitest-environment happy-dom */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetContentI18nForTests } from '../i18n'
import type { TrustSummary } from '../trust-summary'
import {
  SIGNAL_STYLE_ID,
  findDisplayNameElement,
  formatTrustScore,
  patternForTone,
  setAuthorTone,
  setConnectPeopleTone,
  setPostTone,
} from './signals'

beforeAll(() => {
  resetContentI18nForTests()
})

beforeEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
  resetContentI18nForTests()
})

describe('formatTrustScore', () => {
  const base: TrustSummary = {
    resolution: 'none',
    tone: 'neutral',
    trustCount: 0,
    distrustCount: 0,
    paths: 0,
    truncated: false,
  }

  it('labels direct trust at degree 0', () => {
    expect(
      formatTrustScore({
        ...base,
        resolution: 'trusted',
        tone: 'trust',
        direct: 1,
        degree: 0,
        trustCount: 1,
        paths: 1,
      }),
    ).toBe('Trusted by you')
    expect(
      formatTrustScore({
        ...base,
        resolution: 'distrusted',
        tone: 'misleading',
        direct: -1,
        degree: 0,
        distrustCount: 1,
        paths: 1,
      }),
    ).toBe('Distrusted by you')
  })

  it('keeps hop labels for network-only evidence', () => {
    expect(
      formatTrustScore({
        ...base,
        resolution: 'trusted',
        tone: 'trust',
        degree: 1,
        trustCount: 1,
        paths: 1,
      }),
    ).toBe('Trusted · 1°')
  })

  it('can show text and degree independently', () => {
    const summary: TrustSummary = {
      ...base,
      resolution: 'trusted',
      tone: 'trust',
      degree: 2,
      trustCount: 1,
      paths: 1,
    }
    expect(formatTrustScore(summary)).toBe('Trusted · 2°')
    expect(formatTrustScore(summary, { text: true, degree: false })).toBe(
      'Trusted',
    )
    expect(formatTrustScore(summary, { text: false, degree: true })).toBe('2°')
  })
})

describe('status-page ambient display name', () => {
  function statusArticle(): HTMLElement {
    const article = document.createElement('article')
    article.dataset.testid = 'tweet'
    // Avatar link (empty text) appears before User-Name in real status DOM.
    article.innerHTML = `
      <a href="/keeevin__"></a>
      <div data-testid="User-Name" style="display:flex;flex-direction:column">
        <div>
          <a href="/keeevin__">
            <div><span><span>Almeida</span></span></div>
          </a>
        </div>
        <div><a href="/keeevin__"><span>@Keeevin__</span></a></div>
      </div>
    `
    document.body.append(article)
    return article
  }

  it('resolves the leaf name span and skips empty avatar profile links', () => {
    const article = statusArticle()

    const el = findDisplayNameElement(article)
    expect(el?.textContent?.trim()).toBe('Almeida')
    expect(el?.tagName).toBe('SPAN')

    setAuthorTone(article, 'question')
    expect(article.dataset.attentionxAuthorTone).toBe('question')
    // Ambient underline is CSS from article tone — no leaf attribute stamps.
    expect(article.querySelector('[data-attentionx-display-name]')).toBeNull()
    const style = document.getElementById(SIGNAL_STYLE_ID)?.textContent ?? ''
    expect(style).toContain('[data-attentionx-author-tone="question"]')
    expect(style).toContain('span > span:not(:has(span))')
    expect(style).toContain('text-decoration-style: dashed')
  })

  it('is idempotent when re-applying the same author tone', () => {
    const article = statusArticle()
    setAuthorTone(article, 'question')
    setAuthorTone(article, 'question')
    expect(article.dataset.attentionxAuthorTone).toBe('question')
  })
})

describe('UserCell ambient display name', () => {
  function whoToFollowNameColumn(): HTMLElement {
    const col = document.createElement('div')
    col.innerHTML = `
      <div>
        <a href="/NASA">
          <div>
            <span><span>NASA</span></span>
          </div>
        </a>
      </div>
      <div>
        <a href="/NASA"><div><span>@NASA</span></div></a>
      </div>
    `
    document.body.append(col)
    return col
  }

  it('selects the nested name leaf from the stamped column, not a nested tone attr', () => {
    const col = whoToFollowNameColumn()
    setConnectPeopleTone(col, 'question')
    expect(col.dataset.attentionxConnectTone).toBe('question')

    const style = document.getElementById(SIGNAL_STYLE_ID)?.textContent ?? ''
    expect(style).toContain(
      '[data-attentionx-connect-tone="question"] a[href^="/"]:not([href*="/status/"]) span > span:not(:has(span)):not([data-attentionx-score]):not([data-attentionx-connect-meta]):not([data-attentionx-chip])',
    )
    expect(style).not.toContain(
      '[data-attentionx-connect-tone="question"] [data-attentionx-connect-tone]',
    )
    expect(style).toContain(
      '> a[href^="/"]:not([href*="/status/"]):first-of-type:not(:has(span))',
    )

    const nameLeaf = col.querySelector('span > span')
    expect(nameLeaf?.textContent).toBe('NASA')
    expect(
      nameLeaf?.matches(
        '[data-attentionx-connect-tone="question"] a[href^="/"]:not([href*="/status/"]) span > span:not(:has(span)):not([data-attentionx-score]):not([data-attentionx-connect-meta]):not([data-attentionx-chip])',
      ),
    ).toBe(true)

    const handle = [...col.querySelectorAll('span')].find(
      (span) => span.textContent === '@NASA',
    )
    expect(
      handle?.matches(
        '[data-attentionx-connect-tone="question"] a[href^="/"]:not([href*="/status/"]) span > span:not(:has(span)):not([data-attentionx-score]):not([data-attentionx-connect-meta]):not([data-attentionx-chip])',
      ),
    ).toBe(false)
  })

  it('does not underline UserRail degree inside the display-name link', () => {
    const col = document.createElement('div')
    col.innerHTML = `
      <a href="/NASA">
        <span>
          <span>NASA</span>
          <span data-attentionx-connect-meta="true">
            <span data-attentionx-score="true">1°</span>
          </span>
        </span>
      </a>
    `
    document.body.append(col)
    setConnectPeopleTone(col, 'trust')

    const leaf =
      '[data-attentionx-connect-tone="trust"] a[href^="/"]:not([href*="/status/"]) span > span:not(:has(span)):not([data-attentionx-score]):not([data-attentionx-connect-meta]):not([data-attentionx-chip])'
    const nameLeaf = [...col.querySelectorAll('span')].find(
      (span) => span.textContent === 'NASA' && !span.querySelector('span'),
    )
    const degree = col.querySelector('[data-attentionx-score]')
    const wholeLink = col.querySelector('a')
    expect(nameLeaf?.matches(leaf)).toBe(true)
    expect(degree?.matches(leaf)).toBe(false)
    expect(
      wholeLink?.matches(
        '[data-attentionx-connect-tone="trust"] > a[href^="/"]:not([href*="/status/"]):first-of-type:not(:has(span))',
      ),
    ).toBe(false)
  })
})

describe('tone pattern', () => {
  it('maps tones to underline/sideline patterns', () => {
    expect(patternForTone('trust')).toBe('solid')
    expect(patternForTone('question')).toBe('dashed')
    expect(patternForTone('misleading')).toBe('double')
  })
})

describe('post tone stamp', () => {
  it('stamps the article without a layout box-shadow', () => {
    const article = document.createElement('article')
    document.body.append(article)
    setPostTone(article, 'trust')
    expect(article.dataset.attentionxPostTone).toBe('trust')
    const style = document.getElementById(SIGNAL_STYLE_ID)?.textContent ?? ''
    expect(style).toContain('text-decoration-style: solid')
    expect(style).not.toContain('box-shadow')
    expect(style).toContain('[data-attentionx-score]')
    expect(style).toContain('text-decoration: none !important')
    setPostTone(article, 'neutral')
    expect(article.dataset.attentionxPostTone).toBeUndefined()
  })
})
