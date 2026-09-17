/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKGROUND_API_VERSION } from '../../shared/contracts'
import {
  clearTimelineDecorateDataset,
  writeTimelineDecorateDataset,
} from '../../shared/timeline-decorate'
import { resetContentI18nForTests } from '../i18n'
import { trustStore } from '../trust-store'
import {
  AD_MARKER_ATTR,
  applyTimelineDecorateToArticle,
  startTimelineDecorateObserver,
} from './timeline-decorate'

beforeEach(() => {
  document.body.replaceChildren()
  clearTimelineDecorateDataset(document)
  resetContentI18nForTests()
  trustStore.invalidateAll()
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn(async () => ({
        ok: true,
        version: BACKGROUND_API_VERSION,
        data: { graphVersion: 1, results: {} },
      })),
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  trustStore.invalidateAll()
})

describe('timeline decorate Ad markers', () => {
  it('places Ad marker immediately before the More (caret) menu', () => {
    const postId = '2080659774136291426'
    const cell = document.createElement('div')
    cell.dataset.testid = 'cellInnerDiv'
    const article = document.createElement('article')
    const header = document.createElement('div')
    const name = document.createElement('div')
    name.dataset.testid = 'User-Name'
    const link = document.createElement('a')
    link.href = `https://x.com/brand/status/${postId}`
    name.append(link)
    const caret = document.createElement('button')
    caret.dataset.testid = 'caret'
    caret.setAttribute('aria-label', 'More')
    header.append(name, caret)
    article.append(header)
    cell.append(article)
    document.body.append(cell)

    writeTimelineDecorateDataset(document, {
      demotedAds: [postId],
    })

    applyTimelineDecorateToArticle(article)

    const marker = article.querySelector(`[${AD_MARKER_ATTR}]`)
    expect(marker?.textContent).toBe('Ad')
    expect(marker?.nextElementSibling).toBe(caret)
    expect(caret.previousElementSibling).toBe(marker)
  })

  it('does not decorate when there are no demoted ads', () => {
    const postId = '2080659774136291427'
    const cell = document.createElement('div')
    cell.dataset.testid = 'cellInnerDiv'
    const article = document.createElement('article')
    const link = document.createElement('a')
    link.href = `https://x.com/brand/status/${postId}`
    article.append(link)
    cell.append(article)
    document.body.append(cell)

    const controller = startTimelineDecorateObserver()
    try {
      applyTimelineDecorateToArticle(article)
      expect(article.querySelector(`[${AD_MARKER_ATTR}]`)).toBeNull()
    } finally {
      controller.stop()
    }
  })
})
