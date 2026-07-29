import { describe, expect, it } from 'vitest'
import {
  batchXTrustSubjectIds,
  buildAuthorTrustSyncFilter,
  buildTrustSlotFilter,
  buildXAccountTrustDiscoveryFilter,
  xSubjectSyncScope,
} from './filters'

describe('relay trust filters', () => {
  const author = 'a'.repeat(64)
  const d = 'b'.repeat(64)

  it('builds author WoT sync scoped to x.com', () => {
    expect(buildAuthorTrustSyncFilter(author)).toEqual({
      kinds: [32009],
      authors: [author],
      '#s': ['x.com'],
    })
    expect(buildAuthorTrustSyncFilter(author, 100)).toEqual({
      kinds: [32009],
      authors: [author],
      '#s': ['x.com'],
      since: 100,
    })
  })

  it('builds X account discovery with user:id, k, and s', () => {
    expect(buildXAccountTrustDiscoveryFilter(['42', '11348282'])).toEqual({
      kinds: [32009],
      '#k': ['user:id'],
      '#s': ['x.com'],
      '#i': ['user:id:42', 'user:id:11348282'],
    })
    expect(
      buildXAccountTrustDiscoveryFilter(['42', '42'], 50),
    ).toEqual({
      kinds: [32009],
      '#k': ['user:id'],
      '#s': ['x.com'],
      '#i': ['user:id:42'],
      since: 50,
    })
  })

  it('rejects empty X subject discovery batches', () => {
    expect(() => buildXAccountTrustDiscoveryFilter([])).toThrow(
      /numeric X user id/i,
    )
    expect(() => buildXAccountTrustDiscoveryFilter(['nasa'])).toThrow(
      /numeric X user id/i,
    )
  })

  it('builds slot refresh filters', () => {
    expect(buildTrustSlotFilter(author, d)).toEqual({
      kinds: [32009],
      authors: [author],
      '#d': [d],
    })
  })

  it('batches observed X ids for relay subject filters', () => {
    expect(batchXTrustSubjectIds(['1', '2', '3'], 2)).toEqual([
      ['1', '2'],
      ['3'],
    ])
    expect(xSubjectSyncScope('attentionx-wot-v1')).toBe(
      'attentionx-wot-v1:x-subjects',
    )
  })
})
