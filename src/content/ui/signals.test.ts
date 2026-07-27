/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearAllSignals,
  ensureSignalStylesheet,
  setAuthorTone,
  setPostTone,
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
    document.body.append(article)
    ensureSignalStylesheet()
    setAuthorTone(article, 'trust')
    setPostTone(article, 'question')

    clearAllSignals()

    expect(document.getElementById(SIGNAL_STYLE_ID)).toBeNull()
    expect(article.getAttributeNames()).toEqual([])
  })
})
