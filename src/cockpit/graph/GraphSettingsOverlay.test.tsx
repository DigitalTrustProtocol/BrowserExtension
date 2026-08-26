/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import GraphSettingsOverlay from './GraphSettingsOverlay'
import {
  DEFAULT_GRAPH_VIEW_SETTINGS,
  type GraphViewSettings,
} from './types'

vi.mock('../../lib/i18n', () => ({
  t: (key: string) => key,
}))

vi.mock('./GraphOverlays.module.css', () => {
  const styles = new Proxy(
    {},
    { get: (_target, prop) => String(prop) },
  )
  return { default: styles }
})

describe('GraphSettingsOverlay', () => {
  let root: Root
  let host: HTMLDivElement
  let settings: GraphViewSettings
  let changes: GraphViewSettings[]

  beforeEach(() => {
    settings = { ...DEFAULT_GRAPH_VIEW_SETTINGS, search: 'alice' }
    changes = []
    host = document.createElement('div')
    document.body.replaceChildren(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    document.body.replaceChildren()
  })

  function render(
    next: GraphViewSettings = settings,
    mode: 'graph' | 'path' = 'graph',
    extras: { onFocusMe?: () => void; meName?: string } = {},
  ): void {
    act(() => {
      root.render(
        createElement(GraphSettingsOverlay, {
          open: true,
          settings: next,
          mode,
          canPath: true,
          meName: extras.meName ?? 'Alex',
          onClose: () => {},
          onChange: (value: GraphViewSettings) => {
            changes.push(value)
          },
          onModeChange: () => {},
          onFocusMe: extras.onFocusMe ?? (() => {}),
        }),
      )
    })
  }

  it('uses Statements-style filter links and has no context control', () => {
    render()
    const group = host.querySelector('[role="group"]')
    expect(group?.getAttribute('aria-label')).toBe('graph.filterFinalStatements')
    const links = [...host.querySelectorAll('[role="group"] button')]
    expect(links.map((btn) => btn.textContent)).toEqual([
      'graph.trust',
      'graph.neutral',
      'graph.distrust',
      'graph.reset',
    ])
    expect(links.every((btn) => btn.getAttribute('aria-pressed') !== 'true')).toBe(
      true,
    )
    expect(host.textContent).not.toContain('graph.context')
    expect(host.textContent).not.toContain('graph.trustPolarity')
    expect(
      [...host.querySelectorAll('option')].map((opt) => opt.value),
    ).not.toContain('identity')
  })

  it('marks the selected final-statement filter pressed', () => {
    render({ ...settings, finalStatementFilter: 'neutral' })
    const links = [...host.querySelectorAll('[role="group"] button')]
    expect(links[0]?.getAttribute('aria-pressed')).toBe('false')
    expect(links[1]?.getAttribute('aria-pressed')).toBe('true')
    expect(links[2]?.getAttribute('aria-pressed')).toBe('false')
  })

  it('applies Trust-plus filters and Reset clears search', () => {
    render()
    const [trust, , distrust, reset] = [
      ...host.querySelectorAll('[role="group"] button'),
    ]
    act(() => {
      trust?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(changes.at(-1)?.finalStatementFilter).toBe('trust')

    act(() => {
      distrust?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(changes.at(-1)?.finalStatementFilter).toBe('distrust')

    act(() => {
      reset?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(changes.at(-1)).toMatchObject({
      finalStatementFilter: 'all',
      search: '',
    })
  })

  it('exposes keyboard-visible focus treatment on filter links', () => {
    render()
    const trust = host.querySelector('[role="group"] button')
    expect(trust?.tagName).toBe('BUTTON')
    expect(trust?.getAttribute('type')).toBe('button')
    act(() => {
      ;(trust as HTMLButtonElement).focus()
    })
    expect(document.activeElement).toBe(trust)
  })

  it('places the search field before the final-statement filter in Graph mode', () => {
    render()
    const search = host.querySelector('input[type="search"]')
    const group = host.querySelector('[role="group"]')
    expect(search).toBeTruthy()
    expect(group).toBeTruthy()
    const position = search!.compareDocumentPosition(group!)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(host.textContent).toContain('graph.direction')
    expect(host.textContent).not.toContain('graph.maxHops')
    expect(host.textContent).toContain('graph.colorBy')
    expect(host.textContent).toContain('graph.showLabels')
    expect(host.textContent).not.toContain('graph.showArrows')
    expect(host.textContent).toContain('graph.layout')
    const colorBy = [...host.querySelectorAll('label')].find((label) =>
      label.textContent?.includes('graph.colorBy'),
    )
    const showLabels = [...host.querySelectorAll('label')].find((label) =>
      label.textContent?.includes('graph.showLabels'),
    )
    expect(colorBy?.querySelector('input[type="checkbox"]')).toBeTruthy()
    expect(
      colorBy!.compareDocumentPosition(showLabels!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('shows only search, statement filters, and labels in Path mode', () => {
    render(settings, 'path')
    const search = host.querySelector('input[type="search"]')
    const group = host.querySelector('[role="group"]')
    expect(search).toBeTruthy()
    expect(group).toBeTruthy()
    const position = search!.compareDocumentPosition(group!)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(host.textContent).toContain('graph.showLabels')
    expect(host.textContent).not.toContain('graph.direction')
    expect(host.textContent).not.toContain('graph.maxHops')
    expect(host.textContent).not.toContain('graph.showArrows')
    expect(host.textContent).not.toContain('graph.showUserIcons')
    expect(host.textContent).not.toContain('graph.layout')
    expect(host.textContent).not.toContain('graph.colorBy')
  })

  it('shows Me chrome below the settings title and focuses Me on click', () => {
    const onFocusMe = vi.fn()
    render(settings, 'graph', { onFocusMe, meName: 'Alex' })
    const heading = host.querySelector('h2')
    expect(heading?.textContent).toBe('graph.settings')
    const me = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Alex'),
    )
    expect(me).toBeTruthy()
    expect(
      heading!.compareDocumentPosition(me!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(host.textContent).not.toContain('graph.resetToMe')
    act(() => {
      me?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onFocusMe).toHaveBeenCalledTimes(1)
  })
})
