import { t } from '../i18n'
import type { XAugmentationFeatures } from '../../shared/x-augmentation'
import {
  anyTrustFilterActive,
  detailScoreEnabled,
  detailScoreParts,
} from '../../shared/x-augmentation'
import { subjectNodeId } from '../../shared/graph-deeplink'
import {
  ensureAuthorNameMetaMount,
  findAuthorNameRow,
  findPostActionBarAnchor,
} from '../scanner'
import { openGraphPage } from '../open-graph-page'
import { trustDescriptor } from '../trust-helpers'
import type { TrustSummary } from '../trust-summary'
import { chipToneForSummary } from '../trust-summary'
import type { ArticleTargets } from '../types'
import { createTrustChip, type TrustChip } from './chip'
import { readPostHeadline } from './card-title'
import {
  applyArticleFilter,
  clearArticleCollapse,
  clearArticleHide,
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
  post?: TrustSummary
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
  postChip?: TrustChip
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
  void openGraphPage({
    mode: 'path',
    subject: descriptor.subject,
    context: descriptor.context,
    focus: subjectNodeId(descriptor.subject),
  }).catch(() => {
    // Compact score stays quiet; TrustCard surfaces open failures.
  })
}

function openCard(
  article: HTMLElement,
  targets: ArticleTargets,
  variant: 'author' | 'post',
): void {
  const nameRow = findAuthorNameRow(article)
  const title =
    variant === 'author'
      ? readDisplayName(nameRow ?? article)
      : readPostHeadline(article, targets.postTarget.id)
  openTrustDialog({
    target: variant === 'author' ? targets.profileTarget : targets.postTarget,
    variant,
    ...(title ? { title } : {}),
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
    state.postChip?.destroy()
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
              onClick: () => openCard(article, state.targets, 'author'),
            })
            metaMount.append(state.authorChip.host)
          }
        }
      }

      if (features.chip) {
        const actionAnchor = findPostActionBarAnchor(article)
        if (actionAnchor) {
          ensureRelativeAnchor(actionAnchor)
          state.postChip = createTrustChip({
            title: t('content.card.postChipTitle'),
            role: 'post',
            variant: 'overlay',
            onClick: () => openCard(article, state.targets, 'post'),
          })
          // Sit over the trailing control area without flex insertion.
          state.postChip.host.style.right = '36px'
          state.postChip.host.style.bottom = '50%'
          state.postChip.host.style.top = 'auto'
          state.postChip.host.style.left = 'auto'
          state.postChip.host.style.transform = 'translateY(50%)'
          actionAnchor.append(state.postChip.host)
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
        if (summaries.post) {
          setPostTone(article, summaries.post.tone)
        } else if (!summaries.postLoading) {
          setPostTone(article, 'neutral')
        }
      } else {
        clearArticleSignals(article)
      }

      if (features.chip) {
        const authorChipTone = summaries.author
          ? chipToneForSummary(summaries.author)
          : 'neutral'
        const postChipTone = summaries.post
          ? chipToneForSummary(summaries.post)
          : 'neutral'
        state.authorChip?.setLoading(Boolean(summaries.authorLoading))
        state.postChip?.setLoading(Boolean(summaries.postLoading))
        state.authorChip?.setTone(authorChipTone)
        state.postChip?.setTone(postChipTone)
        state.authorChip?.setLabel(
          chipLabel(
            summaries.author,
            t('content.card.authorChipTitle'),
            scoreParts,
          ),
        )
        state.postChip?.setLabel(
          chipLabel(
            summaries.post,
            t('content.card.postChipTitle'),
            scoreParts,
          ),
        )
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
          ...(summaries.post ? { post: summaries.post } : {}),
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
