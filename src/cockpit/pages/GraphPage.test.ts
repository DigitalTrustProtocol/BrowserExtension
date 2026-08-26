/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { TRUST_GRAPH_UPDATED_MESSAGE } from '../../shared/demo-wot'

const { neighborhoodRefreshTokens } = vi.hoisted(() => ({
  neighborhoodRefreshTokens: [] as number[],
}))

vi.mock('../../lib/i18n', () => ({
  t: (key: string) => key,
}))

vi.mock('../graph/GraphNeighborhoodView', async () => {
  const { createElement: el, forwardRef } = await import('react')
  return {
    default: forwardRef(function MockNeighborhood(
      props: { refreshToken: number },
      _ref: unknown,
    ) {
      neighborhoodRefreshTokens.push(props.refreshToken)
      return el('div', { 'data-neighborhood': '' })
    }),
  }
})

vi.mock('../graph/PathEvidenceView', () => ({
  default: () => null,
}))

vi.mock('../graph/GraphSettingsOverlay', () => ({
  default: () => null,
}))

vi.mock('../graph/graph-rpc', () => ({
  closeGraphPage: vi.fn(),
  openSidePanel: vi.fn(),
  queryTrust: vi.fn(() => {
    throw new Error('queryTrust must not run on TRUST_GRAPH_UPDATED')
  }),
}))

const listeners: Array<(message: unknown) => void> = []

function patchMessageListeners(): void {
  listeners.length = 0
  chrome.runtime.onMessage.addListener = (
    fn: (message: unknown) => void,
  ) => {
    listeners.push(fn)
  }
  chrome.runtime.onMessage.removeListener = (
    fn: (message: unknown) => void,
  ) => {
    const index = listeners.indexOf(fn)
    if (index >= 0) listeners.splice(index, 1)
  }
  Object.assign(chrome.storage.onChanged, {
    removeListener() {},
  })
}

describe('GraphPage stale banner', () => {
  let root: Root
  let host: HTMLDivElement

  beforeEach(async () => {
    neighborhoodRefreshTokens.length = 0
    patchMessageListeners()
    host = document.createElement('div')
    document.body.replaceChildren(host)
    root = createRoot(host)
    const { default: GraphPage } = await import('./GraphPage')
    await act(async () => {
      root.render(createElement(GraphPage, { refreshToken: 0 }))
    })
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    chrome.runtime.onMessage.addListener = function addListener() {}
    chrome.runtime.onMessage.removeListener = function removeListener() {}
  })

  it('shows Refresh Graph without reseeding until the button is clicked', async () => {
    expect(neighborhoodRefreshTokens.at(-1)).toBe(0)
    expect(host.querySelector('[data-graph-stale]')).toBeNull()

    await act(async () => {
      for (const listener of [...listeners]) {
        listener({ type: TRUST_GRAPH_UPDATED_MESSAGE })
      }
    })

    expect(neighborhoodRefreshTokens.at(-1)).toBe(0)
    expect(host.querySelector('[data-graph-stale]')).not.toBeNull()

    const button = host.querySelector<HTMLButtonElement>(
      '[data-graph-stale] button',
    )
    expect(button?.textContent).toBe('graph.refresh')

    await act(async () => {
      button?.click()
    })

    expect(host.querySelector('[data-graph-stale]')).toBeNull()
    expect(neighborhoodRefreshTokens.at(-1)).toBe(1)
  })
})
