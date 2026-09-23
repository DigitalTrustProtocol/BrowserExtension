/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest'
import {
  applicationTabKindFromSearch,
  applicationTabTitle,
  applyApplicationTabTitle,
} from './application-tab-title'

vi.mock('../lib/i18n', () => ({
  t: (key: string) =>
    (
      ({
        'onboarding.title': 'Attention',
        'graph.mode.graph': 'Graph',
        'graph.mode.path': 'Path',
        'settings.cockpit': 'Advanced Zone',
      }) as Record<string, string>
    )[key] ?? key,
}))

describe('applicationTabTitle', () => {
  it('names Graph, Path, and Advanced Zone', () => {
    expect(applicationTabTitle('graph')).toBe('Attention — Graph')
    expect(applicationTabTitle('path')).toBe('Attention — Path')
    expect(applicationTabTitle('application')).toBe(
      'Attention — Advanced Zone',
    )
  })
})

describe('applicationTabKindFromSearch', () => {
  it('uses Graph or Path only for Graph deep links', () => {
    expect(applicationTabKindFromSearch('')).toBe('application')
    expect(applicationTabKindFromSearch('?page=outbox')).toBe('application')
    expect(applicationTabKindFromSearch('?mode=graph')).toBe('graph')
    expect(applicationTabKindFromSearch('?mode=path')).toBe('path')
  })
})

describe('applyApplicationTabTitle', () => {
  it('sets document.title', () => {
    applyApplicationTabTitle('path')
    expect(document.title).toBe('Attention — Path')
  })
})
