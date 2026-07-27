/** @vitest-environment happy-dom */
import i18n from 'i18next'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { i18nOptions } from '../../i18n/resources'
import {
  DEFAULT_X_AUGMENTATION_FEATURES,
  type XAugmentationFeatures,
} from '../../shared/x-augmentation'
import type { ArticleTargets } from '../types'
import { createPreset } from './presets'
import { ensureSignalStylesheet } from './signals'

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
      <a href="/nasa">NASA</a>
      <a href="/nasa">@nasa</a>
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

beforeAll(async () => {
  await i18n.init({ ...i18nOptions, lng: 'en' })
})

beforeEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
  ensureSignalStylesheet()
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

  it('places the author chip before Grok and the post chip before bookmark', () => {
    const article = createArticle()
    const preset = createPreset({
      chip: true,
      ambient: false,
      detail: false,
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
      chip: false,
      ambient: true,
      detail: false,
      userCard: false,
      actionIcons: true,
    })
    ambientOn.mount(withAmbient, targets)
    ambientOn.update(withAmbient, targets, summaries)
    expect(withAmbient.dataset.attentionxAuthorTone).toBe('trust')
    expect(
      withAmbient.querySelector('[data-attentionx-display-name]')?.textContent,
    ).toBe('NASA')
    ambientOn.destroy()

    const withoutAmbient = createArticle()
    const ambientOff = createPreset({
      chip: true,
      ambient: false,
      detail: false,
      userCard: false,
      actionIcons: true,
    })
    ambientOff.mount(withoutAmbient, targets)
    ambientOff.update(withoutAmbient, targets, summaries)
    expect(withoutAmbient.dataset.attentionxAuthorTone).toBeUndefined()
    ambientOff.destroy()
  })

  it('shows detail scores only when detail is enabled', () => {
    const features: XAugmentationFeatures = {
      chip: true,
      ambient: false,
      detail: true,
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
})
