/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import {
  JSON_TRUST_FILTER_SOURCE,
  JSON_TRUST_FILTER_VERSION,
} from '../shared/json-trust-filter-messages'
import { resolutionKey } from '../shared/timeline-json-filter'
import { DEFAULT_TRUST_FILTERS } from '../shared/x-augmentation'
import { createJsonTrustFilterController } from './json-trust-filter'

describe('createJsonTrustFilterController', () => {
  it('clears cached resolutions on reset and ignores stale epoch results', () => {
    const handlers: Array<(data: unknown) => void> = []
    const controller = createJsonTrustFilterController(window, {
      post() {},
      subscribe(handler) {
        handlers.push(handler)
        return () => undefined
      },
    })

    controller.applyConfig({
      enabled: true,
      filters: { ...DEFAULT_TRUST_FILTERS, distrusted: 'hidePost' },
      resolutions: { [resolutionKey('user', '1')]: 'distrusted' },
    })
    expect(controller.resolutions[resolutionKey('user', '1')]).toBe(
      'distrusted',
    )

    controller.applyConfig({
      enabled: true,
      filters: { ...DEFAULT_TRUST_FILTERS, distrusted: 'hidePost' },
      resetResolutions: true,
    })
    expect(controller.resolutions[resolutionKey('user', '1')]).toBeUndefined()

    for (const handler of handlers) {
      handler({
        source: JSON_TRUST_FILTER_SOURCE,
        version: JSON_TRUST_FILTER_VERSION,
        type: 'resolve-result',
        requestId: 'jtf-0-stale',
        resolutions: { [resolutionKey('user', '1')]: 'trusted' },
      })
    }
    expect(controller.resolutions[resolutionKey('user', '1')]).toBeUndefined()

    for (const handler of handlers) {
      handler({
        source: JSON_TRUST_FILTER_SOURCE,
        version: JSON_TRUST_FILTER_VERSION,
        type: 'resolve-result',
        requestId: 'jtf-1-fresh',
        resolutions: { [resolutionKey('user', '1')]: 'mixed' },
      })
    }
    expect(controller.resolutions[resolutionKey('user', '1')]).toBe('mixed')

    controller.uninstall()
  })
})
