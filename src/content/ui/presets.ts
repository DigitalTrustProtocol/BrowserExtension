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
} from '../scanner'
import { openSidePanel } from '../open-side-panel'
import { trustDescriptor } from '../trust-helpers'
import type { RatingSummary } from '../rating-summary'
import { formatRatingScore } from '../rating-summary'
import type { TrustSummary } from '../trust-summary'
import { chipToneForSummary } from '../trust-summary'
import type { ArticleTargets } from '../types'
import {
  clearArticlePostSelection,
  createGutterControl,
  ensureArticleOverlay,
  layoutArticleOverlay,
  selectArticlePost,
  type GutterControl,
} from './article-overlay'
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
import { openAuthorTrustOrPanel, openPostRatingOrPanel } from './operator-gate'

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
  overlay?: HTMLElement
  gutter?: GutterControl
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
  openAuthorTrustOrPanel({
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
  openPostRatingOrPanel({
    target: targets.postTarget,
    anchor,
    ...(title ? { title } : displayName ? { title: displayName } : {}),
    ...(onCommitted ? { onCommitted } : {}),
  })
}

function openPostPath(article: HTMLElement, targets: ArticleTargets): void {
  const descriptor = trustDescriptor(targets.postTarget)
  if (!descriptor) return
  selectArticlePost(article)
  void openSidePanel({
    subject: descriptor.subject,
    context: descriptor.context,
  }).catch(() => {
    // Gutter stays quiet; rating popover surfaces panel failures.
  })
}

export function createPreset(features: XAugmentationFeatures): ArticlePreset {
  const states = new Map<HTMLElement, ArticleState>()
  const scoreParts = detailScoreParts(features)
  const showAuthorDetail = detailScoreEnabled(features)

  function tearDown(article: HTMLElement): void {
    const state = states.get(article)
    if (!state) return
    state.gutter?.destroy()
    state.authorChip?.destroy()
    state.authorScore?.destroy()
    state.authorMetaMount?.remove()
    state.postStar?.destroy()
    state.overlay?.remove()
    clearArticlePostSelection(article)
    states.delete(article)
    clearArticleSignals(article)
    clearArticleHide(article)
    clearArticleCollapse(article)
  }

  return {
    features,

    mount(article, targets) {
      const existing = states.get(article)
      if (existing) {
        existing.targets = targets
        // Visibility re-entries land here. Repair-only: re-place mounts X
        // churned out of the DOM. When everything is intact, do nothing —
        // no name-row query, no computed-style read, no layout pass, and no
        // paint (an empty update would flash tones back to neutral).
        const needsMeta = showAuthorDetail || features.chip
        const metaGone =
          needsMeta && !existing.authorMetaMount?.isConnected
        const overlayGone = Boolean(
          existing.overlay && !article.contains(existing.overlay),
        )
        if (!metaGone && !overlayGone) return
        if (metaGone) {
          const metaMount = ensureAuthorNameMetaMount(article)
          if (metaMount) {
            if (existing.authorScore) metaMount.append(existing.authorScore.host)
            if (existing.authorChip) metaMount.append(existing.authorChip.host)
            existing.authorMetaMount = metaMount
          }
        }
        if (existing.overlay && !article.contains(existing.overlay)) {
          article.append(existing.overlay)
        }
        layoutArticleOverlay(article)
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

      const overlay = ensureArticleOverlay(article)
      state.overlay = overlay
      state.gutter = createGutterControl({
        onClick: () => {
          openPostPath(article, state.targets)
          for (const [other, otherState] of states) {
            otherState.gutter?.setSelected(other === article)
          }
        },
      })
      overlay.append(state.gutter.host)

      // UserAuthor only: last on the tweet User-Name row after handle / time.
      // Do not use UserRail/UserHero display-name placement here. Overlay
      // hosts gutter + star so X's name row keeps native alignment.
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
        state.postStar = createRatingStar({
          title: t('content.rating.starTitle'),
          onClick: (anchor) =>
            openRating(article, state.targets, anchor, () => {
              state.postStar?.flashConfirm()
            }),
        })
        overlay.append(state.postStar.host)
      }

      layoutArticleOverlay(article)
    },

    update(article, targets, summaries) {
      const state = states.get(article)
      if (!state) return
      state.targets = targets

      if (showAuthorDetail || features.chip) {
        const metaMount = ensureAuthorNameMetaMount(article)
        if (metaMount && metaMount !== state.authorMetaMount) {
          if (state.authorScore) metaMount.append(state.authorScore.host)
          if (state.authorChip) metaMount.append(state.authorChip.host)
          state.authorMetaMount?.remove()
          state.authorMetaMount = metaMount
        }
      }

      if (features.ambient) {
        // While trust is still loading, keep the last ambient tone — do not
        // flash/clear to neutral on every scan/repaint gap.
        if (summaries.author) {
          setAuthorTone(article, summaries.author.tone)
        } else if (!summaries.authorLoading) {
          setAuthorTone(article, 'neutral')
        }
        if (summaries.post) {
          setPostTone(article, summaries.post.tone)
          state.gutter?.setTone(summaries.post.tone)
        } else if (!summaries.postLoading) {
          setPostTone(article, 'neutral')
          state.gutter?.setTone('neutral')
        }
      } else {
        clearArticleSignals(article)
        state.gutter?.setTone('neutral')
      }

      state.gutter?.setSelected(
        article.dataset.attentionxPostSelected === 'true',
      )

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
        state.postStar?.setTone(summaries.post?.tone ?? 'neutral')
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

      if (state.overlay && !article.contains(state.overlay)) {
        article.append(state.overlay)
      }
      layoutArticleOverlay(article)
    },

    unmount(article) {
      tearDown(article)
    },

    destroy() {
      for (const article of [...states.keys()]) tearDown(article)
    },
  }
}
