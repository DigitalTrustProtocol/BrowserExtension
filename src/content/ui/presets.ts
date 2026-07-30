import { t } from '../i18n'
import type { XAugmentationFeatures } from '../../shared/x-augmentation'
import {
  anyTrustFilterActive,
  detailScoreEnabled,
  detailScoreParts,
} from '../../shared/x-augmentation'
import { openGraphPage } from '../open-graph-page'
import { subjectNodeId } from '../../shared/graph-deeplink'
import {
  findAuthorChipSlot,
  findAuthorNameRow,
  findPostChipSlot,
  insertAtSlot,
} from '../scanner'
import { trustDescriptor } from '../trust-helpers'
import type { TrustSummary } from '../trust-summary'
import { chipToneForSummary } from '../trust-summary'
import type { ArticleTargets, TrustTone } from '../types'
import { createTrustChip, type TrustChip } from './chip'
import { readPostHeadline } from './card-title'
import { openPopover } from './popover'
import { createTrustScoreLabel, type TrustScoreLabel } from './score'
import {
  applyArticleFilter,
  clearArticleCollapse,
  clearArticleHide,
  ensureFilterStylesheet,
} from './hide'
import { applyTimelineDecorateToArticle } from './timeline-decorate'
import { UI_TIMELINE_FILTERING_ENABLED } from '../json-filter-bridge'
import {
  clearArticleSignals,
  formatTrustScore,
  readDisplayName,
  setAuthorTone,
  setPostTone,
} from './signals'
import { TrustCard } from './trust-card'

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
  authorChip?: TrustChip
  postChip?: TrustChip
  authorScore?: TrustScoreLabel
  postScore?: TrustScoreLabel
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

function openPathGraph(targets: ArticleTargets, variant: 'author' | 'post'): void {
  const target =
    variant === 'author' ? targets.profileTarget : targets.postTarget
  const descriptor = trustDescriptor(target)
  if (!descriptor) return
  void openGraphPage({
    mode: 'path',
    subject: descriptor.subject,
    context: descriptor.context,
    focus: subjectNodeId(descriptor.subject),
  }).catch(() => {
    // The content UI has no persistent status surface; TrustCard reports
    // opener failures when the user needs actionable feedback.
  })
}

function openCard(
  anchor: HTMLElement,
  article: HTMLElement,
  targets: ArticleTargets,
  variant: 'author' | 'post',
): void {
  openPopover(anchor, (container) => {
    const nameRow = findAuthorNameRow(article)
    const title =
      variant === 'author'
        ? readDisplayName(nameRow ?? article)
        : readPostHeadline(article, targets.postTarget.id)
    const card = new TrustCard({
      target:
        variant === 'author' ? targets.profileTarget : targets.postTarget,
      variant,
      ...(title ? { title } : {}),
    })
    container.append(card.host)
    return () => card.destroy()
  })
}

export const AUTHOR_META_ATTR = 'data-attentionx-author-meta'

/** Keeps degree text + author chip on one row inside column User-Name layouts. */
function ensureAuthorMetaCluster(nameRow: HTMLElement): HTMLElement {
  let cluster = nameRow.querySelector<HTMLElement>(`[${AUTHOR_META_ATTR}]`)
  if (cluster) return cluster
  cluster = document.createElement('span')
  cluster.setAttribute(AUTHOR_META_ATTR, 'true')
  cluster.style.cssText =
    'display:inline-flex;align-items:center;flex:0 0 auto;flex-wrap:nowrap;gap:2px;min-width:0;max-width:100%;line-height:1;'
  nameRow.append(cluster)
  return cluster
}

export function createPreset(features: XAugmentationFeatures): ArticlePreset {
  const states = new Map<HTMLElement, ArticleState>()
  const scoreParts = detailScoreParts(features)
  const showDetailScore = detailScoreEnabled(features)

  function tearDown(article: HTMLElement): void {
    const state = states.get(article)
    if (!state) return
    state.authorChip?.destroy()
    state.postChip?.destroy()
    state.authorScore?.destroy()
    state.postScore?.destroy()
    article.querySelector(`[${AUTHOR_META_ATTR}]`)?.remove()
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
      if (UI_TIMELINE_FILTERING_ENABLED && anyTrustFilterActive(features.trustFilters)) {
        ensureFilterStylesheet()
      }
      const state: ArticleState = { targets }
      states.set(article, state)

      const nameRow = findAuthorNameRow(article)
      if (nameRow && (showDetailScore || features.chip)) {
        if (showDetailScore && features.chip) {
          // Status pages stack User-Name as a column; keep degree + chip inline.
          const cluster = ensureAuthorMetaCluster(nameRow)
          state.authorScore = createTrustScoreLabel()
          state.authorScore.setOnOpenPath(() =>
            openPathGraph(state.targets, 'author'),
          )
          state.authorChip = createTrustChip({
            title: t('content.card.authorChipTitle'),
            onClick: (anchor) =>
              openCard(anchor, article, state.targets, 'author'),
          })
          cluster.append(state.authorScore.host, state.authorChip.host)
        } else if (showDetailScore) {
          state.authorScore = createTrustScoreLabel()
          state.authorScore.setOnOpenPath(() =>
            openPathGraph(state.targets, 'author'),
          )
          nameRow.append(state.authorScore.host)
        } else if (features.chip) {
          const authorSlot = findAuthorChipSlot(article)
          if (authorSlot) {
            state.authorChip = createTrustChip({
              title: t('content.card.authorChipTitle'),
              onClick: (anchor) =>
                openCard(anchor, article, state.targets, 'author'),
            })
            insertAtSlot(state.authorChip.host, authorSlot)
          }
        }
      }

      if (features.chip) {
        const postSlot = findPostChipSlot(article)
        if (postSlot) {
          // Detail for posts sits just before the chip (and bookmark).
          if (showDetailScore) {
            state.postScore = createTrustScoreLabel()
            state.postScore.setOnOpenPath(() =>
              openPathGraph(state.targets, 'post'),
            )
            insertAtSlot(state.postScore.host, postSlot)
          }
          state.postChip = createTrustChip({
            title: t('content.card.postChipTitle'),
            onClick: (anchor) => openCard(anchor, article, state.targets, 'post'),
            marginEnd: 10,
          })
          insertAtSlot(state.postChip.host, {
            parent: postSlot.parent,
            before: postSlot.before,
          })
        }
      } else if (showDetailScore) {
        const postSlot = findPostChipSlot(article)
        if (postSlot) {
          state.postScore = createTrustScoreLabel()
          state.postScore.setOnOpenPath(() =>
            openPathGraph(state.targets, 'post'),
          )
          insertAtSlot(state.postScore.host, postSlot)
        }
      }
    },

    update(article, targets, summaries) {
      const state = states.get(article)
      if (!state) return
      state.targets = targets

      const authorTone: TrustTone = summaries.author?.tone ?? 'neutral'
      const postTone: TrustTone = summaries.post?.tone ?? 'neutral'

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

      if (showDetailScore) {
        state.authorScore?.set(
          summaries.author
            ? formatTrustScore(summaries.author, scoreParts)
            : undefined,
          authorTone,
        )
        state.postScore?.set(
          summaries.post
            ? formatTrustScore(summaries.post, scoreParts)
            : undefined,
          postTone,
        )
      }

      const nameRow = findAuthorNameRow(article)
      const displayName =
        readDisplayName(nameRow ?? article) ??
        targets.profileTarget.handle ??
        targets.postTarget.handle ??
        ''
      const handle =
        targets.profileTarget.handle ?? targets.postTarget.handle
      if (UI_TIMELINE_FILTERING_ENABLED) {
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
        // JSON owns hide; collapse + demoted Ad markers come from decorate fast-path.
        clearArticleHide(article)
        applyTimelineDecorateToArticle(article, undefined, features.trustFilters)
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
