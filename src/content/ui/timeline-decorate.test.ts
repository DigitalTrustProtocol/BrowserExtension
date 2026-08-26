/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKGROUND_API_VERSION } from '../../shared/contracts'
import {
  clearTimelineDecorateDataset,
  writeTimelineDecorateDataset,
} from '../../shared/timeline-decorate'
import {
  canonicalTwitterAccountSubject,
  canonicalTwitterPostSubject,
} from '../../shared/x-identity'
import { resetContentI18nForTests } from '../i18n'
import { descriptorKey, trustStore } from '../trust-store'
import type { TrustDescriptor } from '../types'
import {
  AD_MARKER_ATTR,
  applyTimelineDecorateToArticle,
  startTimelineDecorateObserver,
} from './timeline-decorate'

function resultFor(
  value: string,
  resolution: 'trusted' | 'mixed' | 'distrusted' | 'none' = 'distrusted',
) {
  const distrust = resolution === 'distrusted' || resolution === 'mixed' ? 1 : 0
  const trust = resolution === 'trusted' || resolution === 'mixed' ? 1 : 0
  return {
    subject: { type: 'i' as const, value },
    context: '',
    resolution,
    trust,
    distrust,
    trustValue: trust - distrust,
    degree: resolution === 'none' ? 0 : 1,
    connected: resolution !== 'none',
    statements: [],
    paths: [],
    truncated: false,
    computedAt: 0,
    sourceEventIds: [],
    graphVersion: 1,
  }
}

function articleWithStatus(postId: string): {
  cell: HTMLElement
  article: HTMLElement
} {
  const cell = document.createElement('div')
  cell.dataset.testid = 'cellInnerDiv'
  const article = document.createElement('article')
  const link = document.createElement('a')
  link.href = `https://x.com/spam/status/${postId}`
  article.append(link)
  cell.append(article)
  document.body.append(cell)
  return { cell, article }
}

let sendMessage: ReturnType<typeof vi.fn>

beforeEach(() => {
  document.body.replaceChildren()
  clearTimelineDecorateDataset(document)
  resetContentI18nForTests()
  trustStore.invalidateAll()
  sendMessage = vi.fn(async (request: { items: { key: string }[] }) => ({
    ok: true,
    version: BACKGROUND_API_VERSION,
    data: {
      graphVersion: 9,
      results: Object.fromEntries(
        request.items.map((item) => {
          const value = item.key.includes('post:id:')
            ? item.key.slice(
                item.key.indexOf('post:id:'),
                item.key.indexOf('|'),
              )
            : item.key.slice(
                item.key.indexOf('user:id:'),
                item.key.indexOf('|'),
              )
          return [item.key, resultFor(value, 'distrusted')]
        }),
      ),
    },
  }))
  vi.stubGlobal('chrome', { runtime: { sendMessage } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  trustStore.invalidateAll()
})

describe('timeline decorate trust cache fallback', () => {
  it('requests backend resolve when cache was invalidated before apply', async () => {
    const postId = '2080659774136291424'
    const userId = '11348282'
    const postDesc: TrustDescriptor = {
      subject: { type: 'i', value: canonicalTwitterPostSubject(postId) },
      context: 'identity',
    }
    const userDesc: TrustDescriptor = {
      subject: { type: 'i', value: canonicalTwitterAccountSubject(userId) },
      context: 'identity',
    }
    trustStore.seed([
      {
        key: descriptorKey(userDesc),
        descriptor: userDesc,
        result: resultFor(canonicalTwitterAccountSubject(userId), 'distrusted'),
      },
      {
        key: descriptorKey(postDesc),
        descriptor: postDesc,
        result: resultFor(canonicalTwitterPostSubject(postId), 'none'),
      },
    ])
    // Backend graph update between JSON seed and DOM decorate.
    trustStore.invalidateAll()
    expect(trustStore.get(descriptorKey(userDesc))).toBeUndefined()

    writeTimelineDecorateDataset(document, {
      collapse: {
        [postId]: {
          postId,
          userId,
          displayName: 'Spammer',
          handle: 'spam',
          resolution: 'distrusted',
          basis: 'author',
        },
      },
      demotedAds: [],
    })
    const { cell, article } = articleWithStatus(postId)
    const controller = startTimelineDecorateObserver()
    try {
      applyTimelineDecorateToArticle(article)
      expect(cell.dataset.attentionxCollapsed).toBe('true')
      expect(trustStore.isLoading(descriptorKey(userDesc))).toBe(true)

      await trustStore.flushNow()
      // Allow microtask refresh from store watch.
      await Promise.resolve()
      await Promise.resolve()

      expect(sendMessage).toHaveBeenCalled()
      expect(trustStore.get(descriptorKey(userDesc))?.resolution).toBe(
        'distrusted',
      )
      const trust = cell.querySelector('.ax-collapse-trust')?.textContent
      expect(trust).toMatch(/Distrusted/i)
    } finally {
      controller.stop()
    }
  })

  it('does not re-query when cache still has the seeded result', async () => {
    const postId = '2080659774136291425'
    const userId = '11348283'
    const userDesc: TrustDescriptor = {
      subject: { type: 'i', value: canonicalTwitterAccountSubject(userId) },
      context: 'identity',
    }
    const postDesc: TrustDescriptor = {
      subject: { type: 'i', value: canonicalTwitterPostSubject(postId) },
      context: 'identity',
    }
    trustStore.seed([
      {
        key: descriptorKey(userDesc),
        descriptor: userDesc,
        result: resultFor(canonicalTwitterAccountSubject(userId), 'distrusted'),
      },
      {
        key: descriptorKey(postDesc),
        descriptor: postDesc,
        result: resultFor(canonicalTwitterPostSubject(postId), 'none'),
      },
    ])

    writeTimelineDecorateDataset(document, {
      collapse: {
        [postId]: {
          postId,
          userId,
          displayName: 'Spammer',
          handle: 'spam',
          resolution: 'distrusted',
          basis: 'author',
        },
      },
      demotedAds: [],
    })
    const { article } = articleWithStatus(postId)
    const controller = startTimelineDecorateObserver()
    try {
      applyTimelineDecorateToArticle(article)
      await trustStore.flushNow()
      expect(sendMessage).not.toHaveBeenCalled()
    } finally {
      controller.stop()
    }
  })

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
      collapse: {},
      demotedAds: [postId],
    })

    applyTimelineDecorateToArticle(article)

    const marker = article.querySelector(`[${AD_MARKER_ATTR}]`)
    expect(marker?.textContent).toBe('Ad')
    expect(marker?.nextElementSibling).toBe(caret)
    expect(caret.previousElementSibling).toBe(marker)
  })
})
