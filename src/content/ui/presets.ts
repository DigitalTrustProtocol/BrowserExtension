import i18n from 'i18next'
import type { XAugmentationFeatures } from '../../shared/x-augmentation'
import {
  findAuthorChipSlot,
  findAuthorNameRow,
  findPostChipSlot,
  insertAtSlot,
} from '../scanner'
import type { TrustSummary } from '../trust-summary'
import type { ArticleTargets, TrustTone } from '../types'
import { createTrustChip, type TrustChip } from './chip'
import { readPostHeadline } from './card-title'
import { openPopover } from './popover'
import { createTrustScoreLabel, type TrustScoreLabel } from './score'
import {
  clearArticleSignals,
  formatTrustScore,
  readDisplayName,
  setAuthorTone,
  setPostTone,
} from './signals'
import { TrustCard } from './trust-card'

export {
  anyXAugmentationFeature,
  DEFAULT_X_AUGMENTATION_FEATURES,
  normalizeXAugmentationFeatures,
  X_AUGMENTATION_FEATURE_KEYS,
  X_AUGMENTATION_FEATURES_KEY,
  X_AUGMENTATION_OPTION_KEYS,
  X_AUGMENTATION_PANEL_KEYS,
  type XAugmentationFeatureKey,
  type XAugmentationFeatures,
  type XAugmentationOptionKey,
  type XAugmentationPanelKey,
} from '../../shared/x-augmentation'

export interface PresetSummaries {
  author?: TrustSummary
  post?: TrustSummary
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

export function createPreset(features: XAugmentationFeatures): ArticlePreset {
  const states = new Map<HTMLElement, ArticleState>()

  function tearDown(article: HTMLElement): void {
    const state = states.get(article)
    if (!state) return
    state.authorChip?.destroy()
    state.postChip?.destroy()
    state.authorScore?.destroy()
    state.postScore?.destroy()
    states.delete(article)
    clearArticleSignals(article)
  }

  return {
    features,

    mount(article, targets) {
      if (states.has(article)) {
        this.update(article, targets, {})
        return
      }
      const state: ArticleState = { targets }
      states.set(article, state)

      if (features.detail) {
        const nameRow = findAuthorNameRow(article)
        if (nameRow) {
          state.authorScore = createTrustScoreLabel()
          nameRow.append(state.authorScore.host)
        }
      }

      if (features.chip) {
        const authorSlot = findAuthorChipSlot(article)
        if (authorSlot) {
          state.authorChip = createTrustChip({
            title: i18n.t('content.card.authorChipTitle'),
            onClick: (anchor) => openCard(anchor, article, state.targets, 'author'),
          })
          insertAtSlot(state.authorChip.host, authorSlot)
        }

        const postSlot = findPostChipSlot(article)
        if (postSlot) {
          // Detail for posts sits just before the chip (and bookmark).
          if (features.detail) {
            state.postScore = createTrustScoreLabel()
            insertAtSlot(state.postScore.host, postSlot)
          }
          state.postChip = createTrustChip({
            title: i18n.t('content.card.postChipTitle'),
            onClick: (anchor) => openCard(anchor, article, state.targets, 'post'),
            marginEnd: 10,
          })
          insertAtSlot(state.postChip.host, {
            parent: postSlot.parent,
            before: postSlot.before,
          })
        }
      } else if (features.detail) {
        const postSlot = findPostChipSlot(article)
        if (postSlot) {
          state.postScore = createTrustScoreLabel()
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
        setAuthorTone(article, authorTone)
        setPostTone(article, postTone)
      } else {
        clearArticleSignals(article)
      }

      if (features.chip) {
        state.authorChip?.setTone(authorTone)
        state.postChip?.setTone(postTone)
      }

      if (features.detail) {
        state.authorScore?.set(
          summaries.author ? formatTrustScore(summaries.author) : undefined,
          authorTone,
        )
        state.postScore?.set(
          summaries.post ? formatTrustScore(summaries.post) : undefined,
          postTone,
        )
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
