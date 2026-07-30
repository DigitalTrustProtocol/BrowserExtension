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

/** Per-resolution timeline filter actions. */
export const TRUST_FILTER_ACTIONS = [
  'none',
  'collapsePost',
  'collapseUser',
  'collapseAll',
  'hidePost',
  'hideUser',
  'hideAll',
] as const

export type TrustFilterAction = (typeof TRUST_FILTER_ACTIONS)[number]

export const TRUST_FILTER_RESOLUTIONS = [
  'trusted',
  'mixed',
  'distrusted',
  'none',
] as const

export type TrustFilterResolution = (typeof TRUST_FILTER_RESOLUTIONS)[number]

export type TrustFilters = Record<TrustFilterResolution, TrustFilterAction>

export type XAugmentationFeatures = Record<XAugmentationPanelKey, boolean> & {
  trustFilters: TrustFilters
}

export const X_AUGMENTATION_PANEL_KEYS: readonly XAugmentationPanelKey[] = [
  ...X_AUGMENTATION_FEATURE_KEYS,
  ...X_AUGMENTATION_OPTION_KEYS,
]

export const DEFAULT_TRUST_FILTERS: TrustFilters = {
  trusted: 'none',
  mixed: 'none',
  distrusted: 'none',
  none: 'none',
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

function isTrustFilterAction(value: unknown): value is TrustFilterAction {
  return (
    typeof value === 'string' &&
    (TRUST_FILTER_ACTIONS as readonly string[]).includes(value)
  )
}

/** Migrate legacy hide checkboxes and normalize trust filter dropdowns. */
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
      trusted: isTrustFilterAction(fromNested.trusted)
        ? fromNested.trusted
        : 'none',
      mixed: isTrustFilterAction(fromNested.mixed) ? fromNested.mixed : 'none',
      distrusted: isTrustFilterAction(fromNested.distrusted)
        ? fromNested.distrusted
        : 'none',
      none: isTrustFilterAction(fromNested.none) ? fromNested.none : 'none',
    }
  }

  // Legacy boolean checkboxes → Distrusted dropdown.
  const hidePosts = source?.hideDistrustedPosts === true
  const hideUsers = source?.hideDistrustedUsers === true
  let distrusted: TrustFilterAction = 'none'
  if (hidePosts && hideUsers) distrusted = 'hideAll'
  else if (hideUsers) distrusted = 'hideUser'
  else if (hidePosts) distrusted = 'hidePost'

  return {
    trusted: 'none',
    mixed: 'none',
    distrusted,
    none: 'none',
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
  return TRUST_FILTER_RESOLUTIONS.some((key) => filters[key] !== 'none')
}

/** True when the content script must scan articles for trust (UI and/or filters). */
export function needsArticleTrustScan(features: XAugmentationFeatures): boolean {
  return (
    anyXAugmentationFeature(features) ||
    detailScoreEnabled(features) ||
    anyTrustFilterActive(features.trustFilters)
  )
}

export type TimelineFilterMode = 'none' | 'collapse' | 'hide'

function actionMode(action: TrustFilterAction): TimelineFilterMode {
  if (action.startsWith('hide')) return 'hide'
  if (action.startsWith('collapse')) return 'collapse'
  return 'none'
}

function actionSeverity(action: TrustFilterAction): number {
  const mode = actionMode(action)
  if (mode === 'hide') return 2
  if (mode === 'collapse') return 1
  return 0
}

function actionSpecificity(action: TrustFilterAction): number {
  if (action.endsWith('All')) return 3
  if (action.endsWith('User')) return 2
  if (action.endsWith('Post')) return 1
  return 0
}

function actionMatchesTarget(
  action: TrustFilterAction,
  target: 'author' | 'post',
): boolean {
  if (action === 'none') return false
  if (action.endsWith('All')) return true
  if (action.endsWith('User')) return target === 'author'
  if (action.endsWith('Post')) return target === 'post'
  return false
}

function isFilterResolution(
  value: string | undefined,
): value is TrustFilterResolution {
  return (
    value === 'trusted' ||
    value === 'mixed' ||
    value === 'distrusted' ||
    value === 'none'
  )
}

/**
 * Resolve the effective timeline filter for one article.
 * Priority: hide > collapse > none; then all > user > post.
 * Promoted ads are never filtered.
 */
export function resolveTimelineFilter(options: {
  filters: TrustFilters
  authorResolution?: string
  postResolution?: string
  promoted: boolean
}): { mode: TimelineFilterMode; action: TrustFilterAction; basis: 'author' | 'post' | 'none' } {
  if (options.promoted) {
    return { mode: 'none', action: 'none', basis: 'none' }
  }

  type Candidate = {
    action: TrustFilterAction
    basis: 'author' | 'post'
  }
  const candidates: Candidate[] = []

  if (isFilterResolution(options.authorResolution)) {
    const action = options.filters[options.authorResolution]
    if (actionMatchesTarget(action, 'author')) {
      candidates.push({ action, basis: 'author' })
    }
  }
  if (isFilterResolution(options.postResolution)) {
    const action = options.filters[options.postResolution]
    if (actionMatchesTarget(action, 'post')) {
      candidates.push({ action, basis: 'post' })
    }
  }

  if (candidates.length === 0) {
    return { mode: 'none', action: 'none', basis: 'none' }
  }

  candidates.sort((a, b) => {
    const severity = actionSeverity(b.action) - actionSeverity(a.action)
    if (severity !== 0) return severity
    return actionSpecificity(b.action) - actionSpecificity(a.action)
  })

  const winner = candidates[0]!
  return {
    mode: actionMode(winner.action),
    action: winner.action,
    basis: winner.basis,
  }
}
