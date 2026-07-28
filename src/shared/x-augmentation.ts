/** Independent on-page UI features for the x.com content script. Shared with the popup. */
export const X_AUGMENTATION_FEATURES_KEY = 'xAugmentationFeatures'

/** Features that mount on-page UI. Excludes presentation options like actionIcons. */
export const X_AUGMENTATION_FEATURE_KEYS = [
  'chip',
  'ambient',
  'userCard',
] as const

/** Presentation options shown alongside features in the X panel. */
export const X_AUGMENTATION_OPTION_KEYS = [
  'detailText',
  'detailDegree',
  'actionIcons',
] as const

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
  userCard: true,
  detailText: true,
  detailDegree: true,
  actionIcons: true,
}

export interface TrustScoreFormatParts {
  text: boolean
  degree: boolean
}

function readAugmentationFlag(
  source: Record<string, unknown> | undefined,
  key: XAugmentationPanelKey,
  legacyDetail?: boolean,
): boolean {
  if (source && key in source) return source[key] !== false
  if (legacyDetail !== undefined) return legacyDetail
  return DEFAULT_X_AUGMENTATION_FEATURES[key]
}

export function normalizeXAugmentationFeatures(
  value: unknown,
): XAugmentationFeatures {
  const source =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : undefined
  const legacyDetail =
    source && 'detail' in source ? source.detail !== false : undefined

  return {
    chip: readAugmentationFlag(source, 'chip'),
    ambient: readAugmentationFlag(source, 'ambient'),
    userCard: readAugmentationFlag(source, 'userCard'),
    detailText: readAugmentationFlag(source, 'detailText', legacyDetail),
    detailDegree: readAugmentationFlag(source, 'detailDegree', legacyDetail),
    actionIcons: readAugmentationFlag(source, 'actionIcons'),
  }
}

export function detailScoreEnabled(features: XAugmentationFeatures): boolean {
  return features.detailText || features.detailDegree
}

export function detailScoreParts(
  features: Pick<XAugmentationFeatures, 'detailText' | 'detailDegree'>,
): TrustScoreFormatParts {
  return {
    text: features.detailText,
    degree: features.detailDegree,
  }
}

export function anyXAugmentationFeature(
  features: XAugmentationFeatures,
): boolean {
  return X_AUGMENTATION_FEATURE_KEYS.some((key) => features[key])
}
