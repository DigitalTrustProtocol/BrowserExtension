import { t } from '../i18n'
import type { XAugmentationFeatures } from '../../shared/x-augmentation'
import {
  anyTrustFilterActive,
  detailScoreEnabled,
  detailScoreParts,
} from '../../shared/x-augmentation'
import {
  ensureAuthorNameMetaMount,
  findAuthorNameRow,
  findPostActionBarAnchor,
} from '../scanner'
import { openSidePanel } from '../open-side-panel'
import { trustDescriptor } from '../trust-helpers'
import type { RatingSummary } from '../rating-summary'
import { formatRatingScore } from '../rating-summary'
import type { TrustSummary } from '../trust-summary'
import { chipToneForSummary } from '../trust-summary'
import type { ArticleTargets } from '../types'
import { createTrustChip, type TrustChip } from './chip'
import { createRatingStar, type RatingStar } from './star'
import { readPostHeadline } from './card-title'
import {
  applyArticleFilter,
  clearArticleCollapse,
  clearArticleHide,
  cloneAuthorVerifiedBadge,
  ensureFilterStylesheet,
} from './hide'
import { UI_TIMELINE_FILTERING_ENABLED } from '../json-filter-bridge'
import {
  clearArticleSignals,
  formatTrustScore,
  readDisplayName,
  setAuthorTone,
  setPostTone,
} from './signals'
import { createTrustScoreLabel, type TrustScoreLabel } from './score'
import { openTrustDialog } from './trust-dialog'
import { openRatingPopover } from './rating-popover'

export {
  anyTrustFilterActive,
  anyXAugmentationFeature,
  DEFAULT_TRUST_FILTERS,
  DEFAULT_X_AUGMENTATION_FEATURES,
  detailScoreEnabled,
  detailScoreParts,
  needsArticleTrustScan,
  normalizeTrustFilters,
  normalizeXAugmentationFeatures,
  resolveTimelineFilter,
  TRUST_FILTER_ACTIONS,
  TRUST_FILTER_RESOLUTIONS,
  X_AUGMENTATION_FEATURE_KEYS,
  X_AUGMENTATION_FEATURES_KEY,
  X_AUGMENTATION_OPTION_KEYS,
  X_AUGMENTATION_PANEL_KEYS,
  type TrustFilterAction,
  type TrustFilterResolution,
  type TrustFilters,
  type XAugmentationFeatureKey,
  type XAugmentationFeatures,
  type XAugmentationOptionKey,
  type XAugmentationPanelKey,
} from '../../shared/x-augmentation'

export interface PresetSummaries {
  author?: TrustSummary
  post?: RatingSummary
  authorLoading?: boolean
  postLoading?: boolean
}

/** Feature-driven article augmenter: mount / update / unmount. */
export interface ArticlePreset {
  readonly features: XAugmentationFeatures
  mount(article: HTMLElement, targets: ArticleTargets): void
  update(
    article: HTMLElement,
    targets: ArticleTargets,
    summaries: PresetSummaries,
  ): void
  unmount(article: HTMLElement): void
  destroy(): void
}

interface ArticleState {
  authorMetaMount?: HTMLElement
  authorChip?: TrustChip
  authorScore?: TrustScoreLabel
  postStar?: RatingStar
  targets: ArticleTargets
}

function chipLabel(
  summary: TrustSummary | undefined,
  defaultTitle: string,
  parts: { text: boolean; degree: boolean },
): string {
  if (!summary || summary.resolution === 'none') return defaultTitle
  return formatTrustScore(summary, parts) ?? defaultTitle
}

function openAuthorPath(targets: ArticleTargets): void {
  const descriptor = trustDescriptor(targets.profileTarget)
  if (!descriptor) return
  void openSidePanel({
    subject: descriptor.subject,
    context: descriptor.context,
  }).catch(() => {
    // Compact score stays quiet; Notes / rating popover surface failures.
  })
}

function openCard(
  article: HTMLElement,
  targets: ArticleTargets,
): void {
  const nameRow = findAuthorNameRow(article)
  const displayName = readDisplayName(nameRow ?? article)
  const verifiedBadge = cloneAuthorVerifiedBadge(article)
  openTrustDialog({
    target: targets.profileTarget,
    variant: 'author',
    ...(displayName ? { title: displayName } : {}),
    ...(verifiedBadge ? { verifiedBadge } : {}),
  })
}

function openRating(
  article: HTMLElement,
  targets: ArticleTargets,
  anchor: HTMLElement,
  onCommitted?: () => void,
): void {
  const nameRow = findAuthorNameRow(article)
  const displayName = readDisplayName(nameRow ?? article)
  const title = readPostHeadline(article, targets.postTarget.id)
  openRatingPopover({
    target: targets.postTarget,
    anchor,
    ...(title ? { title } : displayName ? { title: displayName } : {}),
    ...(onCommitted ? { onCommitted } : {}),
  })
}

/** Ensure overlay parent can host absolute children without affecting layout. */
function ensureRelativeAnchor(anchor: HTMLElement): void {
  const style = getComputedStyle(anchor)
  if (style.position === 'static') {
    anchor.style.position = 'relative'
  }
}

export function createPreset(features: XAugmentationFeatures): ArticlePreset {
  const states = new Map<HTMLElement, ArticleState>()
  const scoreParts = detailScoreParts(features)
  const showAuthorDetail = detailScoreEnabled(features)

  function tearDown(article: HTMLElement): void {
    const state = states.get(article)
    if (!state) return
    state.authorChip?.destroy()
    state.authorScore?.destroy()
    state.authorMetaMount?.remove()
    state.postStar?.destroy()
    states.delete(article)
    clearArticleSignals(article)
    clearArticleHide(article)
    clearArticleCollapse(article)
  }

  return {
    features,

    mount(article, targets) {
      if (states.has(article)) {
        this.update(article, targets, {})
        return
      }
      if (
        UI_TIMELINE_FILTERING_ENABLED &&
        anyTrustFilterActive(features.trustFilters)
      ) {
        ensureFilterStylesheet()
      }
      const state: ArticleState = { targets }
      states.set(article, state)

      // Headline: last child div under User-Name holds compact detail then chip.
      // Post chip stays an absolute overlay on the action bar.
      const needsAuthorHeadline = showAuthorDetail || features.chip
      if (needsAuthorHeadline) {
        const metaMount = ensureAuthorNameMetaMount(article)
        if (metaMount) {
          state.authorMetaMount = metaMount
          if (showAuthorDetail) {
            state.authorScore = createTrustScoreLabel({ compact: true })
            state.authorScore.setOnOpenPath(() =>
              openAuthorPath(state.targets),
            )
            metaMount.append(state.authorScore.host)
          }
          if (features.chip) {
            state.authorChip = createTrustChip({
              title: t('content.card.authorChipTitle'),
              role: 'author',
              variant: 'inline',
              compact: true,
              onClick: () => openCard(article, state.targets),
            })
            metaMount.append(state.authorChip.host)
          }
        }
      }

      if (features.chip) {
        const actionAnchor = findPostActionBarAnchor(article)
        if (actionAnchor) {
          ensureRelativeAnchor(actionAnchor)
          state.postStar = createRatingStar({
            title: t('content.rating.starTitle'),
            onClick: (anchor) =>
              openRating(article, state.targets, anchor, () => {
                state.postStar?.flashConfirm()
              }),
          })
          // Sit over the trailing control area without flex insertion.
          state.postStar.host.style.right = '36px'
          state.postStar.host.style.bottom = '50%'
          state.postStar.host.style.top = 'auto'
          state.postStar.host.style.left = 'auto'
          state.postStar.host.style.transform = 'translateY(50%)'
          actionAnchor.append(state.postStar.host)
        }
      }
    },

    update(article, targets, summaries) {
      const state = states.get(article)
      if (!state) return
      state.targets = targets

      if (features.ambient) {
        // While trust is still loading, keep the last ambient tone — do not
        // flash/clear to neutral on every scan/repaint gap.
        if (summaries.author) {
          setAuthorTone(article, summaries.author.tone)
        } else if (!summaries.authorLoading) {
          setAuthorTone(article, 'neutral')
        }
        setPostTone(article, 'neutral')
      } else {
        clearArticleSignals(article)
      }

      if (features.chip) {
        const authorChipTone = summaries.author
          ? chipToneForSummary(summaries.author)
          : 'neutral'
        state.authorChip?.setLoading(Boolean(summaries.authorLoading))
        state.postStar?.setLoading(Boolean(summaries.postLoading))
        state.authorChip?.setTone(authorChipTone)
        state.authorChip?.setLabel(
          chipLabel(
            summaries.author,
            t('content.card.authorChipTitle'),
            scoreParts,
          ),
        )
        const ratingLabel =
          summaries.post && summaries.post.averageScore !== null
            ? t('content.rating.starScored', {
                score: formatRatingScore(summaries.post) ?? '',
              })
            : t('content.rating.starTitle')
        state.postStar?.setLabel(ratingLabel)
        state.postStar?.setScore(summaries.post?.averageScore ?? null)
      }

      if (showAuthorDetail) {
        state.authorScore?.set(
          summaries.author
            ? formatTrustScore(summaries.author, scoreParts)
            : undefined,
          summaries.author?.tone ?? 'neutral',
        )
      }

      if (UI_TIMELINE_FILTERING_ENABLED) {
        const nameRow = findAuthorNameRow(article)
        const displayName =
          readDisplayName(nameRow ?? article) ??
          targets.profileTarget.handle ??
          targets.postTarget.handle ??
          ''
        const handle =
          targets.profileTarget.handle ?? targets.postTarget.handle
        applyArticleFilter({
          article,
          filters: features.trustFilters,
          ...(summaries.author ? { author: summaries.author } : {}),
          displayName,
          ...(handle
            ? { handle: handle.startsWith('@') ? handle : `@${handle}` }
            : {}),
        })
      } else {
        // JSON owns hide; collapse + demoted Ad markers come from decorate only.
        clearArticleHide(article)
      }
    },

    unmount(article) {
      tearDown(article)
    },

    destroy() {
      for (const article of [...states.keys()]) tearDown(article)
    },
  }
}
