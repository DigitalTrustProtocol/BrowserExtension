/** Independent on-page UI features for the x.com content script. Shared with the popup. */
export const X_AUGMENTATION_FEATURES_KEY = 'xAugmentationFeatures'

/** Features that mount on-page UI. Excludes presentation options like actionIcons. */
export const X_AUGMENTATION_FEATURE_KEYS = [
  'chip',
  'ambient',
  'detail',
  'userCard',
] as const

/** Presentation options shown alongside features in the X panel. */
export const X_AUGMENTATION_OPTION_KEYS = ['actionIcons'] as const

export type XAugmentationFeatureKey =
  (typeof X_AUGMENTATION_FEATURE_KEYS)[number]

export type XAugmentationOptionKey =
  (typeof X_AUGMENTATION_OPTION_KEYS)[number]

export type XAugmentationPanelKey =
  | XAugmentationFeatureKey
  | XAugmentationOptionKey

export type XAugmentationFeatures = Record<XAugmentationPanelKey, boolean>

export const X_AUGMENTATION_PANEL_KEYS: readonly XAugmentationPanelKey[] = [
  ...X_AUGMENTATION_FEATURE_KEYS,
  ...X_AUGMENTATION_OPTION_KEYS,
]

export const DEFAULT_X_AUGMENTATION_FEATURES: XAugmentationFeatures = {
  chip: true,
  ambient: true,
  detail: true,
  userCard: true,
  actionIcons: true,
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
    actionIcons: source?.actionIcons !== false,
  }
}

export function anyXAugmentationFeature(
  features: XAugmentationFeatures,
): boolean {
  return X_AUGMENTATION_FEATURE_KEYS.some((key) => features[key])
}
