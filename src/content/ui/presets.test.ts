/** @vitest-environment happy-dom */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetContentI18nForTests } from '../i18n'
import {
  DEFAULT_X_AUGMENTATION_FEATURES,
  type XAugmentationFeatures,
} from '../../shared/x-augmentation'
import type { ArticleTargets } from '../types'
import { createPreset } from './presets'
import { ensureSignalStylesheet } from './signals'
import { UI_TIMELINE_FILTERING_ENABLED } from '../json-filter-bridge'

const targets: ArticleTargets = {
  postTarget: {
    type: 'post',
    id: '2080659774136291424',
    url: 'https://x.com/i/web/status/2080659774136291424',
    handle: 'nasa',
    twitterId: '11348282',
  },
  profileTarget: {
    type: 'profile',
    id: '11348282',
    url: 'https://x.com/i/user/11348282',
    handle: 'nasa',
    twitterId: '11348282',
  },
}

function createArticle(): HTMLElement {
  const article = document.createElement('article')
  article.dataset.testid = 'tweet'
  article.innerHTML = `
    <div data-testid="User-Name">
      <a href="/nasa"><div><span><span>NASA</span></span></div></a>
      <a href="/nasa"><span>@nasa</span></a>
    </div>
    <button aria-label="Grok actions">Grok</button>
    <div role="group">
      <button data-testid="reply"></button>
      <button data-testid="bookmark"></button>
    </div>
  `
  document.body.append(article)
  return article
}

const summaries = {
  author: {
    resolution: 'trusted' as const,
    tone: 'trust' as const,
    trustCount: 1,
    distrustCount: 0,
    paths: 1,
    truncated: false,
    degree: 2,
  },
  post: {
    resolution: 'distrusted' as const,
    tone: 'misleading' as const,
    trustCount: 0,
    distrustCount: 2,
    paths: 1,
    truncated: false,
    degree: 1,
  },
}

beforeAll(() => {
  resetContentI18nForTests()
})

beforeEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
  ensureSignalStylesheet()
  resetContentI18nForTests()
})

describe('feature-driven article presets', () => {
  it('mounts idempotently and reverts the article on unmount', () => {
    const article = createArticle()
    const before = article.innerHTML
    const preset = createPreset({ ...DEFAULT_X_AUGMENTATION_FEATURES })

    preset.mount(article, targets)
    preset.mount(article, targets)
    preset.update(article, targets, summaries)

    expect(article.querySelectorAll('[data-attentionx-chip]').length).toBe(2)
    expect(article.querySelectorAll('[data-attentionx-score]').length).toBe(2)

    preset.unmount(article)

    expect(article.innerHTML).toBe(before)
    expect(article.dataset.attentionxAuthorTone).toBeUndefined()
    expect(article.dataset.attentionxPostTone).toBeUndefined()
  })

  it('places author degree text and chip on the same inline row', () => {
    const article = createArticle()
    // Match status-page User-Name: column stack of display name + handle.
    const name = article.querySelector('[data-testid="User-Name"]')
    if (name instanceof HTMLElement) {
      name.style.display = 'flex'
      name.style.flexDirection = 'column'
      name.innerHTML = `
        <div>NASA</div>
        <div>@nasa</div>
      `
    }
    const preset = createPreset({
      ...DEFAULT_X_AUGMENTATION_FEATURES,
      chip: true,
      ambient: false,
      detailText: true,
      detailDegree: true,
      userCard: false,
      actionIcons: true,
    })
    preset.mount(article, targets)
    preset.update(article, targets, summaries)

    const cluster = article.querySelector('[data-attentionx-author-meta]')
    const score = cluster?.querySelector('[data-attentionx-score]')
    const chip = cluster?.querySelector('[data-attentionx-chip]')
    expect(cluster).toBeTruthy()
    expect(score).toBeTruthy()
    expect(chip).toBeTruthy()
    expect(score?.nextElementSibling).toBe(chip)
    expect(getComputedStyle(cluster as Element).flexWrap).toBe('nowrap')
    preset.destroy()
  })

  it('places the author chip before Grok and the post chip before bookmark', () => {
    const article = createArticle()
    const preset = createPreset({
      ...DEFAULT_X_AUGMENTATION_FEATURES,
      chip: true,
      ambient: false,
      detailText: false,
      detailDegree: false,
      userCard: false,
      actionIcons: true,
    })
    preset.mount(article, targets)

    const grok = article.querySelector('[aria-label="Grok actions"]')
    const bookmark = article.querySelector('[data-testid="bookmark"]')
    const chips = [...article.querySelectorAll('[data-attentionx-chip]')]
    expect(chips).toHaveLength(2)
    expect(chips[0]?.nextElementSibling).toBe(grok)
    expect(chips[1]?.nextElementSibling).toBe(bookmark)
    preset.destroy()
  })

  it('paints ambient tones only when ambient is enabled', () => {
    const withAmbient = createArticle()
    const ambientOn = createPreset({
      ...DEFAULT_X_AUGMENTATION_FEATURES,
      chip: false,
      ambient: true,
      detailText: false,
      detailDegree: false,
      userCard: false,
      actionIcons: true,
    })
    ambientOn.mount(withAmbient, targets)
    ambientOn.update(withAmbient, targets, summaries)
    expect(withAmbient.dataset.attentionxAuthorTone).toBe('trust')
    expect(withAmbient.querySelector('[data-attentionx-display-name]')).toBeNull()
    ambientOn.destroy()

    const withoutAmbient = createArticle()
    const ambientOff = createPreset({
      ...DEFAULT_X_AUGMENTATION_FEATURES,
      chip: true,
      ambient: false,
      detailText: false,
      detailDegree: false,
      userCard: false,
      actionIcons: true,
    })
    ambientOff.mount(withoutAmbient, targets)
    ambientOff.update(withoutAmbient, targets, summaries)
    expect(withoutAmbient.dataset.attentionxAuthorTone).toBeUndefined()
    ambientOff.destroy()
  })

  it('keeps ambient tone while author trust is still loading', () => {
    const article = createArticle()
    const preset = createPreset({
      ...DEFAULT_X_AUGMENTATION_FEATURES,
      chip: false,
      ambient: true,
      detailText: false,
      detailDegree: false,
      userCard: false,
      actionIcons: true,
    })
    preset.mount(article, targets)
    preset.update(article, targets, summaries)
    expect(article.dataset.attentionxAuthorTone).toBe('trust')

    // Cache miss / invalidate gap: loading with no author summary must not clear.
    preset.update(article, targets, { authorLoading: true, postLoading: true })
    expect(article.dataset.attentionxAuthorTone).toBe('trust')

    // Settled empty result clears.
    preset.update(article, targets, {})
    expect(article.dataset.attentionxAuthorTone).toBeUndefined()
    preset.destroy()
  })

  it('shows a spinner on chips while trust is loading', () => {
    const article = createArticle()
    const preset = createPreset({
      ...DEFAULT_X_AUGMENTATION_FEATURES,
      chip: true,
      ambient: false,
      detailText: false,
      detailDegree: false,
      userCard: false,
      actionIcons: true,
    })
    preset.mount(article, targets)
    preset.update(article, targets, { authorLoading: true, postLoading: true })

    const buttons = [
      ...article.querySelectorAll('[data-attentionx-chip]'),
    ].map((host) => host.shadowRoot?.querySelector('button'))
    expect(buttons).toHaveLength(2)
    for (const button of buttons) {
      expect(button?.classList.contains('is-loading')).toBe(true)
      expect(button?.querySelector('.spinner')).toBeTruthy()
    }
    preset.destroy()
  })

  it('shows detail scores only when detail is enabled', () => {
    const features: XAugmentationFeatures = {
      ...DEFAULT_X_AUGMENTATION_FEATURES,
      chip: true,
      ambient: false,
      detailText: true,
      detailDegree: true,
      userCard: false,
      actionIcons: true,
    }
    const article = createArticle()
    const preset = createPreset(features)
    preset.mount(article, targets)
    preset.update(article, targets, summaries)

    const scores = [
      ...article.querySelectorAll('[data-attentionx-score]'),
    ] as HTMLElement[]
    expect(scores).toHaveLength(2)
    // Post score sits immediately before the post chip (which is before bookmark).
    const bookmark = article.querySelector('[data-testid="bookmark"]')
    const postChip = bookmark?.previousElementSibling
    const postScore = postChip?.previousElementSibling
    expect(postChip?.getAttribute('data-attentionx-chip')).toBe('true')
    expect(postScore?.getAttribute('data-attentionx-score')).toBe('true')
    preset.destroy()
  })

  it('hides or collapses by trust filter but never filters promoted ads', () => {
    // DOM filtering is deactivated while JSON GraphQL filtering is under test.
    if (!UI_TIMELINE_FILTERING_ENABLED) {
      expect(UI_TIMELINE_FILTERING_ENABLED).toBe(false)
      return
    }
    const cell = document.createElement('div')
    cell.dataset.testid = 'cellInnerDiv'
    const article = createArticle()
    cell.append(article)
    document.body.append(cell)

    const preset = createPreset({
      ...DEFAULT_X_AUGMENTATION_FEATURES,
      trustFilters: {
        trusted: 'none',
        mixed: 'none',
        distrusted: 'hidePost',
        none: 'none',
      },
    })
    preset.mount(article, targets)
    preset.update(article, targets, summaries)
    expect(cell.dataset.attentionxHidden).toBe('true')

    const tracking = document.createElement('div')
    tracking.dataset.testid = 'placementTracking'
    const pixel = document.createElement('div')
    pixel.dataset.testid = 'top-impression-pixel'
    tracking.append(pixel)
    article.append(tracking)
    preset.update(article, targets, summaries)
    expect(cell.dataset.attentionxHidden).toBeUndefined()

    preset.destroy()
    expect(cell.dataset.attentionxHidden).toBeUndefined()
  })
})
