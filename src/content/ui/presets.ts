import i18n from 'i18next'
import { findAuthorNameRow, findPostActionBar } from '../scanner'
import type { TrustSummary } from '../trust-summary'
import type { XAugmentationStyle } from '../../shared/x-augmentation'
import type { ArticleTargets, TrustTone } from '../types'
import { createTrustChip, type TrustChip } from './chip'
import { createHoverBar, type HoverBar } from './hoverbar'
import { createDebugPanel, type DebugPanel } from './panel'
import { openPopover } from './popover'
import {
  clearArticleSignals,
  setAuthorTone,
  setPostTone,
} from './signals'
import { TrustCard } from './trust-card'

export {
  DEFAULT_X_AUGMENTATION_STYLE,
  isXAugmentationStyle,
  X_AUGMENTATION_STYLE_KEY,
  X_AUGMENTATION_STYLES,
  type XAugmentationStyle,
} from '../../shared/x-augmentation'

export interface PresetSummaries {
  author?: TrustSummary
  post?: TrustSummary
}

/** Every preset is mount / update / unmount, so the scanner stays generic. */
export interface ArticlePreset {
  readonly style: XAugmentationStyle
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
  chips: TrustChip[]
  bar?: HoverBar
  panel?: DebugPanel
}

interface PresetConfig {
  signals: boolean
  authorChip: boolean
  postChip: boolean
  hoverBar: boolean
  debugPanel: boolean
}

const CONFIGS: Record<XAugmentationStyle, PresetConfig> = {
  chip: {
    signals: false,
    authorChip: true,
    postChip: true,
    hoverBar: false,
    debugPanel: false,
  },
  ambient: {
    signals: true,
    authorChip: false,
    postChip: false,
    hoverBar: false,
    debugPanel: false,
  },
  hoverbar: {
    signals: true,
    authorChip: false,
    postChip: false,
    hoverBar: true,
    debugPanel: false,
  },
  combined: {
    signals: true,
    authorChip: true,
    postChip: false,
    hoverBar: true,
    debugPanel: false,
  },
  panel: {
    signals: false,
    authorChip: false,
    postChip: false,
    hoverBar: false,
    debugPanel: true,
  },
  off: {
    signals: false,
    authorChip: false,
    postChip: false,
    hoverBar: false,
    debugPanel: false,
  },
}

function openCard(
  anchor: HTMLElement,
  targets: ArticleTargets,
  variant: 'author' | 'post',
): void {
  openPopover(anchor, (container) => {
    const card = new TrustCard({
      target:
        variant === 'author' ? targets.profileTarget : targets.postTarget,
      variant,
    })
    container.append(card.host)
    return () => card.destroy()
  })
}

function createPresetFor(style: XAugmentationStyle): ArticlePreset {
  const config = CONFIGS[style]
  const states = new Map<HTMLElement, ArticleState>()

  function tearDown(article: HTMLElement): void {
    const state = states.get(article)
    if (!state) return
    for (const chip of state.chips) chip.destroy()
    state.bar?.destroy()
    state.panel?.destroy()
    states.delete(article)
    clearArticleSignals(article)
  }

  return {
    style,

    mount(article, targets) {
      if (states.has(article)) {
        this.update(article, targets, {})
        return
      }
      const state: ArticleState = { chips: [] }
      states.set(article, state)

      if (config.authorChip) {
        const row = findAuthorNameRow(article)
        if (row) {
          const chip = createTrustChip({
            title: i18n.t('content.card.authorChipTitle'),
            onClick: (anchor) => openCard(anchor, targets, 'author'),
          })
          row.append(chip.host)
          state.chips.push(chip)
        }
      }

      if (config.postChip) {
        const bar = findPostActionBar(article)
        if (bar) {
          const chip = createTrustChip({
            title: i18n.t('content.card.postChipTitle'),
            onClick: (anchor) => openCard(anchor, targets, 'post'),
          })
          bar.append(chip.host)
          state.chips.push(chip)
        }
      }

      if (config.hoverBar) {
        state.bar = createHoverBar(article)
        state.bar.setTargets(targets)
      }

      if (config.debugPanel) {
        state.panel = createDebugPanel(article, targets)
      }
    },

    update(article, targets, summaries) {
      const state = states.get(article)
      if (!state) return

      state.bar?.setTargets(targets)
      state.panel?.update(targets)

      const authorTone: TrustTone = summaries.author?.tone ?? 'neutral'
      const postTone: TrustTone = summaries.post?.tone ?? 'neutral'

      if (config.signals) {
        setAuthorTone(article, authorTone)
        setPostTone(article, postTone)
      }

      const [authorChip, postChip] = config.authorChip
        ? [state.chips[0], config.postChip ? state.chips[1] : undefined]
        : [undefined, state.chips[0]]
      authorChip?.setTone(authorTone)
      postChip?.setTone(postTone)
    },

    unmount(article) {
      tearDown(article)
    },

    destroy() {
      for (const article of [...states.keys()]) tearDown(article)
    },
  }
}

export function createPreset(style: XAugmentationStyle): ArticlePreset {
  return createPresetFor(style)
}
