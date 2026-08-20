/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKGROUND_API_VERSION } from '../../shared/contracts'
import type { RatingQueryResult } from '../../graph'
import { resetContentI18nForTests } from '../i18n'
import { ratingStore } from '../rating-store'
import { descriptorKey } from '../trust-store'
import { trustDescriptor } from '../trust-helpers'
import type { Target } from '../types'
import { destroyPopover } from './popover'
import { openRatingPopover } from './rating-popover'
import { RATING_QUICK_CLAIMS } from './rating-claims'

const target: Target = {
  type: 'post',
  id: '2080659774136291424',
  url: 'https://x.com/i/web/status/2080659774136291424',
  handle: 'nasa',
  twitterId: '11348282',
}

function descriptor() {
  const next = trustDescriptor(target)
  if (!next) throw new Error('expected post descriptor')
  return next
}

function emptyResult(): RatingQueryResult {
  const { subject } = descriptor()
  return {
    subject,
    context: '',
    claims: [],
    averageScore: null,
    claimCount: 0,
    degree: 0,
    sourceEventIds: [],
    computedAt: 0,
    graphVersion: 1,
  }
}

function ownResult(): RatingQueryResult {
  const { subject } = descriptor()
  const own = {
    eventId: 'own-rating',
    author: 'root',
    subject,
    context: '',
    score: 80,
    labels: ['genuine'],
    content: '',
    createdAt: 1,
    distance: 0,
  }
  return {
    subject,
    context: '',
    claims: [own],
    averageScore: 80,
    claimCount: 1,
    degree: 1,
    own,
    sourceEventIds: ['own-rating'],
    computedAt: 0,
    graphVersion: 1,
  }
}

function seed(result: RatingQueryResult): void {
  const next = descriptor()
  ratingStore.seed([
    {
      key: descriptorKey(next),
      descriptor: next,
      result,
    },
  ])
}

function panel(): HTMLElement {
  const host = document.querySelector('[data-attentionx-popover]')
  const el = host?.shadowRoot?.querySelector('.panel')
  if (!(el instanceof HTMLElement)) throw new Error('expected popover panel')
  return el
}

function shell(): HTMLElement {
  const host = document.querySelector('[data-attentionx-popover]')
  const el = host?.shadowRoot?.querySelector('.shell')
  if (!(el instanceof HTMLElement)) throw new Error('expected popover shell')
  return el
}

let sendMessage: ReturnType<typeof vi.fn>

beforeEach(() => {
  resetContentI18nForTests()
  document.body.replaceChildren()
  sendMessage = vi.fn(async () => ({
    ok: true,
    version: BACKGROUND_API_VERSION,
    data: {
      eventId: 'evt',
      deliveredTo: 0,
      attemptedRelays: 0,
      localOnly: true,
      graphVersion: 2,
      results: {},
    },
  }))
  vi.stubGlobal('chrome', {
    runtime: { sendMessage },
  })
})

afterEach(() => {
  destroyPopover()
  ratingStore.invalidateAll()
  ratingStore.prune()
  vi.unstubAllGlobals()
})

describe('openRatingPopover claims', () => {
  it('shows balanced good and bad claims with star numbers', () => {
    seed(emptyResult())
    const anchor = document.createElement('span')
    document.body.append(anchor)
    openRatingPopover({ target, anchor })

    const good = [...panel().querySelectorAll('.claim-group.good .claim-btn')]
    const bad = [...panel().querySelectorAll('.claim-group.bad .claim-btn')]
    expect(good).toHaveLength(3)
    expect(bad).toHaveLength(3)
    expect(panel().querySelector('.claim-cancel')).toBeNull()

    const ids = [...panel().querySelectorAll<HTMLButtonElement>('[data-claim]')].map(
      (btn) => btn.dataset.claim,
    )
    expect(ids).toEqual(RATING_QUICK_CLAIMS.map((claim) => claim.id))

    const stars = [...panel().querySelectorAll('.claim-stars')].map(
      (el) => el.textContent,
    )
    expect(stars).toEqual(['5★', '4★', '3★', '2★', '1★', '0★'])

    const tones = [...panel().querySelectorAll<HTMLButtonElement>('[data-claim]')].map(
      (btn) => [...btn.classList].find((name) => name.startsWith('tone-')),
    )
    expect(tones).toEqual([
      'tone-trust',
      'tone-trust',
      'tone-question',
      'tone-question',
      'tone-misleading',
      'tone-misleading',
    ])
  })

  it('shows cancel only when the operator already rated this post', () => {
    seed(ownResult())
    const anchor = document.createElement('span')
    document.body.append(anchor)
    openRatingPopover({ target, anchor })
    expect(panel().querySelector('.claim-cancel')?.textContent).toBe(
      'Clear rating',
    )
  })

  it('opens the Side Panel for the post from the Notes button', async () => {
    seed(emptyResult())
    const anchor = document.createElement('span')
    document.body.append(anchor)
    openRatingPopover({ target, anchor })
    const openPanel = panel().querySelector<HTMLButtonElement>('.open-panel')
    expect(openPanel?.textContent).toContain('Open in Notes')
    openPanel?.click()
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'OPEN_SIDE_PANEL' }),
      )
    })
  })

  it('closes as soon as a claim is chosen and confirms after publish', async () => {
    seed(emptyResult())
    const onCommitted = vi.fn()
    const anchor = document.createElement('span')
    document.body.append(anchor)
    openRatingPopover({ target, anchor, onCommitted })

    panel().querySelector<HTMLButtonElement>('[data-claim="insightful"]')?.click()
    expect(shell().style.display).toBe('none')

    await vi.waitFor(() => {
      expect(onCommitted).toHaveBeenCalledTimes(1)
    })
  })

  it('keeps the post star loading until publish finishes', async () => {
    seed(emptyResult())
    const key = descriptorKey(descriptor())
    let resolvePublish: (value: unknown) => void = () => {}
    sendMessage.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'PUBLISH_RATING_STATEMENT') {
        return new Promise<unknown>((resolve) => {
          resolvePublish = resolve
        })
      }
      return {
        ok: true,
        version: BACKGROUND_API_VERSION,
        data: {
          graphVersion: 2,
          results: { [key]: emptyResult() },
        },
      }
    })
    const anchor = document.createElement('span')
    document.body.append(anchor)
    openRatingPopover({ target, anchor })

    panel().querySelector<HTMLButtonElement>('[data-claim="insightful"]')?.click()
    expect(shell().style.display).toBe('none')
    expect(ratingStore.isLoading(key)).toBe(true)

    resolvePublish({
      ok: true,
      version: BACKGROUND_API_VERSION,
      data: {
        eventId: 'evt',
        deliveredTo: 0,
        attemptedRelays: 0,
        localOnly: true,
        graphVersion: 2,
      },
    })
    await vi.waitFor(() => {
      expect(ratingStore.isLoading(key)).toBe(false)
    })
  })
})
