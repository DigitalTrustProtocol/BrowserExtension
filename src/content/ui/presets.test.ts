/** @vitest-environment happy-dom */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetContentI18nForTests } from '../i18n'
import {
  resetContentOperatorKeyForTests,
  setHasWritableOperatorKeyForTests,
} from '../operator-key'
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
    <div data-testid="UserAvatar-Container">
      <a href="/nasa"><img alt="NASA" src="about:blank" width="40" height="40" /></a>
    </div>
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
    averageScore: 20,
    claimCount: 2,
    labels: ['spam'],
    tone: 'misleading' as const,
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
  resetContentOperatorKeyForTests()
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
    expect(article.querySelectorAll('[data-attentionx-score]').length).toBe(1)
    expect(article.dataset.attentionxPostTone).toBe('misleading')
    const overlay = article.querySelector('[data-attentionx-overlay]')
    expect(overlay).toBeTruthy()
    expect(article.lastElementChild).toBe(overlay)
    expect(overlay?.querySelector('[data-attentionx-gutter]')).toBeTruthy()
    const postStar = article.querySelector('[data-attentionx-star]')
    expect(
      postStar?.shadowRoot?.querySelector('button.star')?.classList.contains(
        'tone-misleading',
      ),
    ).toBe(true)

    preset.unmount(article)

    expect(article.innerHTML).toBe(before)
    expect(article.dataset.attentionxAuthorTone).toBeUndefined()
    expect(article.dataset.attentionxPostTone).toBeUndefined()
  })

  it('mounts detail and chip in the last User-Name meta div', () => {
    const article = createArticle()
    const name = article.querySelector('[data-testid="User-Name"]')
    const timeLink = document.createElement('a')
    timeLink.href = '/nasa/status/1'
    timeLink.innerHTML = '<time datetime="2026-07-31">2h</time>'
    name?.append(timeLink)

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

    const meta = name?.querySelector<HTMLElement>('[data-attentionx-author-meta]')
    const authorChip = meta?.querySelector<HTMLElement>(
      '[data-attentionx-chip="author"]',
    )
    const authorScore = meta?.querySelector<HTMLElement>(
      '[data-attentionx-score]',
    )
    const avatar = article.querySelector('[data-testid="UserAvatar-Container"]')
    expect(meta).toBeTruthy()
    expect(name?.lastElementChild).toBe(meta)
    expect(authorScore).toBeTruthy()
    expect(authorChip).toBeTruthy()
    expect(authorChip?.style.position).toBe('relative')
    expect(authorChip?.style.maxHeight).toBe('16px')
    expect(authorScore?.style.maxHeight).toBe('16px')
    expect(authorScore?.style.fontSize).toBe('14px')
    expect(avatar?.contains(authorChip!)).toBe(false)
    expect(name?.contains(authorChip!)).toBe(true)
    expect(name?.contains(authorScore!)).toBe(true)
    expect(authorScore?.nextElementSibling).toBe(authorChip)
    expect(meta?.firstElementChild).toBe(authorScore)
    expect(meta?.lastElementChild).toBe(authorChip)
    expect(timeLink.nextElementSibling).toBe(meta ?? null)
    const scoreButton = authorScore?.shadowRoot?.querySelector('button')
    expect(scoreButton?.textContent).toMatch(/Trusted|2°/)
    const scoreStyle =
      authorScore?.shadowRoot?.querySelector('style')?.textContent ?? ''
    expect(scoreStyle).toContain('font-size: 14px')
    expect(scoreStyle).toContain('line-height: 16px')
    const chipStyle =
      authorChip?.shadowRoot?.querySelector('style')?.textContent ?? ''
    expect(chipStyle).toContain('width: 16px')
    expect(chipStyle).toContain('height: 16px')
    expect(authorChip?.shadowRoot?.querySelector('svg[data-tone]')).toBeTruthy()
    preset.destroy()
  })

  it('overlays the post star on the article, not in the action-bar flex row', () => {
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

    const bookmark = article.querySelector('[data-testid="bookmark"]')
    const group = bookmark?.parentElement
    const overlay = article.querySelector('[data-attentionx-overlay]')
    const postChip = article.querySelector<HTMLElement>(
      '[data-attentionx-chip="post"]',
    )
    expect(postChip).toBeTruthy()
    expect(overlay?.contains(postChip)).toBe(true)
    expect(group?.contains(postChip)).toBe(false)
    expect(group?.style.position).not.toBe('relative')
    expect(postChip?.style.position).toBe('absolute')
    expect(postChip?.nextElementSibling).not.toBe(bookmark)
    expect(bookmark?.previousElementSibling).not.toBe(postChip)
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
    expect(withAmbient.dataset.attentionxPostTone).toBe('misleading')
    expect(withAmbient.querySelector('[data-attentionx-display-name]')).toBeNull()
    expect(withAmbient.querySelector('[data-attentionx-gutter]')).toBeTruthy()
    expect(withAmbient.querySelector('[data-attentionx-overlay]')).toBeTruthy()
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
    expect(withoutAmbient.dataset.attentionxPostTone).toBeUndefined()
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
    expect(article.dataset.attentionxPostTone).toBe('misleading')

    // Cache miss / invalidate gap: loading with no author summary must not clear.
    preset.update(article, targets, { authorLoading: true, postLoading: true })
    expect(article.dataset.attentionxAuthorTone).toBe('trust')
    expect(article.dataset.attentionxPostTone).toBe('misleading')

    // Settled empty result clears.
    preset.update(article, targets, {})
    expect(article.dataset.attentionxAuthorTone).toBeUndefined()
    expect(article.dataset.attentionxPostTone).toBeUndefined()
    preset.destroy()
  })

  it('shows a spinner on chips while trust is loading', () => {
    vi.useFakeTimers()
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
    ].map(
      (host) =>
        host.shadowRoot?.querySelector('button.star') ??
        host.shadowRoot?.querySelector('button'),
    )
    expect(buttons).toHaveLength(2)
    // Spinner is delayed so fast trust lookups do not flash.
    for (const button of buttons) {
      expect(button?.classList.contains('is-loading')).toBe(false)
      expect(button?.querySelector('.spinner')).toBeNull()
    }
    vi.advanceTimersByTime(200)
    for (const button of buttons) {
      expect(button?.classList.contains('is-loading')).toBe(true)
      expect(button?.querySelector('.spinner')).toBeTruthy()
    }
    preset.destroy()
    vi.useRealTimers()
  })

  it('does not mount inline detail scores when detail options are off', () => {
    const features: XAugmentationFeatures = {
      ...DEFAULT_X_AUGMENTATION_FEATURES,
      chip: true,
      ambient: false,
      detailText: false,
      detailDegree: false,
      userCard: false,
      actionIcons: true,
    }
    const article = createArticle()
    const preset = createPreset(features)
    preset.mount(article, targets)
    preset.update(article, targets, summaries)

    expect(article.querySelectorAll('[data-attentionx-score]').length).toBe(0)
    preset.destroy()
  })

  it('re-mount is a no-op when mounts are intact', () => {
    const article = createArticle()
    const preset = createPreset({ ...DEFAULT_X_AUGMENTATION_FEATURES })
    preset.mount(article, targets)
    preset.update(article, targets, summaries)
    expect(article.dataset.attentionxAuthorTone).toBe('trust')

    const querySpy = vi.spyOn(article, 'querySelector')
    preset.mount(article, targets)

    // No name-row queries, no paint: tones survive the visibility re-entry.
    expect(querySpy).not.toHaveBeenCalled()
    expect(article.dataset.attentionxAuthorTone).toBe('trust')
    expect(article.dataset.attentionxPostTone).toBe('misleading')
    querySpy.mockRestore()
    preset.destroy()
  })

  it('re-mount repairs a meta mount that X churned out of the DOM', () => {
    const article = createArticle()
    const preset = createPreset({ ...DEFAULT_X_AUGMENTATION_FEATURES })
    preset.mount(article, targets)

    const name = article.querySelector('[data-testid="User-Name"]')
    const meta = article.querySelector<HTMLElement>(
      '[data-attentionx-author-meta]',
    )
    expect(meta).toBeTruthy()
    meta!.remove()

    preset.mount(article, targets)

    const repaired = name?.querySelector<HTMLElement>(
      '[data-attentionx-author-meta]',
    )
    expect(repaired).toBeTruthy()
    expect(repaired?.isConnected).toBe(true)
    expect(repaired?.querySelector('[data-attentionx-score]')).toBeTruthy()
    expect(repaired?.querySelector('[data-attentionx-chip]')).toBeTruthy()
    preset.destroy()
  })

  it('paints a patterned gutter bar and opens the Side Panel on click', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      data: { opened: true, subject: { type: 'i', value: 'post:id:1' } },
    })
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const article = createArticle()
    const preset = createPreset({
      ...DEFAULT_X_AUGMENTATION_FEATURES,
      chip: true,
      ambient: true,
      detailText: false,
      detailDegree: false,
      userCard: false,
      actionIcons: true,
    })
    preset.mount(article, targets)
    preset.update(article, targets, summaries)

    const gutter = article.querySelector<HTMLElement>(
      '[data-attentionx-gutter]',
    )
    expect(gutter).toBeTruthy()
    expect(gutter?.shadowRoot?.querySelector('.token')).toBeNull()
    expect(
      gutter?.shadowRoot?.querySelector('button')?.classList.contains(
        'tone-misleading',
      ),
    ).toBe(true)

    gutter?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'OPEN_SIDE_PANEL' }),
      )
    })
    expect(article.dataset.attentionxPostSelected).toBe('true')
    expect(
      gutter?.shadowRoot?.querySelector('button')?.getAttribute('aria-pressed'),
    ).toBe('true')
    preset.destroy()
    expect(article.dataset.attentionxPostSelected).toBeUndefined()
    vi.unstubAllGlobals()
  })

  it('opens the Side Panel from author chip and post star when there is no key', async () => {
    resetContentOperatorKeyForTests()
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      data: { opened: true, subject: { type: 'i', value: 'user:id:11348282' } },
    })
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
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
    preset.update(article, targets, summaries)

    article
      .querySelector('[data-attentionx-chip="author"]')
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'OPEN_SIDE_PANEL',
          subject: { type: 'i', value: 'user:id:11348282' },
        }),
      )
    })
    sendMessage.mockClear()

    article
      .querySelector('[data-attentionx-star]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'OPEN_SIDE_PANEL',
          subject: { type: 'i', value: 'post:id:2080659774136291424' },
        }),
      )
    })
    expect(document.querySelector('[data-attentionx-trust-dialog]')).toBeNull()
    preset.destroy()
    vi.unstubAllGlobals()
  })

  it('opens the trust dialog from the author chip when a writable key exists', () => {
    setHasWritableOperatorKeyForTests(true)
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: {} })
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
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
    preset.update(article, targets, summaries)

    article
      .querySelector('[data-attentionx-chip="author"]')
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))

    expect(document.querySelector('[data-attentionx-trust-dialog]')).toBeTruthy()
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'OPEN_SIDE_PANEL' }),
    )
    preset.destroy()
    document.querySelector('[data-attentionx-trust-dialog]')?.remove()
    vi.unstubAllGlobals()
  })

  it('opens the post panel from the rating number and the popover from the star', async () => {
    setHasWritableOperatorKeyForTests(true)
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      data: { opened: true, subject: { type: 'i', value: 'post:id:1' } },
    })
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
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
    preset.update(article, targets, summaries)

    const root = article.querySelector('[data-attentionx-star]')?.shadowRoot
    root
      ?.querySelector('button.score')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'OPEN_SIDE_PANEL',
          subject: { type: 'i', value: 'post:id:2080659774136291424' },
        }),
      )
    })
    expect(document.querySelector('[data-attentionx-popover]')).toBeNull()

    sendMessage.mockClear()
    root
      ?.querySelector('button.star')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    expect(document.querySelector('[data-attentionx-popover]')).toBeTruthy()
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'OPEN_SIDE_PANEL' }),
    )
    preset.destroy()
    document.querySelector('[data-attentionx-popover]')?.remove()
    vi.unstubAllGlobals()
  })
})
