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

  function render(next: GraphViewSettings = settings): void {
    act(() => {
      root.render(
        createElement(GraphSettingsOverlay, {
          open: true,
          settings: next,
          mode: 'graph' as const,
          canPath: true,
          canResetFocus: false,
          onClose: () => {},
          onChange: (value: GraphViewSettings) => {
            changes.push(value)
          },
          onModeChange: () => {},
          onResetFocus: () => {},
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
})
