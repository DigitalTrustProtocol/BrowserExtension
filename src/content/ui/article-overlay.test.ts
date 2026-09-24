/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetContentI18nForTests } from '../i18n'
import {
  OVERLAY_ATTR,
  OVERLAY_STYLE_ID,
  clearArticlePostSelection,
  createGutterControl,
  ensureArticleOverlay,
  selectArticlePost,
} from './article-overlay'

describe('article overlay', () => {
  beforeEach(() => {
    document.head.replaceChildren()
    document.body.replaceChildren()
    resetContentI18nForTests()
  })

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('appends an out-of-flow last child without inline size', () => {
    const article = document.createElement('article')
    article.style.width = '400px'
    article.style.height = '200px'
    document.body.append(article)
    const overlay = ensureArticleOverlay(article)
    expect(article.lastElementChild).toBe(overlay)
    expect(overlay.getAttribute(OVERLAY_ATTR)).toBe('true')
    expect(overlay.style.position).toBe('absolute')
    expect(overlay.style.pointerEvents).toBe('none')
    expect(document.getElementById(OVERLAY_STYLE_ID)?.textContent).toContain(
      'position: relative',
    )
    expect(ensureArticleOverlay(article)).toBe(overlay)
  })

  it('paints a patterned gutter bar and reports selection', () => {
    const onClick = vi.fn()
    const gutter = createGutterControl({ onClick })
    document.body.append(gutter.host)
    const button = gutter.host.shadowRoot?.querySelector('button')

    gutter.setTone('trust')
    expect(button?.classList.contains('tone-trust')).toBe(true)
    expect(gutter.host.shadowRoot?.querySelector('.token')).toBeNull()

    gutter.setTone('question')
    expect(button?.classList.contains('tone-question')).toBe(true)

    gutter.setTone('neutral')
    expect(button?.classList.contains('tone-neutral')).toBe(true)

    gutter.host.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onClick).toHaveBeenCalledOnce()

    gutter.setSelected(true)
    expect(button?.getAttribute('aria-pressed')).toBe('true')
    gutter.destroy()
  })

  it('keeps a single selected article', () => {
    const first = document.createElement('article')
    const second = document.createElement('article')
    document.body.append(first, second)
    selectArticlePost(first)
    expect(first.dataset.attentionxPostSelected).toBe('true')
    selectArticlePost(second)
    expect(first.dataset.attentionxPostSelected).toBeUndefined()
    expect(second.dataset.attentionxPostSelected).toBe('true')
    clearArticlePostSelection(second)
    expect(second.dataset.attentionxPostSelected).toBeUndefined()
  })

})
