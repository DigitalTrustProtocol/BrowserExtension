/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_TRUST_FILTERS } from '../../shared/x-augmentation'
import { resetContentI18nForTests } from '../i18n'
import {
  applyArticleFilter,
  clearArticleHide,
  isPromotedArticle,
  setArticleHidden,
  timelineCellForArticle,
} from './hide'

beforeEach(() => {
  document.body.replaceChildren()
  resetContentI18nForTests()
})

describe('applyArticleFilter', () => {
  const filtersOff = { ...DEFAULT_TRUST_FILTERS }

  function articleInCell(): { cell: HTMLElement; article: HTMLElement } {
    const cell = document.createElement('div')
    cell.dataset.testid = 'cellInnerDiv'
    const article = document.createElement('article')
    cell.append(article)
    document.body.append(cell)
    return { cell, article }
  }

  it('never hides or collapses promoted articles', () => {
    const { cell, article } = articleInCell()
    const tracking = document.createElement('div')
    tracking.dataset.testid = 'placementTracking'
    const pixel = document.createElement('div')
    pixel.dataset.testid = 'top-impression-pixel'
    tracking.append(pixel)
    article.append(tracking)

    const mode = applyArticleFilter({
      article,
      filters: { ...filtersOff, distrusted: 'hideAll' },
      author: {
        resolution: 'distrusted',
        tone: 'misleading',
        trustCount: 0,
        distrustCount: 1,
        paths: 1,
        truncated: false,
        degree: 1,
      },
      post: {
        resolution: 'distrusted',
        tone: 'misleading',
        trustCount: 0,
        distrustCount: 1,
        paths: 1,
        truncated: false,
        degree: 1,
      },
      displayName: 'Brand',
      handle: '@brand',
    })
    expect(mode).toBe('none')
    expect(cell.dataset.attentionxHidden).toBeUndefined()
    expect(cell.dataset.attentionxCollapsed).toBeUndefined()
  })

  it('hides the timeline cell for hide actions', () => {
    const { cell, article } = articleInCell()
    const mode = applyArticleFilter({
      article,
      filters: { ...filtersOff, distrusted: 'hidePost' },
      post: {
        resolution: 'distrusted',
        tone: 'misleading',
        trustCount: 0,
        distrustCount: 2,
        paths: 1,
        truncated: false,
        degree: 1,
      },
      author: {
        resolution: 'trusted',
        tone: 'trust',
        trustCount: 1,
        distrustCount: 0,
        paths: 1,
        truncated: false,
        degree: 2,
      },
      displayName: 'NASA',
      handle: '@nasa',
    })
    expect(mode).toBe('hide')
    expect(cell.dataset.attentionxHidden).toBe('true')
  })

  it('clears hide when filters no longer match', () => {
    const { cell, article } = articleInCell()
    applyArticleFilter({
      article,
      filters: { ...filtersOff, trusted: 'hideAll' },
      author: {
        resolution: 'trusted',
        tone: 'trust',
        trustCount: 1,
        distrustCount: 0,
        paths: 1,
        truncated: false,
        degree: 1,
      },
      displayName: 'NASA',
      handle: '@nasa',
    })
    expect(cell.dataset.attentionxHidden).toBe('true')

    const mode = applyArticleFilter({
      article,
      filters: { ...filtersOff },
      author: {
        resolution: 'trusted',
        tone: 'trust',
        trustCount: 1,
        distrustCount: 0,
        paths: 1,
        truncated: false,
        degree: 1,
      },
      displayName: 'NASA',
      handle: '@nasa',
    })
    expect(mode).toBe('none')
    expect(cell.dataset.attentionxHidden).toBeUndefined()
  })

  it('collapses with a bar that can expand and collapse again', () => {
    // X wraps <article> in nested divs — bar must sit on the cell, not require
    // a direct cell > article child for CSS hiding.
    const cell = document.createElement('div')
    cell.dataset.testid = 'cellInnerDiv'
    const wrap = document.createElement('div')
    const inner = document.createElement('div')
    const article = document.createElement('article')
    inner.append(article)
    wrap.append(inner)
    cell.append(wrap)
    document.body.append(cell)

    const mode = applyArticleFilter({
      article,
      filters: { ...filtersOff, distrusted: 'collapseUser' },
      author: {
        resolution: 'distrusted',
        tone: 'misleading',
        trustCount: 0,
        distrustCount: 1,
        paths: 1,
        truncated: false,
        degree: 1,
      },
      post: {
        resolution: 'trusted',
        tone: 'trust',
        trustCount: 1,
        distrustCount: 0,
        paths: 1,
        truncated: false,
        degree: 1,
      },
      displayName: 'Spammer',
      handle: '@spam',
    })
    expect(mode).toBe('collapse')
    expect(cell.dataset.attentionxCollapsed).toBe('true')
    expect(cell.firstElementChild?.hasAttribute('data-attentionx-collapse-bar')).toBe(
      true,
    )
    const style = document.getElementById('attentionx-timeline-filter')
    expect(style?.textContent).toContain(
      '[data-attentionx-collapsed="true"] > :not([data-attentionx-collapse-bar])',
    )
    const bar = cell.querySelector('[data-attentionx-collapse-bar]')
    expect(bar).toBeTruthy()
    expect(bar?.querySelector('.ax-collapse-name')?.textContent).toContain(
      'Spammer',
    )
    const button = bar?.querySelector<HTMLButtonElement>('.ax-collapse-toggle')
    expect(button?.textContent).toBe('Expand')

    button?.click()
    expect(cell.dataset.attentionxCollapsed).toBe('false')
    expect(button?.textContent).toBe('Collapse')

    button?.click()
    expect(cell.dataset.attentionxCollapsed).toBe('true')
    expect(button?.textContent).toBe('Expand')
  })

  it('does nothing when filters are none', () => {
    const { cell, article } = articleInCell()
    const mode = applyArticleFilter({
      article,
      filters: filtersOff,
      author: {
        resolution: 'distrusted',
        tone: 'misleading',
        trustCount: 0,
        distrustCount: 1,
        paths: 1,
        truncated: false,
        degree: 1,
      },
      post: {
        resolution: 'distrusted',
        tone: 'misleading',
        trustCount: 0,
        distrustCount: 1,
        paths: 1,
        truncated: false,
        degree: 1,
      },
      displayName: 'X',
    })
    expect(mode).toBe('none')
    expect(cell.dataset.attentionxHidden).toBeUndefined()
    expect(cell.querySelector('[data-attentionx-collapse-bar]')).toBeNull()
  })
})

describe('promoted detection and DOM hide', () => {
  it('detects promoted ads via impression pixels, not organic video players', () => {
    const organic = document.createElement('article')
    const organicTrack = document.createElement('div')
    organicTrack.dataset.testid = 'placementTracking'
    const player = document.createElement('div')
    player.dataset.testid = 'videoPlayer'
    organicTrack.append(player)
    organic.append(organicTrack)
    document.body.append(organic)
    expect(isPromotedArticle(organic)).toBe(false)

    const ad = document.createElement('article')
    const cell = document.createElement('div')
    cell.dataset.testid = 'cellInnerDiv'
    const adTrack = document.createElement('div')
    adTrack.dataset.testid = 'placementTracking'
    const pixel = document.createElement('div')
    pixel.dataset.testid = 'top-impression-pixel'
    adTrack.append(pixel)
    ad.append(adTrack)
    cell.append(ad)
    document.body.append(cell)
    expect(isPromotedArticle(ad)).toBe(true)
  })

  it('detects promoted ads from an Ad label near the author name', () => {
    const article = document.createElement('article')
    const wrap = document.createElement('div')
    const userName = document.createElement('div')
    userName.dataset.testid = 'User-Name'
    userName.textContent = '@brand'
    const adMark = document.createElement('span')
    adMark.textContent = 'Ad'
    wrap.append(userName, adMark)
    article.append(wrap)
    document.body.append(article)
    expect(isPromotedArticle(article)).toBe(true)
  })

  it('hides the timeline cell, not only the article', () => {
    const cell = document.createElement('div')
    cell.dataset.testid = 'cellInnerDiv'
    const article = document.createElement('article')
    cell.append(article)
    document.body.append(cell)

    expect(timelineCellForArticle(article)).toBe(cell)
    setArticleHidden(article, true)
    expect(cell.dataset.attentionxHidden).toBe('true')
    expect(article.dataset.attentionxHidden).toBeUndefined()

    clearArticleHide(article)
    expect(cell.dataset.attentionxHidden).toBeUndefined()
  })
})
