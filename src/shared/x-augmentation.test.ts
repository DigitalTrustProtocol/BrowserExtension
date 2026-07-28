import { describe, expect, it } from 'vitest'
import {
  DEFAULT_X_AUGMENTATION_FEATURES,
  normalizeXAugmentationFeatures,
} from './x-augmentation'

describe('normalizeXAugmentationFeatures', () => {
  it('defaults detail text and degree to on', () => {
    expect(normalizeXAugmentationFeatures(undefined)).toEqual(
      DEFAULT_X_AUGMENTATION_FEATURES,
    )
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
