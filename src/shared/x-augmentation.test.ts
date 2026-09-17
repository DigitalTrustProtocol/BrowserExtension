import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRUST_FILTERS,
  DEFAULT_X_AUGMENTATION_FEATURES,
  needsArticleTrustScan,
  normalizeTrustFilters,
  normalizeXAugmentationFeatures,
} from './x-augmentation'

describe('normalizeXAugmentationFeatures', () => {
  it('defaults detail text and degree to on', () => {
    expect(normalizeXAugmentationFeatures(undefined)).toEqual(
      DEFAULT_X_AUGMENTATION_FEATURES,
    )
  })

  it('defaults trust filters to off', () => {
    expect(normalizeXAugmentationFeatures(undefined).trustFilters).toEqual(
      DEFAULT_TRUST_FILTERS,
    )
    expect(
      normalizeXAugmentationFeatures({
        chip: true,
      }).trustFilters,
    ).toEqual(DEFAULT_TRUST_FILTERS)
  })

  it('migrates hide actions to on and collapse / show to off', () => {
    expect(
      normalizeXAugmentationFeatures({
        trustFilters: {
          trusted: 'collapseUser',
          mixed: 'none',
          distrusted: 'hideAll',
          none: 'collapseAll',
        },
      }).trustFilters,
    ).toEqual({
      trusted: false,
      mixed: false,
      distrusted: true,
      none: false,
    })
  })

  it('preserves boolean hide toggles', () => {
    expect(
      normalizeTrustFilters({
        trustFilters: {
          trusted: false,
          mixed: true,
          distrusted: true,
        },
      }),
    ).toEqual({
      trusted: false,
      mixed: true,
      distrusted: true,
      none: false,
    })
  })

  it('migrates granular hide actions and missing none to booleans', () => {
    expect(
      normalizeTrustFilters({
        trustFilters: {
          trusted: 'none',
          mixed: 'none',
          distrusted: 'hidePost',
        },
      }),
    ).toEqual({
      trusted: false,
      mixed: false,
      distrusted: true,
      none: false,
    })
    expect(
      normalizeTrustFilters({
        trustFilters: {
          trusted: 'hideUser',
          mixed: false,
          distrusted: 'hideAll',
          none: true,
        },
      }),
    ).toEqual({
      trusted: true,
      mixed: false,
      distrusted: true,
      none: true,
    })
  })

  it('migrates legacy hide checkboxes into the Distrusted toggle', () => {
    expect(normalizeTrustFilters({ hideDistrustedPosts: true })).toEqual({
      trusted: false,
      mixed: false,
      distrusted: true,
      none: false,
    })
    expect(normalizeTrustFilters({ hideDistrustedUsers: true })).toEqual({
      trusted: false,
      mixed: false,
      distrusted: true,
      none: false,
    })
    expect(
      normalizeTrustFilters({
        hideDistrustedPosts: true,
        hideDistrustedUsers: true,
      }),
    ).toEqual({
      trusted: false,
      mixed: false,
      distrusted: true,
      none: false,
    })
  })

  it('migrates the legacy detail flag to both detail options', () => {
    expect(
      normalizeXAugmentationFeatures({
        chip: true,
        ambient: true,
        detail: false,
        userCard: true,
        actionIcons: true,
      }),
    ).toMatchObject({
      detailText: false,
      detailDegree: false,
    })

    expect(
      normalizeXAugmentationFeatures({
        detail: true,
      }),
    ).toMatchObject({
      detailText: true,
      detailDegree: true,
    })
  })

  it('lets detail text and degree be toggled independently', () => {
    expect(
      normalizeXAugmentationFeatures({
        detailText: true,
        detailDegree: false,
      }),
    ).toMatchObject({
      detailText: true,
      detailDegree: false,
    })
  })
})

describe('needsArticleTrustScan', () => {
  it('is true when only trust filters are enabled', () => {
    expect(
      needsArticleTrustScan({
        ...DEFAULT_X_AUGMENTATION_FEATURES,
        chip: false,
        ambient: false,
        userCard: false,
        detailText: false,
        detailDegree: false,
        trustFilters: { ...DEFAULT_TRUST_FILTERS, distrusted: true },
      }),
    ).toBe(true)
  })

  it('is false when all features and filters are off', () => {
    expect(
      needsArticleTrustScan({
        ...DEFAULT_X_AUGMENTATION_FEATURES,
        chip: false,
        ambient: false,
        userCard: false,
        detailText: false,
        detailDegree: false,
        trustFilters: { ...DEFAULT_TRUST_FILTERS },
      }),
    ).toBe(false)
  })
})
