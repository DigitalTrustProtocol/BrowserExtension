import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRUST_FILTERS,
  DEFAULT_X_AUGMENTATION_FEATURES,
  needsArticleTrustScan,
  normalizeTrustFilters,
  normalizeXAugmentationFeatures,
  resolveTimelineFilter,
} from './x-augmentation'

describe('normalizeXAugmentationFeatures', () => {
  it('defaults detail text and degree to on', () => {
    expect(normalizeXAugmentationFeatures(undefined)).toEqual(
      DEFAULT_X_AUGMENTATION_FEATURES,
    )
  })

  it('defaults trust filters to none', () => {
    expect(normalizeXAugmentationFeatures(undefined).trustFilters).toEqual(
      DEFAULT_TRUST_FILTERS,
    )
    expect(
      normalizeXAugmentationFeatures({
        chip: true,
      }).trustFilters,
    ).toEqual(DEFAULT_TRUST_FILTERS)
  })

  it('preserves nested trust filter actions', () => {
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
      trusted: 'collapseUser',
      mixed: 'none',
      distrusted: 'hideAll',
      none: 'collapseAll',
    })
  })

  it('defaults missing none filter when migrating nested filters', () => {
    expect(
      normalizeTrustFilters({
        trustFilters: {
          trusted: 'none',
          mixed: 'none',
          distrusted: 'hidePost',
        },
      }),
    ).toEqual({
      trusted: 'none',
      mixed: 'none',
      distrusted: 'hidePost',
      none: 'none',
    })
  })

  it('migrates legacy hide checkboxes into the Distrusted dropdown', () => {
    expect(normalizeTrustFilters({ hideDistrustedPosts: true })).toEqual({
      trusted: 'none',
      mixed: 'none',
      distrusted: 'hidePost',
      none: 'none',
    })
    expect(normalizeTrustFilters({ hideDistrustedUsers: true })).toEqual({
      trusted: 'none',
      mixed: 'none',
      distrusted: 'hideUser',
      none: 'none',
    })
    expect(
      normalizeTrustFilters({
        hideDistrustedPosts: true,
        hideDistrustedUsers: true,
      }),
    ).toEqual({
      trusted: 'none',
      mixed: 'none',
      distrusted: 'hideAll',
      none: 'none',
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

describe('resolveTimelineFilter', () => {
  const none = DEFAULT_TRUST_FILTERS

  it('never filters promoted articles', () => {
    expect(
      resolveTimelineFilter({
        filters: { ...none, distrusted: 'hideAll' },
        authorResolution: 'distrusted',
        postResolution: 'distrusted',
        promoted: true,
      }),
    ).toEqual({ mode: 'none', action: 'none', basis: 'none' })
  })

  it('applies post actions only when the post resolution matches', () => {
    expect(
      resolveTimelineFilter({
        filters: { ...none, distrusted: 'hidePost' },
        postResolution: 'distrusted',
        authorResolution: 'trusted',
        promoted: false,
      }),
    ).toEqual({ mode: 'hide', action: 'hidePost', basis: 'post' })

    expect(
      resolveTimelineFilter({
        filters: { ...none, distrusted: 'hidePost' },
        postResolution: 'trusted',
        authorResolution: 'distrusted',
        promoted: false,
      }),
    ).toEqual({ mode: 'none', action: 'none', basis: 'none' })
  })

  it('applies user actions only when the author resolution matches', () => {
    expect(
      resolveTimelineFilter({
        filters: { ...none, distrusted: 'collapseUser' },
        authorResolution: 'distrusted',
        postResolution: 'trusted',
        promoted: false,
      }),
    ).toEqual({ mode: 'collapse', action: 'collapseUser', basis: 'author' })
  })

  it('applies filters when author or post has no trust evidence', () => {
    expect(
      resolveTimelineFilter({
        filters: { ...none, none: 'collapseAll' },
        authorResolution: 'none',
        postResolution: 'none',
        promoted: false,
      }),
    ).toEqual({ mode: 'collapse', action: 'collapseAll', basis: 'author' })

    expect(
      resolveTimelineFilter({
        filters: { ...none, none: 'hidePost' },
        authorResolution: 'trusted',
        postResolution: 'none',
        promoted: false,
      }),
    ).toEqual({ mode: 'hide', action: 'hidePost', basis: 'post' })
  })

  it('prefers hide over collapse, then all over user over post', () => {
    expect(
      resolveTimelineFilter({
        filters: {
          trusted: 'collapseAll',
          mixed: 'none',
          distrusted: 'hidePost',
          none: 'none',
        },
        authorResolution: 'trusted',
        postResolution: 'distrusted',
        promoted: false,
      }),
    ).toEqual({ mode: 'hide', action: 'hidePost', basis: 'post' })

    expect(
      resolveTimelineFilter({
        filters: {
          trusted: 'collapsePost',
          mixed: 'none',
          distrusted: 'collapseAll',
          none: 'none',
        },
        authorResolution: 'distrusted',
        postResolution: 'trusted',
        promoted: false,
      }),
    ).toEqual({ mode: 'collapse', action: 'collapseAll', basis: 'author' })
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
        trustFilters: { ...DEFAULT_TRUST_FILTERS, distrusted: 'hidePost' },
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
