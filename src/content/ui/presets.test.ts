/** @vitest-environment happy-dom */
import i18n from 'i18next'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { i18nOptions } from '../../i18n/resources'
import type { ArticleTargets } from '../types'
import { createPreset, X_AUGMENTATION_STYLES } from './presets'
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
    <div data-testid="User-Name"><a href="/nasa">NASA</a></div>
    <div role="group"><button data-testid="reply"></button></div>
  `
  document.body.append(article)
  return article
}

beforeAll(async () => {
  await i18n.init({ ...i18nOptions, lng: 'en' })
})

beforeEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
  ensureSignalStylesheet()
})

describe('article presets', () => {
  it.each(X_AUGMENTATION_STYLES)(
    '%s mounts idempotently and reverts the article on unmount',
    (style) => {
      const article = createArticle()
      const before = article.innerHTML
      const preset = createPreset(style)

      preset.mount(article, targets)
      preset.mount(article, targets)
      preset.update(article, targets, {
        author: {
          resolution: 'trusted',
          tone: 'trust',
          trustCount: 1,
          distrustCount: 0,
          paths: 1,
          truncated: false,
        },
        post: {
          resolution: 'distrusted',
          tone: 'misleading',
          trustCount: 0,
          distrustCount: 2,
          paths: 1,
          truncated: false,
        },
      })

      expect(
        article.querySelectorAll('[data-attentionx-chip]').length,
      ).toBeLessThanOrEqual(2)

      preset.unmount(article)

      expect(article.innerHTML).toBe(before)
      expect(article.dataset.attentionxAuthorTone).toBeUndefined()
      expect(article.dataset.attentionxPostTone).toBeUndefined()
    },
  )

  it('paints tones only for presets that use ambient signals', () => {
    const summaries = {
      author: {
        resolution: 'trusted' as const,
        tone: 'trust' as const,
        trustCount: 1,
        distrustCount: 0,
        paths: 0,
        truncated: false,
      },
    }

    const ambientArticle = createArticle()
    const ambient = createPreset('ambient')
    ambient.mount(ambientArticle, targets)
    ambient.update(ambientArticle, targets, summaries)
    expect(ambientArticle.dataset.attentionxAuthorTone).toBe('trust')
    ambient.destroy()

    const chipArticle = createArticle()
    const chip = createPreset('chip')
    chip.mount(chipArticle, targets)
    chip.update(chipArticle, targets, summaries)
    expect(chipArticle.dataset.attentionxAuthorTone).toBeUndefined()
    chip.destroy()
  })
})
