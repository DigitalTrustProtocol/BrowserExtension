/** @vitest-environment happy-dom */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetContentI18nForTests } from '../i18n'
import type { TrustSummary } from '../trust-summary'
import {
  SIGNAL_STYLE_ID,
  findDisplayNameElement,
  formatTrustScore,
  setAuthorTone,
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
  })

  it('is idempotent when re-applying the same author tone', () => {
    const article = statusArticle()
    setAuthorTone(article, 'question')
    setAuthorTone(article, 'question')
    expect(article.dataset.attentionxAuthorTone).toBe('question')
  })
})
