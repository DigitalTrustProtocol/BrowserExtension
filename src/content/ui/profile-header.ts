import { t } from '../i18n'
import { subjectNodeId } from '../../shared/graph-deeplink'
import { openGraphPage } from '../open-graph-page'
import {
  findProfileNameRoot,
  parseProfileHref,
  X_RESERVED_PATH_SEGMENTS,
} from '../scanner'
import { trustDescriptor } from '../trust-helpers'
import { descriptorKey, trustStore } from '../trust-store'
import { summarizeTrust, chipToneForSummary, type TrustSummary } from '../trust-summary'
import {
  detailScoreParts,
  type XAugmentationFeatures,
} from '../../shared/x-augmentation'
import type { TrustTone } from '../types'
import { createTrustChip, type TrustChip } from './chip'
import { openPopover } from './popover'
import { profileTargetForHandle } from './profile-target'
import { createTrustScoreLabel, type TrustScoreLabel } from './score'
import { formatTrustScore, readDisplayName, setProfileTone } from './signals'
import { TrustCard } from './trust-card'

const HOST_ATTR = 'data-attentionx-profile-header'
const CHIP_ATTR = 'data-attentionx-profile-chip'
const SCORE_ATTR = 'data-attentionx-profile-score'

function currentProfileHandle(): string | undefined {
  const handle = parseProfileHref(location.pathname)
  if (!handle || X_RESERVED_PATH_SEGMENTS.has(handle)) return undefined
  return handle
}

function findActionButton(): HTMLElement | undefined {
  const actions =
    document.querySelector<HTMLElement>('[data-testid="userActions"]') ??
    undefined

  const scoped = actions ?? document
  return (
    scoped.querySelector<HTMLElement>('[data-testid$="-subscribe"]') ??
    scoped.querySelector<HTMLElement>('[data-testid$="-unsubscribe"]') ??
    scoped.querySelector<HTMLElement>('[data-testid$="-follow"]') ??
    scoped.querySelector<HTMLElement>('[data-testid$="-unfollow"]') ??
    scoped.querySelector<HTMLElement>('[data-testid="editProfileButton"]') ??
    document.querySelector<HTMLElement>(
      'button[aria-label^="Follow @"], button[aria-label^="Following @"], button[aria-label^="Subscribe"]',
    ) ??
    undefined
  )
}

/**
 * Profile-page augmentation: detail after the display name, chip after
 * Subscribe/Follow, and ambient underline on the display name.
 *
 * Owns a MutationObserver so late-loading X header chrome is still caught.
 */
export class ProfileHeaderAugmentor {
  #chip?: TrustChip
  #score?: TrustScoreLabel
  #chipMount?: HTMLElement
  #scoreMount?: HTMLElement
  #handle?: string
  #unsubscribe?: () => void
  #observer?: MutationObserver
  #syncTimer: ReturnType<typeof setTimeout> | undefined
  #enabled = false
  #chipEnabled = true
  #ambientEnabled = true
  #detailTextEnabled = true
  #detailDegreeEnabled = true

  start(options?: {
    chip?: boolean
    ambient?: boolean
    detailText?: boolean
    detailDegree?: boolean
  }): void {
    this.#enabled = true
    this.#chipEnabled = options?.chip !== false
    this.#ambientEnabled = options?.ambient !== false
    this.#detailTextEnabled = options?.detailText !== false
    this.#detailDegreeEnabled = options?.detailDegree !== false
    if (!this.#observer) {
      this.#observer = new MutationObserver(() => this.#scheduleSync())
      this.#observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      })
    }
    this.sync()
  }

  setFeatures(options: {
    chip: boolean
    ambient: boolean
    detailText: boolean
    detailDegree: boolean
  }): void {
    const changed =
      this.#chipEnabled !== options.chip ||
      this.#ambientEnabled !== options.ambient ||
      this.#detailTextEnabled !== options.detailText ||
      this.#detailDegreeEnabled !== options.detailDegree
    this.#chipEnabled = options.chip
    this.#ambientEnabled = options.ambient
    this.#detailTextEnabled = options.detailText
    this.#detailDegreeEnabled = options.detailDegree
    if (changed) {
      this.#teardownMounts()
      this.sync()
    }
  }

  stop(): void {
    this.#enabled = false
    this.#observer?.disconnect()
    this.#observer = undefined
    if (this.#syncTimer !== undefined) clearTimeout(this.#syncTimer)
    this.#syncTimer = undefined
    this.#teardown()
  }

  #scheduleSync(): void {
    if (!this.#enabled) return
    if (this.#syncTimer !== undefined) clearTimeout(this.#syncTimer)
    this.#syncTimer = setTimeout(() => {
      this.#syncTimer = undefined
      this.sync()
    }, 120)
  }

  sync(): void {
    if (!this.#enabled) return
    const handle = currentProfileHandle()
    if (!handle) {
      this.#teardown()
      return
    }

    const needsChip = this.#chipEnabled && !this.#chipMount?.isConnected
    const needsScore =
      this.#detailScoreEnabled() && !this.#scoreMount?.isConnected
    const sameHandle = this.#handle === handle

    if (sameHandle && !needsChip && !needsScore) {
      this.#watch(handle)
      return
    }

    if (!sameHandle) this.#teardownMounts()
    this.#handle = handle

    if (this.#detailScoreEnabled() && !this.#scoreMount?.isConnected) {
      const nameRoot = findProfileNameRoot()
      if (nameRoot) {
        const scoreMount = document.createElement('span')
        scoreMount.setAttribute(SCORE_ATTR, 'true')
        scoreMount.style.cssText =
          'display:inline-flex;align-items:center;margin-left:8px;vertical-align:middle;'
        this.#score = createTrustScoreLabel()
        this.#score.setOnOpenPath(() => {
          const target = profileTargetForHandle(handle)
          const descriptor = trustDescriptor(target)
          if (!descriptor) return
          void openGraphPage({
            mode: 'path',
            subject: descriptor.subject,
            context: descriptor.context,
            focus: subjectNodeId(descriptor.subject),
          }).catch(() => {
            // TrustCard provides the actionable error surface for tab-open
            // failures; the compact score link stays unobtrusive.
          })
        })
        scoreMount.append(this.#score.host)
        nameRoot.append(scoreMount)
        this.#scoreMount = scoreMount
      }
    }

    if (this.#chipEnabled && !this.#chipMount?.isConnected) {
      const button = findActionButton()
      if (button) {
        const chipMount = document.createElement('span')
        chipMount.setAttribute(CHIP_ATTR, 'true')
        chipMount.setAttribute(HOST_ATTR, 'true')
        chipMount.style.cssText =
          'display:inline-flex;align-items:center;margin-left:8px;vertical-align:middle;'
        this.#chip = createTrustChip({
          title: t('content.card.authorChipTitle'),
          onClick: (anchor) => {
            openPopover(anchor, (container) => {
              const nameRow = findProfileNameRoot()
              const card = new TrustCard({
                target: profileTargetForHandle(handle),
                variant: 'author',
                title: readDisplayName(nameRow ?? document.body),
              })
              container.append(card.host)
              return () => card.destroy()
            })
          },
        })
        chipMount.append(this.#chip.host)
        button.insertAdjacentElement('afterend', chipMount)
        this.#chipMount = chipMount
      }
    }

    this.#watch(handle)
  }

  #watch(handle: string): void {
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    const target = profileTargetForHandle(handle)
    const descriptor = trustDescriptor(target)
    if (!descriptor) {
      this.#paint(undefined)
      return
    }
    const key = descriptorKey(descriptor)
    const cached = trustStore.get(key)
    if (cached) this.#paint(summarizeTrust(cached), trustStore.isLoading(key))
    this.#unsubscribe = trustStore.subscribe(key, (result) => {
      this.#paint(
        result ? summarizeTrust(result) : undefined,
        trustStore.isLoading(key),
      )
    })
    trustStore.request(key, descriptor)
    if (!cached) this.#paint(undefined, trustStore.isLoading(key))
  }

  #detailScoreEnabled(): boolean {
    return this.#detailTextEnabled || this.#detailDegreeEnabled
  }

  #detailScoreParts(): Pick<XAugmentationFeatures, 'detailText' | 'detailDegree'> {
    return {
      detailText: this.#detailTextEnabled,
      detailDegree: this.#detailDegreeEnabled,
    }
  }

  #paint(summary: TrustSummary | undefined, loading = false): void {
    const tone: TrustTone = summary?.tone ?? 'neutral'
    const chipTone: TrustTone = summary
      ? chipToneForSummary(summary)
      : 'neutral'
    const nameRoot = findProfileNameRoot()

    if (this.#ambientEnabled && nameRoot) {
      setProfileTone(nameRoot, tone)
    } else if (nameRoot) {
      setProfileTone(nameRoot, undefined)
    }

    this.#chip?.setLoading(loading)
    this.#chip?.setTone(chipTone)
    const scoreParts = detailScoreParts(this.#detailScoreParts())
    const chipTitle =
      summary && summary.resolution !== 'none'
        ? formatTrustScore(summary, scoreParts) ??
          t('content.card.authorChipTitle')
        : t('content.card.authorChipTitle')
    this.#chip?.setLabel(chipTitle)
    this.#score?.set(
      this.#detailScoreEnabled() && summary
        ? formatTrustScore(summary, scoreParts)
        : undefined,
      tone,
    )
  }

  #teardownMounts(): void {
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    this.#chip?.destroy()
    this.#chip = undefined
    this.#score?.destroy()
    this.#score = undefined
    this.#chipMount?.remove()
    this.#chipMount = undefined
    this.#scoreMount?.remove()
    this.#scoreMount = undefined
    const nameRoot = findProfileNameRoot()
    if (nameRoot) setProfileTone(nameRoot, undefined)
    for (const stale of document.querySelectorAll(
      `[${HOST_ATTR}], [${CHIP_ATTR}], [${SCORE_ATTR}]`,
    )) {
      stale.remove()
    }
  }

  #teardown(): void {
    this.#teardownMounts()
    this.#handle = undefined
  }
}
