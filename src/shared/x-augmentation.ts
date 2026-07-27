/** Independent on-page UI features for the x.com content script. Shared with the popup. */
export const X_AUGMENTATION_FEATURES_KEY = 'xAugmentationFeatures'

export const X_AUGMENTATION_FEATURE_KEYS = [
  'chip',
  'ambient',
  'detail',
  'userCard',
] as const

export type XAugmentationFeatureKey =
  (typeof X_AUGMENTATION_FEATURE_KEYS)[number]

export type XAugmentationFeatures = Record<XAugmentationFeatureKey, boolean>

export const DEFAULT_X_AUGMENTATION_FEATURES: XAugmentationFeatures = {
  chip: true,
  ambient: true,
  detail: true,
  userCard: true,
}

export function normalizeXAugmentationFeatures(
  value: unknown,
): XAugmentationFeatures {
  const source =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : undefined
  return {
    chip: source?.chip !== false,
    ambient: source?.ambient !== false,
    detail: source?.detail !== false,
    userCard: source?.userCard !== false,
  }
}

export function anyXAugmentationFeature(
  features: XAugmentationFeatures,
): boolean {
  return X_AUGMENTATION_FEATURE_KEYS.some((key) => features[key])
}
