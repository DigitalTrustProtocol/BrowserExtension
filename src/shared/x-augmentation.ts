/** Independent on-page UI features for the x.com content script. Shared with the popup. */
export const X_AUGMENTATION_FEATURES_KEY = 'xAugmentationFeatures'

/** Features that mount on-page UI. Excludes presentation options like actionIcons. */
export const X_AUGMENTATION_FEATURE_KEYS = [
  'chip',
  'ambient',
  'userCard',
] as const

/** Boolean presentation options shown alongside features in the X panel. */
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

export const TRUST_FILTER_RESOLUTIONS = [
  'trusted',
  'mixed',
  'distrusted',
  'none',
] as const

export type TrustFilterResolution = (typeof TRUST_FILTER_RESOLUTIONS)[number]

/** Per-resolution hide toggles. True = strip matching tweets from GraphQL JSON. */
export type TrustFilters = Record<TrustFilterResolution, boolean>

export type XAugmentationFeatures = Record<XAugmentationPanelKey, boolean> & {
  trustFilters: TrustFilters
}

export const X_AUGMENTATION_PANEL_KEYS: readonly XAugmentationPanelKey[] = [
  ...X_AUGMENTATION_FEATURE_KEYS,
  ...X_AUGMENTATION_OPTION_KEYS,
]

export const DEFAULT_TRUST_FILTERS: TrustFilters = {
  trusted: false,
  mixed: false,
  distrusted: false,
  none: false,
}

export const DEFAULT_X_AUGMENTATION_FEATURES: XAugmentationFeatures = {
  chip: true,
  ambient: true,
  userCard: true,
  detailText: true,
  detailDegree: true,
  actionIcons: true,
  trustFilters: { ...DEFAULT_TRUST_FILTERS },
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

/** True for stored hide actions; collapse / show / unknown → false. */
function isLegacyHideValue(value: unknown): boolean {
  return (
    value === true ||
    value === 'hidePost' ||
    value === 'hideUser' ||
    value === 'hideAll'
  )
}

/** Migrate dropdown actions and legacy hide checkboxes into hide toggles. */
export function normalizeTrustFilters(value: unknown): TrustFilters {
  const source =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : undefined

  const fromNested =
    source?.trustFilters && typeof source.trustFilters === 'object'
      ? (source.trustFilters as Record<string, unknown>)
      : undefined

  if (fromNested) {
    return {
      trusted: isLegacyHideValue(fromNested.trusted),
      mixed: isLegacyHideValue(fromNested.mixed),
      distrusted: isLegacyHideValue(fromNested.distrusted),
      none: isLegacyHideValue(fromNested.none),
    }
  }

  const hidePosts = source?.hideDistrustedPosts === true
  const hideUsers = source?.hideDistrustedUsers === true
  return {
    trusted: false,
    mixed: false,
    distrusted: hidePosts || hideUsers,
    none: false,
  }
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
    trustFilters: normalizeTrustFilters(source),
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

export function anyTrustFilterActive(filters: TrustFilters): boolean {
  return TRUST_FILTER_RESOLUTIONS.some((key) => filters[key])
}

/** True when the content script must scan articles for trust (UI and/or filters). */
export function needsArticleTrustScan(features: XAugmentationFeatures): boolean {
  return (
    anyXAugmentationFeature(features) ||
    detailScoreEnabled(features) ||
    anyTrustFilterActive(features.trustFilters)
  )
}
