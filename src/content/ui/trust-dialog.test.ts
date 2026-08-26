/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKGROUND_API_VERSION } from '../../shared/contracts'
import type { TrustQueryResult } from '../../graph'
import { resetContentI18nForTests } from '../i18n'
import { descriptorKey, trustStore } from '../trust-store'
import { trustDescriptor } from '../trust-helpers'
import type { Target } from '../types'
import { openTrustDialog } from './trust-dialog'

const profileTarget: Target = {
  type: 'profile',
  id: '11348282',
  url: 'https://x.com/i/user/11348282',
  handle: 'nasa',
  twitterId: '11348282',
}

const postTarget: Target = {
  type: 'post',
  id: '2080659774136291424',
  url: 'https://x.com/i/web/status/2080659774136291424',
  handle: 'nasa',
  twitterId: '11348282',
}

function descriptorFor(target: Target) {
  const next = trustDescriptor(target)
  if (!next) throw new Error('expected descriptor')
  return next
}

function emptyResult(target: Target): TrustQueryResult {
  const { subject } = descriptorFor(target)
  return {
    subject,
    context: '',
    resolution: 'none',
    trust: 0,
    distrust: 0,
    trustValue: 0,
    degree: 0,
    connected: false,
    statements: [],
    paths: [],
    truncated: false,
    computedAt: 0,
    sourceEventIds: [],
    graphVersion: 1,
  }
}

function ownTrustResult(target: Target): TrustQueryResult {
  const { subject } = descriptorFor(target)
  const direct = {
    eventId: 'own',
    author: 'root',
    subject,
    context: '',
    requestedContext: '',
    contextMatch: 'exact' as const,
    value: 1 as const,
    createdAt: 1,
    distance: 0,
  }
  return {
    ...emptyResult(target),
    resolution: 'trusted',
    trust: 1,
    trustValue: 1,
    degree: 1,
    connected: true,
    direct,
    statements: [direct],
    sourceEventIds: ['own'],
  }
}

function seed(target: Target, result: TrustQueryResult): void {
  const next = descriptorFor(target)
  trustStore.seed([
    {
      key: descriptorKey(next),
      descriptor: next,
      result,
    },
  ])
}

function dialogHost(): HTMLElement | null {
  return document.querySelector('[data-attentionx-trust-dialog]')
}

function panel(): ShadowRoot {
  const host = dialogHost()
  const root = host?.shadowRoot
  if (!root) throw new Error('expected trust dialog')
  return root
}

function publishOk() {
  return {
    ok: true,
    version: BACKGROUND_API_VERSION,
    data: {
      eventId: 'evt',
      deliveredTo: 0,
      attemptedRelays: 0,
      localOnly: true,
      graphVersion: 2,
    },
  }
}

function queryOk(target: Target, result: TrustQueryResult) {
  return {
    ok: true,
    version: BACKGROUND_API_VERSION,
    data: {
      graphVersion: 2,
      results: { [descriptorKey(descriptorFor(target))]: result },
    },
  }
}

let sendMessage: ReturnType<typeof vi.fn>

beforeEach(() => {
  resetContentI18nForTests()
  document.body.replaceChildren()
  sendMessage = vi.fn(async (request: { type: string }) => {
    if (
      request.type === 'PUBLISH_TRUST_STATEMENT' ||
      request.type === 'CANCEL_TRUST_STATEMENT'
    ) {
      return publishOk()
    }
    if (request.type === 'QUERY_TRUST_BATCH') {
      return queryOk(profileTarget, emptyResult(profileTarget))
    }
    return { ok: false, version: BACKGROUND_API_VERSION, error: 'unexpected' }
  })
  vi.stubGlobal('chrome', {
    runtime: { sendMessage },
  })
})

afterEach(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  trustStore.invalidateAll()
  trustStore.prune()
  vi.unstubAllGlobals()
})

describe('openTrustDialog actions', () => {
  it('closes as soon as Trust is clicked and keeps the chip loading until publish finishes', async () => {
    seed(profileTarget, emptyResult(profileTarget))
    const key = descriptorKey(descriptorFor(profileTarget))
    let resolvePublish: (value: unknown) => void = () => {}
    sendMessage.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'PUBLISH_TRUST_STATEMENT') {
        return new Promise<unknown>((resolve) => {
          resolvePublish = resolve
        })
      }
      if (request.type === 'QUERY_TRUST_BATCH') {
        return queryOk(profileTarget, ownTrustResult(profileTarget))
      }
      return { ok: false, version: BACKGROUND_API_VERSION, error: 'unexpected' }
    })

    openTrustDialog({ target: profileTarget, variant: 'author', title: 'NASA' })
    expect(dialogHost()).not.toBeNull()

    panel().querySelector<HTMLButtonElement>('button[data-verdict="trust"]')?.click()
    expect(dialogHost()).toBeNull()
    expect(trustStore.isLoading(key)).toBe(true)

    resolvePublish(publishOk())
    await vi.waitFor(() => {
      expect(trustStore.isLoading(key)).toBe(false)
    })
  })

  it('closes Neutral and Distrust without waiting for publish', async () => {
    seed(profileTarget, emptyResult(profileTarget))
    const key = descriptorKey(descriptorFor(profileTarget))
    openTrustDialog({ target: profileTarget, variant: 'author' })
    panel().querySelector<HTMLButtonElement>('button[data-verdict="neutral"]')?.click()
    expect(dialogHost()).toBeNull()
    await vi.waitFor(() => {
      expect(trustStore.isLoading(key)).toBe(false)
    })

    openTrustDialog({ target: profileTarget, variant: 'author' })
    panel()
      .querySelector<HTMLButtonElement>('button[data-verdict="misleading"]')
      ?.click()
    expect(dialogHost()).toBeNull()
    await vi.waitFor(() => {
      expect(trustStore.isLoading(key)).toBe(false)
    })
  })

  it('orders Trust, Neutral, Distrust across the full width with retract below', () => {
    seed(profileTarget, ownTrustResult(profileTarget))
    openTrustDialog({ target: profileTarget, variant: 'author' })
    const row = panel().querySelectorAll<HTMLButtonElement>(
      '.ax-actions-row button',
    )
    expect([...row].map((btn) => btn.dataset.verdict)).toEqual([
      'trust',
      'neutral',
      'misleading',
    ])
    const actions = panel().querySelector('.ax-actions')
    const retract = panel().querySelector<HTMLButtonElement>(
      'button[data-action="delete"]',
    )
    expect(retract?.parentElement).toBe(actions)
    expect(retract?.previousElementSibling?.classList.contains('ax-actions-row')).toBe(
      true,
    )
  })

  it('closes Delete when the operator already has a statement', async () => {
    seed(profileTarget, ownTrustResult(profileTarget))
    const key = descriptorKey(descriptorFor(profileTarget))
    openTrustDialog({ target: profileTarget, variant: 'author' })
    const del = panel().querySelector<HTMLButtonElement>('button[data-action="delete"]')
    expect(del?.hidden).toBe(false)
    expect(del?.getAttribute('aria-label')).toBe('Retract my statement')
    expect(del?.textContent).toContain('Retract my statement')
    expect(del?.querySelector('svg')).not.toBeNull()
    del?.click()
    expect(dialogHost()).toBeNull()
    await vi.waitFor(() => {
      expect(trustStore.isLoading(key)).toBe(false)
    })
  })

  it('closes the post dialog on Trust', async () => {
    seed(postTarget, emptyResult(postTarget))
    sendMessage.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'PUBLISH_TRUST_STATEMENT') return publishOk()
      if (request.type === 'QUERY_TRUST_BATCH') {
        return queryOk(postTarget, ownTrustResult(postTarget))
      }
      return { ok: false, version: BACKGROUND_API_VERSION, error: 'unexpected' }
    })
    openTrustDialog({ target: postTarget, variant: 'post', title: 'A post' })
    panel().querySelector<HTMLButtonElement>('button[data-verdict="trust"]')?.click()
    expect(dialogHost()).toBeNull()
    await vi.waitFor(() => {
      expect(trustStore.isLoading(descriptorKey(descriptorFor(postTarget)))).toBe(
        false,
      )
    })
  })

  it('reissues Trust when that polarity is already selected so the note can change', async () => {
    seed(profileTarget, ownTrustResult(profileTarget))
    const key = descriptorKey(descriptorFor(profileTarget))
    openTrustDialog({ target: profileTarget, variant: 'author' })
    const trust = panel().querySelector<HTMLButtonElement>(
      'button[data-verdict="trust"]',
    )
    expect(trust?.disabled).toBe(false)
    expect(trust?.getAttribute('aria-pressed')).toBe('true')
    trust?.click()
    expect(dialogHost()).toBeNull()
    await vi.waitFor(() => {
      expect(trustStore.isLoading(key)).toBe(false)
    })
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PUBLISH_TRUST_STATEMENT', value: '1' }),
    )
  })

  it('reopens with the error if publish fails', async () => {
    seed(profileTarget, emptyResult(profileTarget))
    sendMessage.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'PUBLISH_TRUST_STATEMENT') {
        return {
          ok: false,
          version: BACKGROUND_API_VERSION,
          error: 'relay timeout',
        }
      }
      return queryOk(profileTarget, emptyResult(profileTarget))
    })
    openTrustDialog({ target: profileTarget, variant: 'author' })
    panel().querySelector<HTMLButtonElement>('button[data-verdict="trust"]')?.click()

    await vi.waitFor(() => {
      expect(dialogHost()).not.toBeNull()
      expect(panel().querySelector('.message')?.textContent).toBe('relay timeout')
    })
  })

  it('opens the Side Panel instead of the trust path', async () => {
    seed(profileTarget, ownTrustResult(profileTarget))
    sendMessage.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'OPEN_SIDE_PANEL') {
        return {
          ok: true,
          version: BACKGROUND_API_VERSION,
          data: { opened: true, subject: descriptorFor(profileTarget).subject },
        }
      }
      return queryOk(profileTarget, ownTrustResult(profileTarget))
    })
    openTrustDialog({ target: profileTarget, variant: 'author', title: 'NASA' })
    expect(panel().querySelector('[data-action="open-path"]')).toBeNull()
    const panelBtn = panel().querySelector<HTMLButtonElement>(
      '.header-actions [data-action="open-panel"]',
    )
    expect(panelBtn?.hidden).toBe(false)
    expect(panelBtn?.getAttribute('aria-label')).toBe('Open in Notes')
    panelBtn?.click()
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'OPEN_SIDE_PANEL' }),
      )
    })
  })
})
